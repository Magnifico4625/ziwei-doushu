/**
 * Regression suite for Stage 2 Server Infrastructure (`lib/server/*`):
 * - `env.ts`: defaults (`aiPaywallMode === 'strict'`), env overrides, config reset
 * - `access-token.ts`: HMAC-SHA256 tokens (`bundle` cross-scope, expiry, tamper, wrong key), webhook signatures, bearer extraction
 * - `rate-limit.ts`: client IP extraction, fixed/sliding window limits, `429` retry metadata, reset
 * - `db.ts`: idempotent webhook orders, paid entitlement checks, chart & synastry interpretation persistence (memory fallback)
 * - `cache.ts`: deterministic cache keys, Redis memory fallback TTL cache, `canonicalPairKey`
 * - `llm.ts`: SSE wire compatibility (`InsightPanel` / `heming`), `< 3 KB` compact prompt payloads, mock & OpenAI SSE streaming, config/upstream errors
 */

import assert from 'node:assert/strict';
import { generateChart } from '../../lib/ziwei/algorithm';
import { buildChartPromptPayload } from '../../lib/ziwei/chart-analyzer';
import { analyzeSynastry, buildSynastryPromptPayload } from '../../lib/ziwei/heming';
import {
  getServerConfig,
  resetServerConfigForTests,
} from '../../lib/server/env';
import {
  extractBearerToken,
  signAccessToken,
  signWebhookSignature,
  verifyAccessToken,
  verifyWebhookSignature,
} from '../../lib/server/access-token';
import {
  checkRateLimit,
  extractClientIp,
  resetMemoryRateLimiterForTests,
} from '../../lib/server/rate-limit';
import {
  checkDbHealth,
  getChartInterpretation,
  getSynastryInterpretation,
  hasPaidEntitlement,
  recordWebhookOrderIfNew,
  resetInMemoryDbForTests,
  saveChartInterpretation,
  saveSynastryInterpretation,
} from '../../lib/server/db';
import {
  buildInterpretRedisKey,
  buildSynastryRedisKey,
  canonicalPairKey,
  checkRedisHealth,
  getCachedStreamText,
  getRedisClient,
  hashPromptMessages,
  hashQuestion,
  resetMemoryCacheForTests,
  setCachedStreamText,
} from '../../lib/server/cache';
import {
  buildChartSystemPrompt,
  buildSynastrySystemPrompt,
  createSseFromCachedText,
  LlmConfigError,
  LlmUpstreamError,
  setLlmStreamAdapterForTests,
  SSE_HEADERS,
  streamLlmSse,
} from '../../lib/server/llm';

async function readAllSseEvents(stream: ReadableStream<Uint8Array>): Promise<{
  rawChunks: string[];
  deltas: string[];
  fullText: string;
  sawDone: boolean;
}> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const rawChunks: string[] = [];
  const deltas: string[] = [];
  let sawDone = false;
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    rawChunks.push(text);
    buffer += text;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') {
        sawDone = true;
        continue;
      }
      const parsed = JSON.parse(payload) as { delta?: { text?: string } };
      if (typeof parsed.delta?.text === 'string') {
        deltas.push(parsed.delta.text);
      }
    }
  }

  const tail = buffer + decoder.decode();
  for (const line of tail.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6).trim();
    if (payload === '[DONE]') {
      sawDone = true;
    }
  }

  return {
    rawChunks,
    deltas,
    fullText: deltas.join(''),
    sawDone,
  };
}

async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<T> | T,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [k, v] of Object.entries(overrides)) {
    previous.set(k, process.env[k]);
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  resetServerConfigForTests();
  try {
    return await fn();
  } finally {
    for (const [k, v] of previous.entries()) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    resetServerConfigForTests();
  }
}

