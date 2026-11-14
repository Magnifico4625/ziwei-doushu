import { getServerConfig, type ServerConfig } from '@/lib/server/env';
import { extractBearerToken, verifyAccessToken } from '@/lib/server/access-token';
import {
  checkRateLimit,
  extractClientIp,
  type RateLimitRedisClient,
} from '@/lib/server/rate-limit';
import {
  getSynastryInterpretation,
  hasPaidEntitlement,
  saveSynastryInterpretation,
} from '@/lib/server/db';
import {
  buildSynastryRedisKey,
  canonicalPairKey,
  getCachedStreamText,
  getRedisClient,
  hashQuestion,
  setCachedStreamText,
} from '@/lib/server/cache';
import {
  buildSynastrySystemPrompt,
  createSseFromCachedText,
  LlmConfigError,
  LlmUpstreamError,
  SSE_HEADERS,
  streamLlmSse,
} from '@/lib/server/llm';
import { isValidGregorianDate } from '@/lib/ziwei/gregorian-date';
import { analyzeSynastry } from '@/lib/ziwei/heming';
import type { ZiweiChart } from '@/lib/ziwei/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_HEMING_USER_PROMPT =
  '请结合双方紫微斗数命盘结构、宫位共振与飞星四化，生成完整的合盘深度分析与相处建议。';

type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonError(
  status: number,
  error: string,
  code: string,
  message?: string,
  headers?: HeadersInit,
): Response {
  return Response.json(
    {
      error,
      code,
      ...(message ? { message } : {}),
    },
    { status, headers },
  );
}

function getRateLimitRedis(): RateLimitRedisClient | null {
  const client = getRedisClient();
  if (!client) return null;
  return {
    incr: (key: string) => client.incr(key),
    expire: (key: string, seconds: number) => client.expire(key, seconds),
    eval: (...args: unknown[]) => {
      const [script, numKeys, ...rest] = args;
      if (typeof script !== 'string' || typeof numKeys !== 'number') {
        return Promise.resolve(null);
      }
      const evalArgs = rest.filter(
        (v): v is string | number => typeof v === 'string' || typeof v === 'number',
      );
      return client.eval(script, numKeys, ...evalArgs);
    },
  };
}

function resolveModelName(cfg: ServerConfig): string | undefined {
  switch (cfg.aiProvider) {
    case 'anthropic':
      return cfg.anthropicModel;
    case 'deepseek':
      return cfg.deepseekModel;
    case 'mimo':
      return cfg.mimoModel;
    case 'openai-compatible':
      return cfg.openaiModel;
  }
}

function parseChart(raw: unknown, label: string): ParseResult<ZiweiChart> {
  if (!isPlainRecord(raw)) {
    return { ok: false, message: `${label} must be an object` };
  }
  if (!isPlainRecord(raw.birthInfo)) {
    return { ok: false, message: `${label}.birthInfo is required` };
  }
  const { year, month, day, hour, gender } = raw.birthInfo;
  if (
    typeof year !== 'number' ||
    typeof month !== 'number' ||
    typeof day !== 'number' ||
    !isValidGregorianDate(year, month, day)
  ) {
    return { ok: false, message: `${label}.birthInfo contains an invalid Gregorian date` };
  }
  if (typeof hour !== 'number' || !Number.isInteger(hour) || hour < 0 || hour > 11) {
    return { ok: false, message: `${label}.birthInfo.hour must be an integer from 0 to 11` };
  }
  if (gender !== 'male' && gender !== 'female') {
    return { ok: false, message: `${label}.birthInfo.gender must be 'male' or 'female'` };
  }
  if (!isPlainRecord(raw.lunarInfo)) {
    return { ok: false, message: `${label}.lunarInfo is required` };
  }
  const { yearStem, yearBranch, lunarYear, lunarMonth, lunarDay, isLeapMonth } = raw.lunarInfo;
  if (
    typeof yearStem !== 'number' ||
    !Number.isInteger(yearStem) ||
    yearStem < 0 ||
    yearStem > 9 ||
    typeof yearBranch !== 'number' ||
    !Number.isInteger(yearBranch) ||
    yearBranch < 0 ||
    yearBranch > 11 ||
    typeof lunarYear !== 'number' ||
    typeof lunarMonth !== 'number' ||
    typeof lunarDay !== 'number' ||
    typeof isLeapMonth !== 'boolean'
  ) {
    return { ok: false, message: `${label}.lunarInfo has invalid fields` };
  }
  if (
    typeof raw.mingGongBranch !== 'number' ||
    !Number.isInteger(raw.mingGongBranch) ||
    raw.mingGongBranch < 0 ||
    raw.mingGongBranch > 11 ||
    typeof raw.shenGongBranch !== 'number' ||
    !Number.isInteger(raw.shenGongBranch) ||
    raw.shenGongBranch < 0 ||
    raw.shenGongBranch > 11
  ) {
    return { ok: false, message: `${label} branch indices must be integers in 0..11` };
  }
  if (!Array.isArray(raw.palaces) || raw.palaces.length !== 12) {
    return { ok: false, message: `${label}.palaces must contain 12 palaces` };
  }
  for (const palace of raw.palaces) {
    if (
      !isPlainRecord(palace) ||
      typeof palace.branch !== 'number' ||
      typeof palace.stem !== 'number' ||
      typeof palace.name !== 'string' ||
      !Array.isArray(palace.stars)
    ) {
      return { ok: false, message: `${label}.palaces contains malformed palace entry` };
    }
  }
  if (!Array.isArray(raw.daXians)) {
    return { ok: false, message: `${label}.daXians must be an array` };
  }
  return { ok: true, value: raw as unknown as ZiweiChart };
}

