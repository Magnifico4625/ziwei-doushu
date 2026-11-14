/**
 * End-to-end regression suite for Stage 2 API Route Handlers:
 * - `GET /api/health`
 * - `POST /api/chart` (natal + synastry preview, Zero-LLM, invalid dates, rate limits)
 * - `POST /api/billing/webhook` (HMAC signature verification, idempotency, paid-only grant)
 * - `POST /api/interpret` (strict 402 paywall before cache/LLM, SSE stream MISS, Redis/PG HIT, DB fallback, 429)
 * - `POST /api/heming` (previewOnly Zero-LLM, strict 402 paywall, SSE stream MISS, question-hash HIT, 429)
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { GET as healthGET } from '../../app/api/health/route';
import { POST as chartPOST } from '../../app/api/chart/route';
import { POST as webhookPOST } from '../../app/api/billing/webhook/route';
import { POST as interpretPOST } from '../../app/api/interpret/route';
import { POST as hemingPOST } from '../../app/api/heming/route';
import { generateChart } from '../../lib/ziwei/algorithm';
import { getChartCacheKey } from '../../lib/ziwei/chart-analyzer';
import type { BirthFormState } from '../../lib/ziwei/types';
import { resetServerConfigForTests } from '../../lib/server/env';
import { signWebhookSignature } from '../../lib/server/access-token';
import { resetMemoryRateLimiterForTests } from '../../lib/server/rate-limit';
import {
  getChartInterpretation,
  hasPaidEntitlement,
  resetInMemoryDbForTests,
  saveChartInterpretation,
  saveSynastryInterpretation,
} from '../../lib/server/db';
import {
  buildInterpretRedisKey,
  buildSynastryRedisKey,
  canonicalPairKey,
  hashPromptMessages,
  hashQuestion,
  resetMemoryCacheForTests,
  setCachedStreamText,
} from '../../lib/server/cache';
import { setLlmStreamAdapterForTests } from '../../lib/server/llm';

async function readSseResponse(res: Response): Promise<{
  fullText: string;
  deltas: string[];
  sawDone: boolean;
  xCache: string | null;
}> {
  assert.ok(
    (res.headers.get('content-type') ?? '').includes('text/event-stream'),
    `Expected text/event-stream content-type, got ${res.headers.get('content-type')}`,
  );
  assert.ok(res.body !== null, 'SSE response must have a readable body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const deltas: string[] = [];
  let sawDone = false;
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') {
        sawDone = true;
        continue;
      }
      const parsed = JSON.parse(data) as { delta?: { text?: string } };
      if (typeof parsed.delta?.text === 'string') {
        deltas.push(parsed.delta.text);
      }
    }
  }

  const tail = buffer + decoder.decode();
  for (const line of tail.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (data === '[DONE]') {
      sawDone = true;
    }
  }

  return {
    fullText: deltas.join(''),
    deltas,
    sawDone,
    xCache: res.headers.get('x-cache'),
  };
}

function makeJsonRequest(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, val] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (val === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = val;
    }
  }
  resetServerConfigForTests();
  try {
    return await fn();
  } finally {
    for (const [key, val] of previous.entries()) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
    resetServerConfigForTests();
  }
}

async function main(): Promise<void> {
  // ── 0) Static Zero-LLM audit on /api/chart ────────────────────────────────
  {
    const chartRoutePath = path.resolve('app/api/chart/route.ts');
    const chartRouteSrc = readFileSync(chartRoutePath, 'utf8');
    assert.equal(
      /server\/llm|streamLlmSse/.test(chartRouteSrc),
      false,
      'app/api/chart/route.ts must NEVER import or reference lib/server/llm.ts',
    );
  }

  const testAccessSecret = 'api-routes-access-secret-for-tests-32b';
  const testWebhookSecret = 'api-routes-webhook-secret-for-tests-32b';

  await withEnv(
    {
      AI_PROVIDER: 'deepseek',
      AI_PAYWALL_MODE: 'strict',
      DATABASE_URL: undefined,
      REDIS_URL: undefined,
      ACCESS_TOKEN_SECRET: testAccessSecret,
      PAYWALL_WEBHOOK_SECRET: testWebhookSecret,
      DEEPSEEK_API_KEY: 'super-secret-deepseek-do-not-leak',
      ANTHROPIC_API_KEY: 'super-secret-anthropic-do-not-leak',
      CHART_RATE_LIMIT_PER_MIN: '20',
      INTERPRET_RATE_LIMIT_PER_MIN: '20',
    },
    async () => {
      resetInMemoryDbForTests();
      resetMemoryCacheForTests();
      resetMemoryRateLimiterForTests();

      let llmCallCount = 0;
      setLlmStreamAdapterForTests(async function* (opts) {
        llmCallCount += 1;
        const lastMsg = opts.messages[opts.messages.length - 1]?.content ?? '';
        yield '**【命理简析】**\n';
        yield `模拟响应#${llmCallCount}: `;
        yield lastMsg.slice(0, 12);
      });

      try {
        // ── 1) GET /api/health ──────────────────────────────────────────────
        {
          const res = await healthGET();
          assert.equal(res.status, 200);
          const raw = await res.text();
          assert.equal(raw.includes('super-secret'), false, 'Health response must never leak secrets');
          assert.equal(raw.includes(testAccessSecret), false);
          assert.equal(raw.includes(testWebhookSecret), false);

          const data = JSON.parse(raw) as {
            ok: boolean;
            postgres: { ok: boolean; mode: string };
            redis: { ok: boolean; mode: string };
            aiProvider: string;
            paywallMode: string;
          };
          assert.equal(data.ok, true);
          assert.equal(data.postgres.ok, true);
          assert.equal(data.postgres.mode, 'memory');
          assert.equal(data.redis.ok, true);
          assert.equal(data.redis.mode, 'memory');
          assert.equal(data.aiProvider, 'deepseek');
          assert.equal(data.paywallMode, 'strict');
        }

        // ── 2) POST /api/chart (Natal + Synastry Preview, $0 LLM) ───────────
        const chartA = generateChart({ year: 1990, month: 5, day: 15, hour: 4, gender: 'male' });
        const chartB = generateChart({ year: 1992, month: 8, day: 20, hour: 7, gender: 'female' });
        const expectedChartKey = getChartCacheKey(chartA);
        const expectedPairKey = canonicalPairKey(chartA, chartB, 2026);

        {
          // Natal via birthInfo
          const resNatal = await chartPOST(
            makeJsonRequest('http://localhost/api/chart', {
              birthInfo: { year: 1990, month: 5, day: 15, hour: 4, gender: 'male', name: 'Tester' },
            }),
          );
          assert.equal(resNatal.status, 200);
          const natalData = (await resNatal.json()) as {
            ok: boolean;
            mode: string;
            cacheKey: string;
            hasCachedInterpretation: boolean;
            summary: { cacheKey: string; painPoints: unknown[] };
            patterns: unknown[];
          };
          assert.equal(natalData.ok, true);
          assert.equal(natalData.mode, 'natal');
          assert.equal(natalData.cacheKey, expectedChartKey);
          assert.equal(natalData.summary.cacheKey, expectedChartKey);
          assert.equal(natalData.hasCachedInterpretation, false);
          assert.ok(Array.isArray(natalData.summary.painPoints));
          assert.ok(Array.isArray(natalData.patterns));

          // Natal via form (Moscow, late Zishi 23:30)
          const formInput: BirthFormState = {
            name: 'Ivan',
            year: '1991',
            month: '3',
            day: '10',
            clockHour: '23',
            clockMinute: '30',
            unknownTime: false,
            province: '海外 / 国际',
            city: '莫斯科',
            longitude: 37.6,
            utcOffsetMinutes: 180,
            timeZone: 'Europe/Moscow',
            gender: 'male',
          };
          const resForm = await chartPOST(
            makeJsonRequest('http://localhost/api/chart', {
              form: formInput,
              targetYear: 2026,
            }),
          );
          assert.equal(resForm.status, 200);
          const formData = (await resForm.json()) as {
            ok: boolean;
            mode: string;
            cacheKey: string;
          };
          assert.equal(formData.ok, true);
          assert.equal(formData.mode, 'natal');
          assert.ok(formData.cacheKey.endsWith(':y2026'));

          // Invalid Gregorian dates rejected with 400
          for (const badBirth of [
            { year: 1925, month: 2, day: 29, hour: 4, gender: 'male' },
            { year: 1980, month: 2, day: 30, hour: 4, gender: 'male' },
            { year: 2000, month: 4, day: 31, hour: 4, gender: 'female' },
            { year: 2000, month: 1, day: 1, hour: 12, gender: 'female' },
          ]) {
            const badRes = await chartPOST(
              makeJsonRequest('http://localhost/api/chart', { birthInfo: badBirth }),
            );
            assert.equal(badRes.status, 400, `Expected 400 for ${JSON.stringify(badBirth)}`);
          }

          // Synastry preview via chartA & chartB
          const resSyn = await chartPOST(
            makeJsonRequest('http://localhost/api/chart', {
              chartA,
              chartB,
              targetYear: 2026,
            }),
          );
          assert.equal(resSyn.status, 200);
          const synData = (await resSyn.json()) as {
            ok: boolean;
            mode: string;
            pairKey: string;
            synastry: { score: number };
            hasCachedInterpretation: boolean;
          };
          assert.equal(synData.ok, true);
          assert.equal(synData.mode, 'synastry');
          assert.equal(synData.pairKey, expectedPairKey);
          assert.ok(synData.synastry.score >= 0 && synData.synastry.score <= 100);
          assert.equal(synData.hasCachedInterpretation, false);

          assert.equal(llmCallCount, 0, '/api/chart must make ZERO LLM calls');
        }

        // ── 3) Strict Paywall Guard (402 BEFORE cached paid text & BEFORE LLM) ─
        {
          const interpretMessages = [{ role: 'user' as const, content: '请生成命格总览' }];
          const msgHash = hashPromptMessages(interpretMessages);
          await setCachedStreamText(buildInterpretRedisKey(expectedChartKey, msgHash), 'SECRET_PAID_CACHE');
          await saveChartInterpretation({
            cacheKey: expectedChartKey,
            topicKey: msgHash,
            content: 'SECRET_PAID_CACHE',
          });

          const qHash = hashQuestion('感情匹配度如何？');
          await setCachedStreamText(buildSynastryRedisKey(expectedPairKey, qHash), 'SECRET_PAID_SYNASTRY');
          await saveSynastryInterpretation({
            pairKey: expectedPairKey,
            questionHash: qHash,
            content: 'SECRET_PAID_SYNASTRY',
          });

          // Unauthenticated interpret -> 402
          const lockedInterpret = await interpretPOST(
            makeJsonRequest('http://localhost/api/interpret', {
              chart: chartA,
              messages: interpretMessages,
            }),
          );
          assert.equal(lockedInterpret.status, 402);
          const lockedIntJson = (await lockedInterpret.json()) as {
            error: string;
            code: string;
            cacheKey: string;
          };
          assert.equal(lockedIntJson.error, 'payment_required');
          assert.equal(lockedIntJson.code, 'PAYWALL_LOCKED');
          assert.equal(lockedIntJson.cacheKey, expectedChartKey);

          // Unauthenticated heming -> 402
          const lockedHeming = await hemingPOST(
            makeJsonRequest('http://localhost/api/heming', {
              chartA,
              chartB,
              question: '感情匹配度如何？',
              targetYear: 2026,
            }),
          );
          assert.equal(lockedHeming.status, 402);
          const lockedHemJson = (await lockedHeming.json()) as {
            error: string;
            code: string;
            pairKey: string;
          };
          assert.equal(lockedHemJson.error, 'payment_required');
          assert.equal(lockedHemJson.code, 'PAYWALL_LOCKED');
          assert.equal(lockedHemJson.pairKey, expectedPairKey);

          // Preview-only heming remains free ($0 LLM) even in strict paywall mode
          const previewHeming = await hemingPOST(
            makeJsonRequest('http://localhost/api/heming', {
              chartA,
              chartB,
              targetYear: 2026,
              previewOnly: true,
            }),
          );
          assert.equal(previewHeming.status, 200);
          const previewJson = (await previewHeming.json()) as {
            ok: boolean;
            pairKey: string;
            synastry: { score: number };
          };
          assert.equal(previewJson.ok, true);
          assert.equal(previewJson.pairKey, expectedPairKey);

          // Tampered token rejected -> 402
          const tamperedRes = await interpretPOST(
            makeJsonRequest(
              'http://localhost/api/interpret',
              { chart: chartA, messages: interpretMessages },
              { Authorization: 'Bearer invalid.tampered.token' },
            ),
          );
          assert.equal(tamperedRes.status, 402);

          assert.equal(llmCallCount, 0, 'Paywall 402 and previewOnly must make ZERO LLM calls');

          // Reset stores so subsequent tests verify true MISS -> HIT transitions cleanly
          resetInMemoryDbForTests();
          resetMemoryCacheForTests();
        }

        // ── 4) POST /api/billing/webhook (signature check + idempotency + token) ─
        let interpretAccessToken = '';
        let hemingAccessToken = '';
        {
          // Missing signature -> 401
          const noSigRes = await webhookPOST(
            makeJsonRequest('http://localhost/api/billing/webhook', {
              eventId: 'evt-no-sig',
              orderId: 'ord-no-sig',
              scope: 'interpret',
              targetKey: expectedChartKey,
              status: 'paid',
            }),
          );
          assert.equal(noSigRes.status, 401);

          // Invalid signature -> 401
          const badSigRes = await webhookPOST(
            makeJsonRequest(
              'http://localhost/api/billing/webhook',
              {
                eventId: 'evt-bad-sig',
                orderId: 'ord-bad-sig',
                scope: 'interpret',
                targetKey: expectedChartKey,
                status: 'paid',
              },
              { 'x-webhook-signature': 'sha256=' + 'f'.repeat(64) },
            ),
          );
          assert.equal(badSigRes.status, 401);

          // Non-paid status -> 200 granted: false, NO entitlement
          const pendingRaw = JSON.stringify({
            eventId: 'evt-pending-1',
            orderId: 'ord-pending-1',
            scope: 'interpret',
            targetKey: expectedChartKey,
            status: 'pending',
          });
          const pendingSig = signWebhookSignature(pendingRaw, testWebhookSecret);
          const pendingRes = await webhookPOST(
            new Request('http://localhost/api/billing/webhook', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-webhook-signature': `sha256=${pendingSig}`,
              },
              body: pendingRaw,
            }),
          );
          assert.equal(pendingRes.status, 200);
          const pendingJson = (await pendingRes.json()) as { granted: boolean; accessToken: null };
          assert.equal(pendingJson.granted, false);
          assert.equal(pendingJson.accessToken, null);
          assert.equal(await hasPaidEntitlement('interpret', expectedChartKey), false);

          // Paid interpret webhook -> issues token, idempotent on replay
          const paidIntRaw = JSON.stringify({
            eventId: 'evt-int-1',
            orderId: 'ord-int-1',
            scope: 'interpret',
            targetKey: expectedChartKey,
            status: 'paid',
            amountMinor: 1990,
            currency: 'CNY',
            provider: 'stripe',
          });
          const paidIntSig = signWebhookSignature(paidIntRaw, testWebhookSecret);
          const paidIntRes1 = await webhookPOST(
            new Request('http://localhost/api/billing/webhook', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-webhook-signature': `sha256=${paidIntSig}`,
              },
              body: paidIntRaw,
            }),
          );
          assert.equal(paidIntRes1.status, 200);
          const paidIntJson1 = (await paidIntRes1.json()) as {
            ok: boolean;
            orderId: string;
            scope: string;
            targetKey: string;
            idempotent: boolean;
            accessToken: string;
          };
          assert.equal(paidIntJson1.ok, true);
          assert.equal(paidIntJson1.idempotent, false);
          assert.ok(paidIntJson1.accessToken.length > 20);
          interpretAccessToken = paidIntJson1.accessToken;

          // Replay same eventId via x-signature header
          const paidIntRes2 = await webhookPOST(
            new Request('http://localhost/api/billing/webhook', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-signature': paidIntSig,
              },
              body: paidIntRaw,
            }),
          );
          assert.equal(paidIntRes2.status, 200);
          const paidIntJson2 = (await paidIntRes2.json()) as { idempotent: boolean; accessToken: string };
          assert.equal(paidIntJson2.idempotent, true);
          assert.ok(paidIntJson2.accessToken.length > 20);

          // Paid heming webhook -> issues heming token
          const paidHemRaw = JSON.stringify({
            eventId: 'evt-hem-1',
            orderId: 'ord-hem-1',
            scope: 'heming',
            targetKey: expectedPairKey,
            status: 'paid',
          });
          const paidHemSig = signWebhookSignature(paidHemRaw, testWebhookSecret);
          const paidHemRes = await webhookPOST(
            new Request('http://localhost/api/billing/webhook', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-webhook-signature': `sha256=${paidHemSig}`,
              },
              body: paidHemRaw,
            }),
          );
          assert.equal(paidHemRes.status, 200);
          const paidHemJson = (await paidHemRes.json()) as { ok: boolean; accessToken: string };
          assert.equal(paidHemJson.ok, true);
          hemingAccessToken = paidHemJson.accessToken;

          // Wrong-scope token rejected by /api/interpret even if targetKey differs
          const wrongScopeRes = await interpretPOST(
            makeJsonRequest(
              'http://localhost/api/interpret',
              {
                chart: chartB,
                messages: [{ role: 'user', content: '解读' }],
              },
              { Authorization: `Bearer ${hemingAccessToken}` },
            ),
          );
          assert.equal(wrongScopeRes.status, 402);
        }

        // ── 5) POST /api/interpret: MISS -> Redis HIT -> PG HIT ─────────────
        {
          const messages = [{ role: 'user' as const, content: '请分析命宫格局与事业方向' }];

          // Invalid inputs rejected -> 400
          const badMsgRes = await interpretPOST(
            makeJsonRequest('http://localhost/api/interpret', { chart: chartA, messages: [] }),
          );
          assert.equal(badMsgRes.status, 400);

          // 1st call: Authorization Bearer token -> X-Cache: MISS, llmCallCount = 1
          const res1 = await interpretPOST(
            makeJsonRequest(
              'http://localhost/api/interpret',
              { chart: chartA, messages },
              { Authorization: `Bearer ${interpretAccessToken}` },
            ),
          );
          assert.equal(res1.status, 200);
          const sse1 = await readSseResponse(res1);
          assert.equal(sse1.xCache, 'MISS');
          assert.equal(sse1.sawDone, true);
          assert.ok(sse1.fullText.includes('模拟响应#1'));
          assert.equal(llmCallCount, 1);

          // 2nd call: body.accessToken -> X-Cache: HIT, llmCallCount stays 1
          const res2 = await interpretPOST(
            makeJsonRequest('http://localhost/api/interpret', {
              chart: chartA,
              messages,
              accessToken: interpretAccessToken,
            }),
          );
          assert.equal(res2.status, 200);
          const sse2 = await readSseResponse(res2);
          assert.equal(sse2.xCache, 'HIT');
          assert.equal(sse2.sawDone, true);
          assert.equal(sse2.fullText, sse1.fullText);
          assert.equal(llmCallCount, 1);

          // 3rd call: clear Redis cache & omit token (InsightPanel DB entitlement + PG cache HIT)
          resetMemoryCacheForTests();
          const res3 = await interpretPOST(
            makeJsonRequest('http://localhost/api/interpret', {
              chart: chartA,
              messages,
            }),
          );
          assert.equal(res3.status, 200);
          const sse3 = await readSseResponse(res3);
          assert.equal(sse3.xCache, 'HIT');
          assert.equal(sse3.fullText, sse1.fullText);
          assert.equal(llmCallCount, 1);
          assert.ok(await getChartInterpretation(expectedChartKey, hashPromptMessages(messages)));
        }

        // ── 6) POST /api/heming: MISS -> Normalized Question HIT -> Default ─
        {
          // 1st call with question -> X-Cache: MISS, llmCallCount = 2
          const hemRes1 = await hemingPOST(
            makeJsonRequest(
              'http://localhost/api/heming',
              {
                chartA,
                chartB,
                question: '感情匹配度如何？',
                targetYear: 2026,
              },
              { Authorization: `Bearer ${hemingAccessToken}` },
            ),
          );
          assert.equal(hemRes1.status, 200);
          const hemSse1 = await readSseResponse(hemRes1);
          assert.equal(hemSse1.xCache, 'MISS');
          assert.equal(hemSse1.sawDone, true);
          assert.ok(hemSse1.fullText.includes('模拟响应#2'));
          assert.equal(llmCallCount, 2);

          // 2nd call with whitespace-padded same question -> X-Cache: HIT, llmCallCount = 2
          const hemRes2 = await hemingPOST(
            makeJsonRequest('http://localhost/api/heming', {
              chartA,
              chartB,
              question: '   感情匹配度如何？  ',
              targetYear: 2026,
              accessToken: hemingAccessToken,
            }),
          );
          assert.equal(hemRes2.status, 200);
          const hemSse2 = await readSseResponse(hemRes2);
          assert.equal(hemSse2.xCache, 'HIT');
          assert.equal(hemSse2.sawDone, true);
          assert.equal(hemSse2.fullText, hemSse1.fullText);
          assert.equal(llmCallCount, 2);

          // Default (no question) call -> MISS (llmCallCount = 3), then repeat -> HIT (llmCallCount = 3)
          const hemDefault1 = await hemingPOST(
            makeJsonRequest(
              'http://localhost/api/heming',
              { chartA, chartB, targetYear: 2026 },
              { Authorization: `Bearer ${hemingAccessToken}` },
            ),
          );
          assert.equal(hemDefault1.status, 200);
          const hemDefSse1 = await readSseResponse(hemDefault1);
          assert.equal(hemDefSse1.xCache, 'MISS');
          assert.equal(llmCallCount, 3);

          const hemDefault2 = await hemingPOST(
            makeJsonRequest(
              'http://localhost/api/heming',
              { chartA, chartB, targetYear: 2026 },
              { Authorization: `Bearer ${hemingAccessToken}` },
            ),
          );
          assert.equal(hemDefault2.status, 200);
          const hemDefSse2 = await readSseResponse(hemDefault2);
          assert.equal(hemDefSse2.xCache, 'HIT');
          assert.equal(hemDefSse2.fullText, hemDefSse1.fullText);
          assert.equal(llmCallCount, 3);

          // /api/chart synastry preview now sees cached default synastry interpretation
          const synPreviewAfter = await chartPOST(
            makeJsonRequest('http://localhost/api/chart', { chartA, chartB, targetYear: 2026 }),
          );
          assert.equal(synPreviewAfter.status, 200);
          const synPreviewAfterJson = (await synPreviewAfter.json()) as {
            hasCachedInterpretation: boolean;
          };
          assert.equal(synPreviewAfterJson.hasCachedInterpretation, true);
        }

        // ── 7) 429 Rate Limits on /api/chart, /api/interpret, /api/heming ─────
        await withEnv(
          {
            CHART_RATE_LIMIT_PER_MIN: '2',
            INTERPRET_RATE_LIMIT_PER_MIN: '2',
          },
          async () => {
            resetMemoryRateLimiterForTests();
            const ipHeaders = { 'x-forwarded-for': '198.51.100.42' };

            for (let i = 0; i < 2; i += 1) {
              const okRes = await chartPOST(
                makeJsonRequest(
                  'http://localhost/api/chart',
                  { birthInfo: { year: 1990, month: 5, day: 15, hour: 4, gender: 'male' } },
                  ipHeaders,
                ),
              );
              assert.equal(okRes.status, 200);
            }
            const limitedChart = await chartPOST(
              makeJsonRequest(
                'http://localhost/api/chart',
                { birthInfo: { year: 1990, month: 5, day: 15, hour: 4, gender: 'male' } },
                ipHeaders,
              ),
            );
            assert.equal(limitedChart.status, 429);
            assert.ok(Number(limitedChart.headers.get('retry-after')) > 0);

            const llmBefore429 = llmCallCount;
            for (let i = 0; i < 2; i += 1) {
              const okInt = await interpretPOST(
                makeJsonRequest(
                  'http://localhost/api/interpret',
                  { chart: chartA, messages: [{ role: 'user', content: '请分析命宫格局与事业方向' }] },
                  { ...ipHeaders, Authorization: `Bearer ${interpretAccessToken}` },
                ),
              );
              assert.equal(okInt.status, 200);
              await readSseResponse(okInt);
            }
            const limitedInterpret = await interpretPOST(
              makeJsonRequest(
                'http://localhost/api/interpret',
                { chart: chartA, messages: [{ role: 'user', content: '请分析命宫格局与事业方向' }] },
                { ...ipHeaders, Authorization: `Bearer ${interpretAccessToken}` },
              ),
            );
            assert.equal(limitedInterpret.status, 429);
            assert.ok(Number(limitedInterpret.headers.get('retry-after')) > 0);
            assert.equal(llmCallCount, llmBefore429);
          },
        );

        // ── 8) AI_PAYWALL_MODE=off + missing API key -> 503 without secret leak ─
        setLlmStreamAdapterForTests(null);
        await withEnv(
          {
            AI_PAYWALL_MODE: 'off',
            AI_PROVIDER: 'deepseek',
            DEEPSEEK_API_KEY: undefined,
            PAYWALL_WEBHOOK_SECRET: undefined,
          },
          async () => {
            resetMemoryRateLimiterForTests();
            resetMemoryCacheForTests();
            resetInMemoryDbForTests();

            const webhookUnconfigured = await webhookPOST(
              makeJsonRequest('http://localhost/api/billing/webhook', {
                eventId: 'evt-unconf',
                orderId: 'ord-unconf',
                scope: 'interpret',
                targetKey: expectedChartKey,
                status: 'paid',
              }),
            );
            assert.equal(webhookUnconfigured.status, 503);

            const noKeyInterpret = await interpretPOST(
              makeJsonRequest('http://localhost/api/interpret', {
                chart: chartA,
                messages: [{ role: 'user', content: '全新未缓存的问题' }],
              }),
            );
            assert.equal(noKeyInterpret.status, 503);
            const errBody = await noKeyInterpret.text();
            assert.equal(errBody.includes('DEEPSEEK_API_KEY'), false);
          },
        );
      } finally {
        setLlmStreamAdapterForTests(null);
      }
    },
  );

  console.log('✅ Stage 2 API route handler regression suite passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