async function main(): Promise<void> {
  // ── 1) env.ts defaults & overrides ───────────────────────────────────────
  await withEnv(
    {
      AI_PROVIDER: undefined,
      AI_PAYWALL_MODE: undefined,
      DATABASE_URL: undefined,
      REDIS_URL: undefined,
      DEEPSEEK_API_KEY: undefined,
      ANTHROPIC_API_KEY: undefined,
      INTERPRET_RATE_LIMIT_PER_MIN: undefined,
      CHART_RATE_LIMIT_PER_MIN: undefined,
    },
    () => {
      const cfg = getServerConfig();
      assert.equal(cfg.aiPaywallMode, 'strict');
      assert.equal(cfg.aiProvider, 'deepseek');
      assert.ok(cfg.deepseekBaseUrl.length > 0);
      assert.ok(cfg.deepseekModel.length > 0);
      assert.ok(cfg.anthropicModel.length > 0);
      assert.ok(cfg.interpretRateLimitPerMin > 0);
      assert.ok(cfg.chartRateLimitPerMin > 0);
    },
  );

  await withEnv(
    {
      AI_PROVIDER: 'anthropic',
      AI_PAYWALL_MODE: 'off',
      ANTHROPIC_API_KEY: 'test-anthropic-key',
      ANTHROPIC_MODEL: 'claude-3-5-sonnet-20241022',
      INTERPRET_RATE_LIMIT_PER_MIN: '12',
      CHART_RATE_LIMIT_PER_MIN: '45',
    },
    () => {
      const cfg = getServerConfig();
      assert.equal(cfg.aiProvider, 'anthropic');
      assert.equal(cfg.aiPaywallMode, 'off');
      assert.equal(cfg.anthropicApiKey, 'test-anthropic-key');
      assert.equal(cfg.anthropicModel, 'claude-3-5-sonnet-20241022');
      assert.equal(cfg.interpretRateLimitPerMin, 12);
      assert.equal(cfg.chartRateLimitPerMin, 45);
    },
  );

  // ── 2) access-token.ts: signing, verification, bundle scope, webhook ────
  {
    const secret = 'stage2-test-hmac-secret-32-bytes!';
    const targetKey = 'ziwei:v1:1990-05-15:4:male:default:split';

    await assert.rejects(
      () =>
        withEnv({ ACCESS_TOKEN_SECRET: undefined }, () =>
          signAccessToken({ scope: 'interpret', targetKey, orderId: 'ord-missing-secret' }),
        ),
      /secret/i,
    );

    const tokenInterpret = signAccessToken(
      { scope: 'interpret', targetKey, orderId: 'ord-1', ttlSeconds: 300 },
      secret,
    );
    const verifiedInterpret = verifyAccessToken(tokenInterpret, 'interpret', targetKey, secret);
    assert.equal(verifiedInterpret.valid, true);
    if (verifiedInterpret.valid) {
      assert.equal(verifiedInterpret.payload.scope, 'interpret');
      assert.equal(verifiedInterpret.payload.targetKey, targetKey);
      assert.equal(verifiedInterpret.payload.orderId, 'ord-1');
    }

    // Wrong scope
    assert.equal(verifyAccessToken(tokenInterpret, 'heming', targetKey, secret).valid, false);
    // Wrong targetKey
    assert.equal(verifyAccessToken(tokenInterpret, 'interpret', `${targetKey}:other`, secret).valid, false);
    // Tampered signature
    const parts = tokenInterpret.split('.');
    assert.equal(parts.length, 3);
    const lastChar = parts[2].slice(-1);
    const flipped = lastChar === 'A' ? 'B' : 'A';
    const tampered = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -1)}${flipped}`;
    assert.equal(verifyAccessToken(tampered, 'interpret', targetKey, secret).valid, false);

    // Bundle cross-scope satisfies both interpret and heming
    const bundleToken = signAccessToken(
      { scope: 'bundle', targetKey, orderId: 'ord-bundle', ttlSeconds: 300 },
      secret,
    );
    assert.equal(verifyAccessToken(bundleToken, 'interpret', targetKey, secret).valid, true);
    assert.equal(verifyAccessToken(bundleToken, 'heming', targetKey, secret).valid, true);

    // Expiry check via Date.now mocking (deterministic, zero sleep)
    const realNow = Date.now;
    let fakeNow = 1_700_000_000_000;
    Date.now = () => fakeNow;
    try {
      const shortToken = signAccessToken(
        { scope: 'interpret', targetKey, orderId: 'ord-exp', ttlSeconds: 10 },
        secret,
      );
      assert.equal(verifyAccessToken(shortToken, 'interpret', targetKey, secret).valid, true);
      fakeNow += 15_000;
      assert.equal(verifyAccessToken(shortToken, 'interpret', targetKey, secret).valid, false);
    } finally {
      Date.now = realNow;
    }

    // Webhook HMAC verification (sha256= prefix + raw hex + invalid rejection)
    const rawBody = JSON.stringify({ eventId: 'evt-1', orderId: 'ord-1', status: 'paid' });
    const webhookSecret = 'webhook-hmac-secret-test';
    const sigHex = signWebhookSignature(rawBody, webhookSecret);
    assert.equal(verifyWebhookSignature(rawBody, sigHex, webhookSecret), true);
    assert.equal(verifyWebhookSignature(rawBody, `sha256=${sigHex}`, webhookSecret), true);
    assert.equal(verifyWebhookSignature(rawBody, `sha256=${'0'.repeat(sigHex.length)}`, webhookSecret), false);
    assert.equal(verifyWebhookSignature(`${rawBody} `, `sha256=${sigHex}`, webhookSecret), false);
    assert.equal(verifyWebhookSignature(rawBody, 'sha256=not-hex', webhookSecret), false);
    assert.equal(verifyWebhookSignature(rawBody, null, webhookSecret), false);

    // Bearer token extraction
    const reqWithAuth = new Request('http://localhost/api/interpret', {
      headers: { Authorization: `Bearer ${tokenInterpret}` },
    });
    assert.equal(extractBearerToken(reqWithAuth), tokenInterpret);
    const reqNoAuth = new Request('http://localhost/api/interpret');
    assert.equal(extractBearerToken(reqNoAuth, 'body-tok'), 'body-tok');
    assert.equal(extractBearerToken(reqNoAuth, undefined), null);
  }

  // ── 3) rate-limit.ts: IP extraction, allowance, 429 block, reset ─────────
  {
    resetMemoryRateLimiterForTests();
    const ipReq1 = new Request('http://localhost/api/chart', {
      headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' },
    });
    assert.equal(extractClientIp(ipReq1), '203.0.113.10');
    const ipReq2 = new Request('http://localhost/api/chart', {
      headers: { 'x-real-ip': '198.51.100.7' },
    });
    assert.equal(extractClientIp(ipReq2), '198.51.100.7');
    assert.equal(extractClientIp(new Request('http://localhost/api/chart')), 'unknown');

    const r1 = await checkRateLimit({ key: 'test:ip:1', limit: 2, windowSeconds: 60 });
    assert.equal(r1.allowed, true);
    assert.equal(r1.remaining, 1);
    assert.equal(r1.backend, 'memory');

    const r2 = await checkRateLimit({ key: 'test:ip:1', limit: 2, windowSeconds: 60 });
    assert.equal(r2.allowed, true);
    assert.equal(r2.remaining, 0);

    const r3 = await checkRateLimit({ key: 'test:ip:1', limit: 2, windowSeconds: 60 });
    assert.equal(r3.allowed, false);
    assert.equal(r3.remaining, 0);
    assert.ok(r3.retryAfterSeconds > 0);

    resetMemoryRateLimiterForTests();
    const rReset = await checkRateLimit({ key: 'test:ip:1', limit: 2, windowSeconds: 60 });
    assert.equal(rReset.allowed, true);
    assert.equal(rReset.remaining, 1);
  }

  // ── 4) db.ts & cache.ts: memory fallback stores & deterministic keys ────
  await withEnv(
    {
      DATABASE_URL: undefined,
      REDIS_URL: undefined,
    },
    async () => {
      resetInMemoryDbForTests();
      resetMemoryCacheForTests();

      const dbHealth = await checkDbHealth();
      assert.equal(dbHealth.ok, true);
      assert.equal(dbHealth.mode, 'memory');

      const redisHealth = await checkRedisHealth();
      assert.equal(redisHealth.ok, true);
      assert.equal(redisHealth.mode, 'memory');

      const key = 'ziwei:v1:1992-08-18:6:female:default:split';
      assert.equal(await hasPaidEntitlement('interpret', key), false);

      const first = await recordWebhookOrderIfNew({
        eventId: 'evt-unique-1',
        orderId: 'ord-unique-1',
        scope: 'interpret',
        targetKey: key,
        amountMinor: 1990,
        currency: 'CNY',
        provider: 'wechat',
      });
      assert.equal(first.inserted, true);
      assert.equal(first.order.status, 'paid');

      const dup = await recordWebhookOrderIfNew({
        eventId: 'evt-unique-1',
        orderId: 'ord-unique-1',
        scope: 'interpret',
        targetKey: key,
      });
      assert.equal(dup.inserted, false);
      assert.equal(await hasPaidEntitlement('interpret', key), true);
      assert.equal(await hasPaidEntitlement('heming', key), false);

      // Unpaid status must NOT grant entitlement; paid status must not downgrade
      const pendingKey = 'ziwei:v1:1995-01-01:1:male:default:split';
      await recordWebhookOrderIfNew({
        eventId: 'evt-pending-1',
        orderId: 'ord-pending-1',
        scope: 'interpret',
        targetKey: pendingKey,
        status: 'pending',
      });
      assert.equal(await hasPaidEntitlement('interpret', pendingKey), false);

      const nonDowngrade = await recordWebhookOrderIfNew({
        eventId: 'evt-downgrade-attempt',
        orderId: 'ord-unique-1',
        scope: 'interpret',
        targetKey: key,
        status: 'refunded',
      });
      assert.equal(nonDowngrade.inserted, true);
      assert.equal(nonDowngrade.order.status, 'paid');
      assert.equal(await hasPaidEntitlement('interpret', key), true);

      // Bundle entitlement covers both interpret and heming for exact targetKey
      const bundleKey = 'bundle-key-1';
      await recordWebhookOrderIfNew({
        eventId: 'evt-bundle-1',
        orderId: 'ord-bundle-1',
        scope: 'bundle',
        targetKey: bundleKey,
      });
      assert.equal(await hasPaidEntitlement('interpret', bundleKey), true);
      assert.equal(await hasPaidEntitlement('heming', bundleKey), true);

      // Chart interpretation persistence (default + named topicKey)
      assert.equal(await getChartInterpretation(key), null);
      await saveChartInterpretation({
        cacheKey: key,
        content: '**【默认命格】**\n默认主题缓存。',
      });
      assert.equal((await getChartInterpretation(key))?.content, '**【默认命格】**\n默认主题缓存。');

      assert.equal(await getChartInterpretation(key, 'overview'), null);
      await saveChartInterpretation({
        cacheKey: key,
        topicKey: 'overview',
        content: '**【命格定性】**\n命盘稳健。',
        provider: 'deepseek',
        model: 'deepseek-chat',
      });
      const savedChart = await getChartInterpretation(key, 'overview');
      assert.ok(savedChart !== null);
      assert.equal(savedChart?.content, '**【命格定性】**\n命盘稳健。');

      // Synastry interpretation persistence
      const chartA = generateChart({ year: 1990, month: 5, day: 15, hour: 4, gender: 'male' });
      const chartB = generateChart({ year: 1992, month: 8, day: 20, hour: 7, gender: 'female' });
      const pairKeyAB = canonicalPairKey(chartA, chartB, 2026);
      const pairKeyBA = canonicalPairKey(chartB, chartA, 2026);
      assert.equal(pairKeyAB, pairKeyBA, 'canonicalPairKey must be symmetric for A/B swap');

      const qHashDefault = hashQuestion('');
      const qHashCustom = hashQuestion('  感情匹配度如何？  ');
      assert.notEqual(qHashDefault, qHashCustom);
      assert.equal(qHashCustom, hashQuestion('感情匹配度如何？'));

      await saveSynastryInterpretation({
        pairKey: pairKeyAB,
        questionHash: qHashCustom,
        content: '**【合盘总评】**\n互补良好。',
        provider: 'deepseek',
        model: 'deepseek-chat',
      });
      const savedSyn = await getSynastryInterpretation(pairKeyAB, qHashCustom);
      assert.equal(savedSyn?.content, '**【合盘总评】**\n互补良好。');

      // Redis memory fallback cache + TTL delete
      assert.equal(getRedisClient(), null);
      const msgHash = hashPromptMessages([{ role: 'user', content: '分析事业' }]);
      const rKey = buildInterpretRedisKey(key, msgHash);
      const sKey = buildSynastryRedisKey(pairKeyAB, qHashCustom);
      assert.notEqual(rKey, sKey);
      assert.equal(await getCachedStreamText(rKey), null);
      await setCachedStreamText(rKey, '缓存解读正文✨', 60);
      assert.equal(await getCachedStreamText(rKey), '缓存解读正文✨');
      await setCachedStreamText(rKey, '', 0);
      assert.equal(await getCachedStreamText(rKey), null);
    },
  );

  // ── 5) llm.ts: SSE wire format, prompt payloads < 3KB, streaming & errors
  {
    assert.equal(SSE_HEADERS['Content-Type'], 'text/event-stream; charset=utf-8');
    assert.equal(SSE_HEADERS['Cache-Control'], 'no-cache, no-transform');
    assert.equal(SSE_HEADERS.Connection, 'keep-alive');

    // Cached SSE replay including surrogate-pair emoji safety & [DONE]
    const cachedText = '**【命格定性】**\n第一段✨测试第二段，确保分片不破坏UTF-16代理对。';
    const cachedStream = createSseFromCachedText(cachedText, 6);
    const cachedParsed = await readAllSseEvents(cachedStream);
    assert.equal(cachedParsed.sawDone, true);
    assert.equal(cachedParsed.fullText, cachedText);
    assert.ok(cachedParsed.deltas.length >= 2);
    for (const chunk of cachedParsed.rawChunks) {
      assert.ok(chunk.startsWith('data: '));
      assert.ok(chunk.endsWith('\n\n'));
    }

    // Empty cached text still emits [DONE] cleanly
    const emptyParsed = await readAllSseEvents(createSseFromCachedText(''));
    assert.equal(emptyParsed.sawDone, true);
    assert.equal(emptyParsed.fullText, '');

    // Prompt builders include compact < 3KB JSON payloads
    const chartA = generateChart({ year: 1990, month: 5, day: 15, hour: 4, gender: 'male' });
    const chartB = generateChart({ year: 1992, month: 8, day: 20, hour: 7, gender: 'female' });
    const samplePatterns = [
      { name: '紫府朝垣', level: 'excellent' as const, palaces: ['命宫', '财帛'] },
    ];
    const chartPayload = buildChartPromptPayload(chartA, {
      targetYear: 2026,
      patterns: samplePatterns,
    });
    const chartPayloadJson = JSON.stringify(chartPayload);
    assert.ok(Buffer.byteLength(chartPayloadJson, 'utf8') < 3072);

    const chartPrompt = buildChartSystemPrompt(chartA, {
      targetYear: 2026,
      patterns: samplePatterns,
    });
    assert.ok(chartPrompt.includes(chartPayloadJson));
    assert.ok(chartPrompt.includes('紫府朝垣'));
    assert.ok(!/w\u0065nmo|\u6587\u58a8/i.test(chartPrompt));

    const chartPromptBasic = buildChartSystemPrompt(chartA);
    assert.ok(chartPromptBasic.includes(JSON.stringify(buildChartPromptPayload(chartA))));

    const synastry = analyzeSynastry(chartA, chartB, { targetYear: 2026 });
    const synPayload = buildSynastryPromptPayload(chartA, chartB, synastry);
    const synPayloadJson = JSON.stringify(synPayload);
    assert.ok(Buffer.byteLength(synPayloadJson, 'utf8') < 3072);

    const synPrompt = buildSynastrySystemPrompt(chartA, chartB, synastry, '感情走向如何？');
    assert.ok(synPrompt.includes(synPayloadJson));
    assert.ok(synPrompt.includes('感情走向如何？'));
    assert.ok(!/w\u0065nmo|\u6587\u58a8/i.test(synPrompt));

    // Missing API key / baseUrl / model fails fast with LlmConfigError across providers
    setLlmStreamAdapterForTests(null);
    await withEnv(
      {
        AI_PROVIDER: 'deepseek',
        DEEPSEEK_API_KEY: undefined,
      },
      async () => {
        await assert.rejects(
          () =>
            streamLlmSse({
              systemPrompt: chartPrompt,
              messages: [{ role: 'user', content: '请解读命盘' }],
            }),
          LlmConfigError,
        );
      },
    );

    await withEnv(
      {
        AI_PROVIDER: 'anthropic',
        ANTHROPIC_API_KEY: undefined,
      },
      async () => {
        await assert.rejects(
          () =>
            streamLlmSse({
              systemPrompt: chartPrompt,
              messages: [{ role: 'user', content: '请解读命盘' }],
            }),
          LlmConfigError,
        );
      },
    );

    await withEnv(
      {
        AI_PROVIDER: 'mimo',
        MIMO_API_KEY: 'mimo-key',
        MIMO_BASE_URL: undefined,
        MIMO_MODEL: 'mimo-model',
      },
      async () => {
        await assert.rejects(
          () =>
            streamLlmSse({
              systemPrompt: chartPrompt,
              messages: [{ role: 'user', content: '请解读命盘' }],
            }),
          LlmConfigError,
        );
      },
    );

    // Pre-aborted signal fails fast before calling upstream
    {
      const ac = new AbortController();
      ac.abort();
      await assert.rejects(
        () =>
          streamLlmSse({
            systemPrompt: chartPrompt,
            messages: [{ role: 'user', content: 'hi' }],
            signal: ac.signal,
          }),
        LlmUpstreamError,
      );
    }

    // Mock adapter SSE streaming & onComplete persistence
    let persisted = '';
    setLlmStreamAdapterForTests(async function* () {
      yield '**【命格】**\n';
      yield '紫微在命，';
      yield '格局稳健。';
    });
    try {
      const sseStream = await streamLlmSse({
        systemPrompt: chartPrompt,
        messages: [{ role: 'user', content: '生成命格总览' }],
        onComplete: async (fullText) => {
          persisted = fullText;
        },
      });
      const streamed = await readAllSseEvents(sseStream);
      assert.equal(streamed.sawDone, true);
      assert.equal(streamed.fullText, '**【命格】**\n紫微在命，格局稳健。');
      assert.equal(persisted, '**【命格】**\n紫微在命，格局稳健。');
    } finally {
      setLlmStreamAdapterForTests(null);
    }

    // Mid-stream error must NOT trigger onComplete
    let errorOnCompleteCalled = false;
    setLlmStreamAdapterForTests(async function* () {
      yield '半截内容';
      throw new LlmUpstreamError('simulated mid-stream failure', 'deepseek', 502);
    });
    try {
      const brokenStream = await streamLlmSse({
        systemPrompt: chartPrompt,
        messages: [{ role: 'user', content: '生成命格总览' }],
        onComplete: () => {
          errorOnCompleteCalled = true;
        },
      });
      await assert.rejects(() => readAllSseEvents(brokenStream), LlmUpstreamError);
      assert.equal(errorOnCompleteCalled, false);
    } finally {
      setLlmStreamAdapterForTests(null);
    }

    // OpenAI-compatible SSE parser with stubbed fetch (split frames + non-200 error)
    const originalFetch = globalThis.fetch;
    await withEnv(
      {
        AI_PROVIDER: 'deepseek',
        DEEPSEEK_API_KEY: 'test-deepseek-key',
      },
      async () => {
        try {
          globalThis.fetch = async () => {
            const encoder = new TextEncoder();
            const frames = [
              'data: {"choices":[{"delta":{"content":"第一"}}]}\n\n',
              'data: {"choices":[{"delta":{"con',
              'tent":"段"}}]}\n\ndata: [DONE]\n\n',
            ];
            let idx = 0;
            const body = new ReadableStream<Uint8Array>({
              pull(controller) {
                if (idx < frames.length) {
                  controller.enqueue(encoder.encode(frames[idx++]));
                } else {
                  controller.close();
                }
              },
            });
            return new Response(body, {
              status: 200,
              headers: { 'Content-Type': 'text/event-stream' },
            });
          };

          let completedText = '';
          const openAiStream = await streamLlmSse({
            systemPrompt: 'sys',
            messages: [{ role: 'user', content: 'hi' }],
            onComplete: (text) => {
              completedText = text;
            },
          });
          const openAiResult = await readAllSseEvents(openAiStream);
          assert.equal(openAiResult.sawDone, true);
          assert.equal(openAiResult.fullText, '第一段');
          assert.equal(completedText, '第一段');

          // Non-200 HTTP fails fast with LlmUpstreamError
          globalThis.fetch = async () => new Response('invalid api key', { status: 401 });
          await assert.rejects(
            () =>
              streamLlmSse({
                systemPrompt: 'sys',
                messages: [{ role: 'user', content: 'hi' }],
              }),
            (err: unknown) => err instanceof LlmUpstreamError && err.status === 401,
          );
        } finally {
          globalThis.fetch = originalFetch;
        }
      },
    );
  }

  console.log('✅ Stage 2 server-infra regression suite passed (env / access-token / rate-limit / db / cache / llm)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