function parseTargetYear(raw: unknown): ParseResult<number | undefined> {
  if (raw === undefined || raw === null) {
    return { ok: true, value: undefined };
  }
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 100 || raw > 9999) {
    return { ok: false, message: 'targetYear must be an integer between 100 and 9999' };
  }
  return { ok: true, value: raw };
}

export async function POST(req: Request): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonError(400, 'invalid_json', 'BAD_REQUEST', 'Request body must be valid JSON.');
  }

  if (!isPlainRecord(rawBody)) {
    return jsonError(400, 'invalid_body', 'BAD_REQUEST', 'Request body must be a JSON object.');
  }

  const chartAParsed = parseChart(rawBody.chartA, 'chartA');
  if (!chartAParsed.ok) {
    return jsonError(400, 'invalid_chart', 'INVALID_INPUT', chartAParsed.message);
  }
  const chartBParsed = parseChart(rawBody.chartB, 'chartB');
  if (!chartBParsed.ok) {
    return jsonError(400, 'invalid_chart', 'INVALID_INPUT', chartBParsed.message);
  }
  const targetYearParsed = parseTargetYear(rawBody.targetYear);
  if (!targetYearParsed.ok) {
    return jsonError(400, 'invalid_target_year', 'INVALID_INPUT', targetYearParsed.message);
  }

  if (rawBody.question !== undefined && rawBody.question !== null && typeof rawBody.question !== 'string') {
    return jsonError(400, 'invalid_question', 'INVALID_INPUT', 'question must be a string.');
  }
  if (
    rawBody.previewOnly !== undefined &&
    rawBody.previewOnly !== null &&
    typeof rawBody.previewOnly !== 'boolean'
  ) {
    return jsonError(400, 'invalid_preview_flag', 'INVALID_INPUT', 'previewOnly must be a boolean.');
  }

  const chartA = chartAParsed.value;
  const chartB = chartBParsed.value;
  const targetYear = targetYearParsed.value;
  const question =
    typeof rawBody.question === 'string' && rawBody.question.trim().length > 0
      ? rawBody.question.trim()
      : undefined;

  const pairKey = canonicalPairKey(chartA, chartB, targetYear);
  const synastry = analyzeSynastry(chartA, chartB, { targetYear });

  // Zero-LLM deterministic synastry preview
  if (rawBody.previewOnly === true) {
    return Response.json(
      {
        ok: true,
        pairKey,
        synastry,
      },
      { status: 200 },
    );
  }

  const cfg = getServerConfig();
  const ip = extractClientIp(req);
  const rl = await checkRateLimit({
    key: `heming:${ip}`,
    limit: cfg.interpretRateLimitPerMin,
    windowSeconds: 60,
    redis: getRateLimitRedis(),
  });
  if (!rl.allowed) {
    return jsonError(
      429,
      'rate_limit_exceeded',
      'RATE_LIMITED',
      'Too many synastry requests; please retry shortly.',
      { 'Retry-After': String(rl.retryAfterSeconds) },
    );
  }

  // Strict paywall guard BEFORE cache read or LLM invocation.
  if (cfg.aiPaywallMode === 'strict') {
    const token = extractBearerToken(req, rawBody.accessToken);
    let authorized = false;
    if (token !== null) {
      authorized = verifyAccessToken(token, 'heming', pairKey, cfg.accessTokenSecret).valid;
    } else {
      authorized = await hasPaidEntitlement('heming', pairKey);
    }

    if (!authorized) {
      return Response.json(
        {
          error: 'payment_required',
          code: 'PAYWALL_LOCKED',
          pairKey,
        },
        { status: 402 },
      );
    }
  }

  const questionHash = hashQuestion(question);
  const redisKey = buildSynastryRedisKey(pairKey, questionHash);

  const redisHit = await getCachedStreamText(redisKey);
  if (redisHit !== null) {
    return new Response(createSseFromCachedText(redisHit), {
      status: 200,
      headers: {
        ...SSE_HEADERS,
        'X-Cache': 'HIT',
      },
    });
  }

  const pgHit = await getSynastryInterpretation(pairKey, questionHash);
  if (pgHit !== null) {
    await setCachedStreamText(redisKey, pgHit.content).catch(() => undefined);
    return new Response(createSseFromCachedText(pgHit.content), {
      status: 200,
      headers: {
        ...SSE_HEADERS,
        'X-Cache': 'HIT',
      },
    });
  }

  const systemPrompt = buildSynastrySystemPrompt(chartA, chartB, synastry, question);
  const model = resolveModelName(cfg);

  try {
    const stream = await streamLlmSse({
      systemPrompt,
      messages: [
        {
          role: 'user',
          content: question ?? DEFAULT_HEMING_USER_PROMPT,
        },
      ],
      signal: req.signal,
      onComplete: async (fullText: string) => {
        if (fullText.trim().length === 0) return;
        await Promise.all([
          setCachedStreamText(redisKey, fullText).catch(() => undefined),
          saveSynastryInterpretation({
            pairKey,
            questionHash,
            content: fullText,
            provider: cfg.aiProvider,
            model,
          }).catch(() => undefined),
        ]);
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        ...SSE_HEADERS,
        'X-Cache': 'MISS',
      },
    });
  } catch (err) {
    if (err instanceof LlmConfigError) {
      return jsonError(
        503,
        'llm_not_configured',
        err.code,
        'AI synastry service is not configured.',
      );
    }
    if (err instanceof LlmUpstreamError) {
      return jsonError(
        502,
        'llm_upstream_error',
        err.code,
        'Upstream AI synastry provider returned an error.',
      );
    }
    return jsonError(500, 'internal_error', 'INTERNAL_ERROR', 'Unexpected error starting stream.');
  }
}
