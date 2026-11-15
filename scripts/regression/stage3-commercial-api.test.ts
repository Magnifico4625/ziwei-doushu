/**
 * End-to-end regression suite for Stage 3 Commercial & Localization API:
 * - Billing checkout (`POST /api/billing/checkout`) -> pre-pay order poll (`paid: false`, no token)
 *   -> HMAC webhook (`POST /api/billing/webhook`) -> post-pay order poll (`paid: true`, signed `accessToken`)
 * - Language-agnostic `chartKey` / `pairKey` entitlements across `'ru' | 'zh' | 'en'`
 * - Localized LLM system prompts & Redis/PG cache isolation (`'ru'` vs `'zh'` vs `'en'`) on `/api/interpret` & `/api/heming`
 * - Zero-LLM localized `/api/chart` (`city: "Москва"`, `freeLifePalace`, `teasers`, `localizedSummary`, direct `detectPatterns`)
 * - Zero-LLM localized `/api/heming` (`previewOnly: true`, `teasers`, `overview`)
 * - Strict `ALLOWED_ORIGINS` CORS preflight (`OPTIONS` 204/403) & response headers across all 7 API routes
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { GET as healthGET, OPTIONS as healthOPTIONS } from '../../app/api/health/route';
import { POST as chartPOST, OPTIONS as chartOPTIONS } from '../../app/api/chart/route';
import { POST as interpretPOST, OPTIONS as interpretOPTIONS } from '../../app/api/interpret/route';
import { POST as hemingPOST, OPTIONS as hemingOPTIONS } from '../../app/api/heming/route';
import { POST as checkoutPOST, OPTIONS as checkoutOPTIONS } from '../../app/api/billing/checkout/route';
import { GET as orderGET, OPTIONS as orderOPTIONS } from '../../app/api/billing/order/route';
import { POST as webhookPOST, OPTIONS as webhookOPTIONS } from '../../app/api/billing/webhook/route';
import { generateChart } from '../../lib/ziwei/algorithm';
import { getChartCacheKey } from '../../lib/ziwei/chart-analyzer';
import { detectPatterns } from '../../lib/ziwei/patterns';
import type { BirthFormState, ZiweiChart } from '../../lib/ziwei/types';
import { resetServerConfigForTests } from '../../lib/server/env';
import { signWebhookSignature, verifyAccessToken } from '../../lib/server/access-token';
import { resetMemoryRateLimiterForTests } from '../../lib/server/rate-limit';
import { resetInMemoryDbForTests } from '../../lib/server/db';
import {
  buildInterpretRedisKey,
  buildSynastryRedisKey,
  canonicalPairKey,
  hashPromptMessages,
  hashQuestion,
  resetMemoryCacheForTests,
  scopedQuestionHash,
  scopedTopicKey,
} from '../../lib/server/cache';
import { setLlmStreamAdapterForTests } from '../../lib/server/llm';
import type { SupportedLang } from '../../lib/ziwei/i18n';

const HAN_CHAR_RE = /[\u4e00-\u9fff]/;

async function readSseResponse(res: Response): Promise<{
  fullText: string;
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
    if (line.slice(6).trim() === '[DONE]') {
      sawDone = true;
    }
  }

  return {
    fullText: deltas.join(''),
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
  // ── 0) Static Stage 3 Route Audits ────────────────────────────────────────
  {
    const chartSrc = readFileSync(path.resolve('app/api/chart/route.ts'), 'utf8');
    const interpretSrc = readFileSync(path.resolve('app/api/interpret/route.ts'), 'utf8');
    const hemingSrc = readFileSync(path.resolve('app/api/heming/route.ts'), 'utf8');
    const healthSrc = readFileSync(path.resolve('app/api/health/route.ts'), 'utf8');

    assert.equal(
      /server\/llm|streamLlmSse/.test(chartSrc),
      false,
      'app/api/chart/route.ts must remain Zero-LLM',
    );
    assert.equal(
      chartSrc.includes('detectPatternsSafe'),
      false,
      'app/api/chart/route.ts must remove detectPatternsSafe',
    );
    assert.equal(
      interpretSrc.includes('detectPatternsSafe'),
      false,
      'app/api/interpret/route.ts must remove detectPatternsSafe',
    );
    assert.ok(chartSrc.includes("from '@/lib/ziwei/patterns'"));
    assert.ok(interpretSrc.includes("from '@/lib/ziwei/patterns'"));

    for (const [name, src] of [
      ['health', healthSrc],
      ['chart', chartSrc],
      ['interpret', interpretSrc],
      ['heming', hemingSrc],
    ] as const) {
      assert.equal(src.includes('server-only'), false, `${name} route must not import server-only`);
      assert.ok(src.includes('handleCorsPreflight'), `${name} route must export OPTIONS via handleCorsPreflight`);
      assert.ok(src.includes('withCors'), `${name} route must wrap responses with withCors`);
    }
  }

  // ── 1) Cache key scoping unit checks ──────────────────────────────────────
  {
    assert.equal(scopedTopicKey('abc'), 'abc');
    assert.equal(scopedTopicKey('abc', 'zh'), 'abc');
    assert.equal(scopedTopicKey('abc', 'ru'), 'ru:abc');
    assert.equal(scopedTopicKey('abc', 'en'), 'en:abc');

    assert.equal(scopedQuestionHash('default'), 'default');
    assert.equal(scopedQuestionHash('default', 'zh'), 'default');
    assert.equal(scopedQuestionHash('default', 'ru'), 'ru:default');
    assert.equal(scopedQuestionHash('default', 'en'), 'en:default');

    const rZh = buildInterpretRedisKey('k1', 'h1', 'zh');
    const rRu = buildInterpretRedisKey('k1', 'h1', 'ru');
    const rEn = buildInterpretRedisKey('k1', 'h1', 'en');
    assert.equal(rZh, buildInterpretRedisKey('k1', 'h1'));
    assert.notEqual(rRu, rZh);
    assert.notEqual(rEn, rZh);
    assert.notEqual(rRu, rEn);

    const sZh = buildSynastryRedisKey('p1', 'q1', 'zh');
    const sRu = buildSynastryRedisKey('p1', 'q1', 'ru');
    const sEn = buildSynastryRedisKey('p1', 'q1', 'en');
    assert.equal(sZh, buildSynastryRedisKey('p1', 'q1'));
    assert.notEqual(sRu, sZh);
    assert.notEqual(sEn, sZh);
    assert.notEqual(sRu, sEn);
  }

  const testAccessSecret = 'stage3-commercial-access-secret-32b';
  const testWebhookSecret = 'stage3-commercial-webhook-secret-32b';
  const allowedOrigin = 'https://ru.example.org';
  const disallowedOrigin = 'https://evil.attacker.example';

  await withEnv(
    {
      AI_PROVIDER: 'deepseek',
      AI_PAYWALL_MODE: 'strict',
      DATABASE_URL: undefined,
      REDIS_URL: undefined,
      ACCESS_TOKEN_SECRET: testAccessSecret,
      PAYWALL_WEBHOOK_SECRET: testWebhookSecret,
      ALLOWED_ORIGINS: `https://app.example.com, ${allowedOrigin}`,
      APP_PUBLIC_URL: 'https://app.example.com',
      BILLING_PROVIDER: 'yookassa',
      DEEPSEEK_API_KEY: 'stage3-test-key-placeholder',
      CHART_RATE_LIMIT_PER_MIN: '100',
      INTERPRET_RATE_LIMIT_PER_MIN: '100',
    },
    async () => {
      resetInMemoryDbForTests();
      resetMemoryCacheForTests();
      resetMemoryRateLimiterForTests();

      let llmCallCount = 0;
      let lastSystemPrompt = '';
      let lastLang: SupportedLang | undefined;

      setLlmStreamAdapterForTests(async function* (opts) {
        llmCallCount += 1;
        lastSystemPrompt = opts.systemPrompt;
        lastLang = opts.lang;
        if (opts.lang === 'ru') {
          yield '**【Общий портрет】**\n';
          yield `RU-ответ #${llmCallCount}: Дворец Судьбы стабилен.`;
        } else if (opts.lang === 'en') {
          yield '**【Overview】**\n';
          yield `EN-reply #${llmCallCount}: Life Palace balanced.`;
        } else {
          yield '**【命格总评】**\n';
          yield `ZH-回复 #${llmCallCount}：命宫稳健。`;
        }
      });

      try {
        const chartA = generateChart({ year: 1990, month: 5, day: 15, hour: 4, gender: 'male' });
        const chartB = generateChart({ year: 1992, month: 8, day: 20, hour: 7, gender: 'female' });
        const expectedChartKey = getChartCacheKey(chartA);
        const expectedPairKey = canonicalPairKey(chartA, chartB, 2026);

        // ── 2) /api/chart with city: "Москва" + lang: 'ru' + Zero-LLM teasers ─
        {
          const moscowForm: BirthFormState = {
            name: 'Алексей',
            year: '1991',
            month: '3',
            day: '10',
            clockHour: '23',
            clockMinute: '30',
            unknownTime: false,
            province: '',
            city: 'Москва',
            longitude: 37.6,
            gender: 'male',
          };
          // Omit longitude explicitly to verify Moscow coordinates are looked up automatically
          const { longitude: _omittedLon, ...moscowFormNoLon } = moscowForm;
          void _omittedLon;

          const resRu = await chartPOST(
            makeJsonRequest(
              'http://localhost/api/chart',
              {
                form: moscowFormNoLon,
                targetYear: 2026,
                lang: 'ru',
              },
              { Origin: allowedOrigin },
            ),
          );
          assert.equal(resRu.status, 200);
          assert.equal(resRu.headers.get('access-control-allow-origin'), allowedOrigin);

          const dataRu = (await resRu.json()) as {
            ok: boolean;
            mode: string;
            lang: SupportedLang;
            cacheKey: string;
            chart: ZiweiChart;
            patterns: ReturnType<typeof detectPatterns>;
            freeLifePalace: {
              lang: SupportedLang;
              archetypeTitle: string;
              paragraphs: string[];
              reading: string;
              keywords: string[];
            };
            teasers: {
              lang: SupportedLang;
              cacheKey: string;
              lockedTeasers: Array<{ hookHeadline: string; teaser: string; unlockCta: string }>;
              patterns: { count: number; headline: string; items: Array<{ name: string }> };
              unlockCta: string;
            };
            localizedSummary: {
              lang: SupportedLang;
              basic: { city?: string; wuxingJu: string };
              patterns: Array<{ name: string; originalName: string }>;
            };
            localizedPatterns: Array<{ name: string }>;
          };

          assert.equal(dataRu.ok, true);
          assert.equal(dataRu.mode, 'natal');
          assert.equal(dataRu.lang, 'ru');
          assert.equal(dataRu.chart.birthInfo.longitude, 37.6);
          assert.equal(dataRu.chart.birthInfo.timeZone, 'Europe/Moscow');

          // Compare cacheKey against canonical Chinese input
          const canonicalMoscowForm: BirthFormState = {
            ...moscowForm,
            province: '海外 / 国际',
            city: '莫斯科',
            longitude: 37.6,
            utcOffsetMinutes: 180,
            timeZone: 'Europe/Moscow',
          };
          const resCanonical = await chartPOST(
            makeJsonRequest('http://localhost/api/chart', {
              form: canonicalMoscowForm,
              targetYear: 2026,
            }),
          );
          const canonicalJson = (await resCanonical.json()) as { cacheKey: string };
          assert.equal(dataRu.cacheKey, canonicalJson.cacheKey);

          // Direct detectPatterns & localized outputs
          const directPatterns = detectPatterns(dataRu.chart);
          assert.deepEqual(dataRu.patterns, directPatterns);
          assert.equal(dataRu.freeLifePalace.lang, 'ru');
          assert.ok(dataRu.freeLifePalace.archetypeTitle.length > 0);
          assert.ok(dataRu.freeLifePalace.paragraphs.length >= 2);
          assert.ok(dataRu.freeLifePalace.reading.length > 40);
          assert.equal(HAN_CHAR_RE.test(dataRu.freeLifePalace.archetypeTitle), false);

          assert.equal(dataRu.teasers.lang, 'ru');
          assert.equal(dataRu.teasers.cacheKey, dataRu.cacheKey);
          assert.ok(dataRu.teasers.lockedTeasers.length > 0);
          assert.equal(dataRu.teasers.patterns.count, directPatterns.length);
          assert.equal(HAN_CHAR_RE.test(dataRu.teasers.unlockCta), false);

          assert.equal(dataRu.localizedSummary.lang, 'ru');
          assert.equal(dataRu.localizedSummary.basic.city, 'Москва');
          assert.equal(HAN_CHAR_RE.test(dataRu.localizedSummary.basic.wuxingJu), false);
          assert.equal(dataRu.localizedPatterns.length, directPatterns.length);

          // English birthInfo lookup with city: "Moscow"
          const resEn = await chartPOST(
            makeJsonRequest('http://localhost/api/chart', {
              birthInfo: { year: 1990, month: 5, day: 15, hour: 4, gender: 'male', city: 'Moscow' },
              lang: 'en',
            }),
          );
          assert.equal(resEn.status, 200);
          const dataEn = (await resEn.json()) as {
            lang: SupportedLang;
            chart: ZiweiChart;
            freeLifePalace: { lang: SupportedLang; archetypeTitle: string };
            teasers: { lang: SupportedLang; unlockCta: string };
            localizedSummary: { basic: { city?: string } };
          };
          assert.equal(dataEn.lang, 'en');
          assert.equal(dataEn.chart.birthInfo.longitude, 37.6);
          assert.equal(dataEn.freeLifePalace.lang, 'en');
          assert.equal(dataEn.teasers.lang, 'en');
          assert.equal(dataEn.localizedSummary.basic.city, 'Moscow');

          assert.equal(llmCallCount, 0, '/api/chart must make ZERO LLM calls');
        }

        // ── 3) Billing Checkout -> Order Poll -> Webhook -> Order Poll -> /api/interpret SSE ─
        {
          // Bad checkout requests rejected cleanly
          const badCheckout = await checkoutPOST(
            makeJsonRequest('http://localhost/api/billing/checkout', {
              scope: 'interpret',
              chartKey: expectedChartKey,
              returnUrl: 'javascript:alert(1)',
            }),
          );
          assert.equal(badCheckout.status, 400);

          // Create pending checkout order
          const checkoutRes = await checkoutPOST(
            makeJsonRequest(
              'http://localhost/api/billing/checkout',
              {
                scope: 'interpret',
                chartKey: expectedChartKey,
                currency: 'RUB',
                amountMinor: 49900,
                returnUrl: '/chart/result',
              },
              { Origin: allowedOrigin },
            ),
          );
          assert.equal(checkoutRes.status, 201);
          assert.equal(checkoutRes.headers.get('access-control-allow-origin'), allowedOrigin);
          const checkoutJson = (await checkoutRes.json()) as {
            ok: boolean;
            orderId: string;
            status: string;
            provider: string;
            scope: string;
            targetKey: string;
            checkoutUrl: string;
            createdAt: string;
          };
          assert.equal(checkoutJson.ok, true);
          assert.equal(checkoutJson.status, 'pending');
          assert.equal(checkoutJson.provider, 'yookassa');
          assert.equal(checkoutJson.scope, 'interpret');
          assert.equal(checkoutJson.targetKey, expectedChartKey);
          assert.ok(checkoutJson.orderId.startsWith('ord_'));
          assert.ok(checkoutJson.checkoutUrl.includes(checkoutJson.orderId));

          // Missing & unknown order poll -> 400 / 404
          const missingOrderRes = await orderGET(new Request('http://localhost/api/billing/order'));
          assert.equal(missingOrderRes.status, 400);
          const unknownOrderRes = await orderGET(
            new Request('http://localhost/api/billing/order?orderId=ord_does_not_exist'),
          );
          assert.equal(unknownOrderRes.status, 404);

          // Pre-payment poll -> paid: false, MUST NOT leak accessToken
          const prePollRes = await orderGET(
            new Request(`http://localhost/api/billing/order?orderId=${checkoutJson.orderId}`, {
              headers: { Origin: allowedOrigin },
            }),
          );
          assert.equal(prePollRes.status, 200);
          assert.equal(prePollRes.headers.get('access-control-allow-origin'), allowedOrigin);
          const prePollJson = (await prePollRes.json()) as Record<string, unknown>;
          assert.equal(prePollJson.paid, false);
          assert.equal(prePollJson.status, 'pending');
          assert.equal('accessToken' in prePollJson, false, 'Unpaid order must NOT return accessToken');

          // /api/interpret remains locked (402) before payment
          const lockedRes = await interpretPOST(
            makeJsonRequest(
              'http://localhost/api/interpret',
              {
                chart: chartA,
                messages: [{ role: 'user', content: 'Расскажи о карьере' }],
                lang: 'ru',
              },
              { Origin: allowedOrigin },
            ),
          );
          assert.equal(lockedRes.status, 402);
          assert.equal(lockedRes.headers.get('access-control-allow-origin'), allowedOrigin);
          assert.equal(llmCallCount, 0);

          // Simulate payment provider HMAC-signed webhook
          const webhookPayload = JSON.stringify({
            eventId: 'evt-stage3-int-1',
            orderId: checkoutJson.orderId,
            scope: 'interpret',
            targetKey: expectedChartKey,
            status: 'paid',
            amountMinor: 49900,
            currency: 'RUB',
            provider: 'yookassa',
          });
          const webhookSig = signWebhookSignature(webhookPayload, testWebhookSecret);
          const webhookRes = await webhookPOST(
            new Request('http://localhost/api/billing/webhook', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-webhook-signature': `sha256=${webhookSig}`,
                Origin: allowedOrigin,
              },
              body: webhookPayload,
            }),
          );
          assert.equal(webhookRes.status, 200);
          assert.equal(webhookRes.headers.get('access-control-allow-origin'), allowedOrigin);

          // Post-payment order poll -> paid: true + valid accessToken
          const postPollRes = await orderGET(
            new Request(`http://localhost/api/billing/order?orderId=${checkoutJson.orderId}`, {
              headers: { Origin: allowedOrigin },
            }),
          );
          assert.equal(postPollRes.status, 200);
          const postPollJson = (await postPollRes.json()) as {
            ok: boolean;
            orderId: string;
            status: string;
            paid: boolean;
            accessToken: string;
          };
          assert.equal(postPollJson.ok, true);
          assert.equal(postPollJson.status, 'paid');
          assert.equal(postPollJson.paid, true);
          assert.equal(
            verifyAccessToken(postPollJson.accessToken, 'interpret', expectedChartKey, testAccessSecret).valid,
            true,
          );

          const messages = [{ role: 'user' as const, content: 'Проанализируй карту и карьеру' }];
          const msgHash = hashPromptMessages(messages);
          assert.notEqual(scopedTopicKey(msgHash, 'ru'), scopedTopicKey(msgHash, 'zh'));

          // 1st Russian SSE call -> MISS, Russian prompt used
          const sseRu1Res = await interpretPOST(
            makeJsonRequest(
              'http://localhost/api/interpret',
              { chart: chartA, messages, lang: 'ru' },
              {
                Authorization: `Bearer ${postPollJson.accessToken}`,
                Origin: allowedOrigin,
              },
            ),
          );
          assert.equal(sseRu1Res.status, 200);
          assert.equal(sseRu1Res.headers.get('access-control-allow-origin'), allowedOrigin);
          const sseRu1 = await readSseResponse(sseRu1Res);
          assert.equal(sseRu1.xCache, 'MISS');
          assert.equal(sseRu1.sawDone, true);
          assert.ok(sseRu1.fullText.includes('RU-ответ #1'));
          assert.equal(llmCallCount, 1);
          assert.equal(lastLang, 'ru');
          assert.ok(lastSystemPrompt.includes('Цзы Вэй Доу Шу'));
          assert.ok(lastSystemPrompt.includes('Хуа Лу'));

          // 2nd Russian SSE call -> Redis HIT, ZERO extra LLM calls
          const sseRu2Res = await interpretPOST(
            makeJsonRequest(
              'http://localhost/api/interpret',
              { chart: chartA, messages, lang: 'ru' },
              { Authorization: `Bearer ${postPollJson.accessToken}` },
            ),
          );
          assert.equal(sseRu2Res.status, 200);
          const sseRu2 = await readSseResponse(sseRu2Res);
          assert.equal(sseRu2.xCache, 'HIT');
          assert.equal(sseRu2.fullText, sseRu1.fullText);
          assert.equal(llmCallCount, 1);

          // Switch UI language to 'zh' using SAME token/chartKey -> MISS (cache isolated from 'ru')
          const sseZhRes = await interpretPOST(
            makeJsonRequest(
              'http://localhost/api/interpret',
              { chart: chartA, messages, lang: 'zh' },
              { Authorization: `Bearer ${postPollJson.accessToken}` },
            ),
          );
          assert.equal(sseZhRes.status, 200);
          const sseZh = await readSseResponse(sseZhRes);
          assert.equal(sseZh.xCache, 'MISS');
          assert.ok(sseZh.fullText.includes('ZH-回复 #2'));
          assert.equal(llmCallCount, 2);
          assert.equal(lastLang, 'zh');
          assert.ok(lastSystemPrompt.includes('紫微斗数'));

          // Switch UI language to 'en' using SAME token -> MISS
          const sseEnRes = await interpretPOST(
            makeJsonRequest(
              'http://localhost/api/interpret',
              { chart: chartA, messages, lang: 'en' },
              { Authorization: `Bearer ${postPollJson.accessToken}` },
            ),
          );
          assert.equal(sseEnRes.status, 200);
          const sseEn = await readSseResponse(sseEnRes);
          assert.equal(sseEn.xCache, 'MISS');
          assert.ok(sseEn.fullText.includes('EN-reply #3'));
          assert.equal(llmCallCount, 3);
          assert.equal(lastLang, 'en');
          assert.ok(lastSystemPrompt.includes('Zi Wei Dou Shu'));

          // Clear Redis memory cache -> PG fallback still keeps 'ru' vs 'zh' vs 'en' isolated
          resetMemoryCacheForTests();
          const sseRuPgRes = await interpretPOST(
            makeJsonRequest('http://localhost/api/interpret', {
              chart: chartA,
              messages,
              lang: 'ru',
            }),
          );
          assert.equal(sseRuPgRes.status, 200);
          const sseRuPg = await readSseResponse(sseRuPgRes);
          assert.equal(sseRuPg.xCache, 'HIT');
          assert.equal(sseRuPg.fullText, sseRu1.fullText);
          assert.equal(llmCallCount, 3);
        }

        // ── 4) /api/heming previewOnly teasers & paid 'ru'/'zh' SSE isolation ─
        {
          // Free previewOnly in Russian ($0 LLM)
          const prevRuRes = await hemingPOST(
            makeJsonRequest(
              'http://localhost/api/heming',
              {
                chartA,
                chartB,
                targetYear: 2026,
                previewOnly: true,
                lang: 'ru',
              },
              { Origin: allowedOrigin },
            ),
          );
          assert.equal(prevRuRes.status, 200);
          assert.equal(prevRuRes.headers.get('access-control-allow-origin'), allowedOrigin);
          const prevRu = (await prevRuRes.json()) as {
            ok: boolean;
            lang: SupportedLang;
            pairKey: string;
            overview: string;
            teasers: {
              lang: SupportedLang;
              overview: string;
              scoreBandLabel: string;
              bondLabel: string;
              lockedTeasers: Array<{ hookHeadline: string; teaser: string; unlockCta: string }>;
              unlockCta: string;
            };
          };
          assert.equal(prevRu.ok, true);
          assert.equal(prevRu.lang, 'ru');
          assert.equal(prevRu.pairKey, expectedPairKey);
          assert.ok(prevRu.overview.length > 20);
          assert.equal(prevRu.overview, prevRu.teasers.overview);
          assert.equal(prevRu.teasers.lang, 'ru');
          assert.ok(prevRu.teasers.lockedTeasers.length > 0);
          assert.equal(HAN_CHAR_RE.test(prevRu.overview), false);
          assert.equal(HAN_CHAR_RE.test(prevRu.teasers.unlockCta), false);

          // Free previewOnly in English ($0 LLM)
          const prevEnRes = await hemingPOST(
            makeJsonRequest('http://localhost/api/heming', {
              chartA,
              chartB,
              targetYear: 2026,
              previewOnly: true,
              lang: 'en',
            }),
          );
          assert.equal(prevEnRes.status, 200);
          const prevEn = (await prevEnRes.json()) as {
            lang: SupportedLang;
            overview: string;
            teasers: { lang: SupportedLang; unlockCta: string };
          };
          assert.equal(prevEn.lang, 'en');
          assert.equal(prevEn.teasers.lang, 'en');
          assert.equal(HAN_CHAR_RE.test(prevEn.overview), false);
          assert.equal(llmCallCount, 3, 'heming previewOnly must make ZERO LLM calls');

          // Checkout + webhook for heming
          const hemCheckoutRes = await checkoutPOST(
            makeJsonRequest('http://localhost/api/billing/checkout', {
              scope: 'heming',
              pairKey: expectedPairKey,
            }),
          );
          assert.equal(hemCheckoutRes.status, 201);
          const hemCheckout = (await hemCheckoutRes.json()) as { orderId: string };

          const hemWebhookRaw = JSON.stringify({
            eventId: 'evt-stage3-hem-1',
            orderId: hemCheckout.orderId,
            scope: 'heming',
            targetKey: expectedPairKey,
            status: 'paid',
          });
          await webhookPOST(
            new Request('http://localhost/api/billing/webhook', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-webhook-signature': `sha256=${signWebhookSignature(hemWebhookRaw, testWebhookSecret)}`,
              },
              body: hemWebhookRaw,
            }),
          );
          const hemOrderRes = await orderGET(
            new Request(`http://localhost/api/billing/order?orderId=${hemCheckout.orderId}`),
          );
          const hemOrder = (await hemOrderRes.json()) as { paid: boolean; accessToken: string };
          assert.equal(hemOrder.paid, true);

          // Paid Russian heming SSE -> MISS (llmCallCount = 4), repeat -> HIT
          const hemRu1Res = await hemingPOST(
            makeJsonRequest(
              'http://localhost/api/heming',
              { chartA, chartB, targetYear: 2026, lang: 'ru' },
              { Authorization: `Bearer ${hemOrder.accessToken}`, Origin: allowedOrigin },
            ),
          );
          assert.equal(hemRu1Res.status, 200);
          assert.equal(hemRu1Res.headers.get('access-control-allow-origin'), allowedOrigin);
          const hemRu1 = await readSseResponse(hemRu1Res);
          assert.equal(hemRu1.xCache, 'MISS');
          assert.ok(hemRu1.fullText.includes('RU-ответ #4'));
          assert.equal(llmCallCount, 4);
          assert.ok(lastSystemPrompt.includes('синастрии'));

          const hemRu2 = await readSseResponse(
            await hemingPOST(
              makeJsonRequest(
                'http://localhost/api/heming',
                { chartA, chartB, targetYear: 2026, lang: 'ru' },
                { Authorization: `Bearer ${hemOrder.accessToken}` },
              ),
            ),
          );
          assert.equal(hemRu2.xCache, 'HIT');
          assert.equal(hemRu2.fullText, hemRu1.fullText);
          assert.equal(llmCallCount, 4);

          // Paid Chinese heming SSE with SAME token -> MISS (isolated from 'ru')
          const hemZh1 = await readSseResponse(
            await hemingPOST(
              makeJsonRequest(
                'http://localhost/api/heming',
                { chartA, chartB, targetYear: 2026, lang: 'zh' },
                { Authorization: `Bearer ${hemOrder.accessToken}` },
              ),
            ),
          );
          assert.equal(hemZh1.xCache, 'MISS');
          assert.ok(hemZh1.fullText.includes('ZH-回复 #5'));
          assert.equal(llmCallCount, 5);

          // Clear Redis -> PG fallback preserves Russian vs Chinese isolation
          resetMemoryCacheForTests();
          const hemRuPg = await readSseResponse(
            await hemingPOST(
              makeJsonRequest('http://localhost/api/heming', {
                chartA,
                chartB,
                targetYear: 2026,
                lang: 'ru',
              }),
            ),
          );
          assert.equal(hemRuPg.xCache, 'HIT');
          assert.equal(hemRuPg.fullText, hemRu1.fullText);
          assert.equal(llmCallCount, 5);

          // /api/chart synastry check respects language isolation of cached interpretation
          const synCheckRu = (await (
            await chartPOST(
              makeJsonRequest('http://localhost/api/chart', {
                chartA,
                chartB,
                targetYear: 2026,
                lang: 'ru',
              }),
            )
          ).json()) as { hasCachedInterpretation: boolean };
          assert.equal(synCheckRu.hasCachedInterpretation, true);

          const synCheckEn = (await (
            await chartPOST(
              makeJsonRequest('http://localhost/api/chart', {
                chartA,
                chartB,
                targetYear: 2026,
                lang: 'en',
              }),
            )
          ).json()) as { hasCachedInterpretation: boolean };
          assert.equal(synCheckEn.hasCachedInterpretation, false);
        }

        // ── 5) CORS OPTIONS (204/403) & response headers across all 7 routes ──
        {
          const optionsHandlers: Array<[string, (req: Request) => Promise<Response>]> = [
            ['http://localhost/api/health', healthOPTIONS],
            ['http://localhost/api/chart', chartOPTIONS],
            ['http://localhost/api/interpret', interpretOPTIONS],
            ['http://localhost/api/heming', hemingOPTIONS],
            ['http://localhost/api/billing/checkout', checkoutOPTIONS],
            ['http://localhost/api/billing/order', orderOPTIONS],
            ['http://localhost/api/billing/webhook', webhookOPTIONS],
          ];

          for (const [url, handler] of optionsHandlers) {
            const okOpt = await handler(
              new Request(url, {
                method: 'OPTIONS',
                headers: {
                  Origin: allowedOrigin,
                  'Access-Control-Request-Method': 'POST',
                },
              }),
            );
            assert.equal(okOpt.status, 204, `Allowed OPTIONS on ${url} must return 204`);
            assert.equal(okOpt.headers.get('access-control-allow-origin'), allowedOrigin);
            assert.ok((okOpt.headers.get('access-control-allow-methods') ?? '').includes('POST'));
            assert.ok((okOpt.headers.get('access-control-allow-headers') ?? '').includes('Authorization'));

            const badOpt = await handler(
              new Request(url, {
                method: 'OPTIONS',
                headers: {
                  Origin: disallowedOrigin,
                  'Access-Control-Request-Method': 'POST',
                },
              }),
            );
            assert.equal(badOpt.status, 403, `Disallowed OPTIONS on ${url} must return 403`);
            assert.equal(badOpt.headers.get('access-control-allow-origin'), null);
          }

          // GET /api/health allowed vs disallowed Origin
          const healthOk = await healthGET(
            new Request('http://localhost/api/health', { headers: { Origin: allowedOrigin } }),
          );
          assert.equal(healthOk.status, 200);
          assert.equal(healthOk.headers.get('access-control-allow-origin'), allowedOrigin);
          assert.ok((healthOk.headers.get('vary') ?? '').toLowerCase().includes('origin'));

          const healthDisallowed = await healthGET(
            new Request('http://localhost/api/health', { headers: { Origin: disallowedOrigin } }),
          );
          assert.equal(healthDisallowed.status, 200);
          assert.equal(healthDisallowed.headers.get('access-control-allow-origin'), null);

          // POST /api/chart disallowed Origin omits Access-Control-Allow-Origin
          const chartDisallowed = await chartPOST(
            makeJsonRequest(
              'http://localhost/api/chart',
              { birthInfo: { year: 1990, month: 5, day: 15, hour: 4, gender: 'male' } },
              { Origin: disallowedOrigin },
            ),
          );
          assert.equal(chartDisallowed.status, 200);
          assert.equal(chartDisallowed.headers.get('access-control-allow-origin'), null);

          // Wildcard ALLOWED_ORIGINS="*"
          await withEnv({ ALLOWED_ORIGINS: '*' }, async () => {
            const wildcardOpt = await healthOPTIONS(
              new Request('http://localhost/api/health', {
                method: 'OPTIONS',
                headers: { Origin: 'https://any-frontend.example' },
              }),
            );
            assert.equal(wildcardOpt.status, 204);
            assert.equal(wildcardOpt.headers.get('access-control-allow-origin'), '*');

            const wildcardGet = await healthGET(
              new Request('http://localhost/api/health', {
                headers: { Origin: 'https://any-frontend.example' },
              }),
            );
            assert.equal(wildcardGet.status, 200);
            assert.equal(wildcardGet.headers.get('access-control-allow-origin'), '*');
          });
        }
      } finally {
        setLlmStreamAdapterForTests(null);
      }
    },
  );

  console.log('✅ Stage 3 commercial billing, CORS, and localized API regression suite passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
