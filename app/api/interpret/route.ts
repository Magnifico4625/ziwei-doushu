import { getServerConfig, type ServerConfig } from '@/lib/server/env';
import { extractBearerToken, verifyAccessToken } from '@/lib/server/access-token';
import {
  checkRateLimit,
  extractClientIp,
  type RateLimitRedisClient,
} from '@/lib/server/rate-limit';
import {
  getChartInterpretation,
  hasPaidEntitlement,
  saveChartInterpretation,
} from '@/lib/server/db';
import {
  buildInterpretRedisKey,
  getCachedStreamText,
  getRedisClient,
  hashPromptMessages,
  setCachedStreamText,
} from '@/lib/server/cache';
import {
  buildChartSystemPrompt,
  createSseFromCachedText,
  LlmConfigError,
  LlmUpstreamError,
  SSE_HEADERS,
  streamLlmSse,
  type ChatMessage,
} from '@/lib/server/llm';
import {
  getChartCacheKey,
  type PatternSummary,
} from '@/lib/ziwei/chart-analyzer';
import { isValidGregorianDate } from '@/lib/ziwei/gregorian-date';
import type { ZiweiChart } from '@/lib/ziwei/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

async function detectPatternsSafe(chart: ZiweiChart): Promise<PatternSummary[]> {
  try {
    const m = await import('@/lib/ziwei/patterns');
    return m.detectPatterns(chart);
  } catch {
    return [];
  }
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

function parseChart(raw: unknown): ParseResult<ZiweiChart> {
  if (!isPlainRecord(raw)) {
    return { ok: false, message: 'chart must be an object' };
  }
  if (!isPlainRecord(raw.birthInfo)) {
    return { ok: false, message: 'chart.birthInfo is required' };
  }
  const { year, month, day, hour, gender } = raw.birthInfo;
  if (
    typeof year !== 'number' ||
    typeof month !== 'number' ||
    typeof day !== 'number' ||
    !isValidGregorianDate(year, month, day)
  ) {
    return { ok: false, message: 'chart.birthInfo contains an invalid Gregorian date' };
  }
  if (typeof hour !== 'number' || !Number.isInteger(hour) || hour < 0 || hour > 11) {
    return { ok: false, message: 'chart.birthInfo.hour must be an integer from 0 to 11' };
  }
  if (gender !== 'male' && gender !== 'female') {
    return { ok: false, message: "chart.birthInfo.gender must be 'male' or 'female'" };
  }
  if (!isPlainRecord(raw.lunarInfo)) {
    return { ok: false, message: 'chart.lunarInfo is required' };
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
    return { ok: false, message: 'chart.lunarInfo has invalid fields' };
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
    return { ok: false, message: 'chart branch indices must be integers in 0..11' };
  }
  if (!Array.isArray(raw.palaces) || raw.palaces.length !== 12) {
    return { ok: false, message: 'chart.palaces must contain 12 palaces' };
  }
  for (const palace of raw.palaces) {
    if (
      !isPlainRecord(palace) ||
      typeof palace.branch !== 'number' ||
      typeof palace.stem !== 'number' ||
      typeof palace.name !== 'string' ||
      !Array.isArray(palace.stars)
    ) {
      return { ok: false, message: 'chart.palaces contains malformed palace entry' };
    }
  }
  if (!Array.isArray(raw.daXians)) {
    return { ok: false, message: 'chart.daXians must be an array' };
  }
  return { ok: true, value: raw as unknown as ZiweiChart };
}

function parseMessages(raw: unknown): ParseResult<ChatMessage[]> {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 50) {
    return { ok: false, message: 'messages must be a non-empty array (max 50 entries)' };
  }
  const out: ChatMessage[] = [];
  let hasUser = false;
  for (const entry of raw) {
    if (!isPlainRecord(entry)) {
      return { ok: false, message: 'each message must be an object' };
    }
    if (entry.role !== 'user' && entry.role !== 'assistant') {
      return { ok: false, message: "message.role must be 'user' or 'assistant'" };
    }
    if (typeof entry.content !== 'string' || entry.content.trim().length === 0) {
      return { ok: false, message: 'message.content must be a non-empty string' };
    }
    if (entry.role === 'user') hasUser = true;
    out.push({ role: entry.role, content: entry.content });
  }
  if (!hasUser) {
    return { ok: false, message: 'at least one user message is required' };
  }
  return { ok: true, value: out };
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
  const cfg = getServerConfig();
  const ip = extractClientIp(req);
  const rl = await checkRateLimit({
    key: `interpret:${ip}`,
    limit: cfg.interpretRateLimitPerMin,
    windowSeconds: 60,
    redis: getRateLimitRedis(),
  });
  if (!rl.allowed) {
    return jsonError(
      429,
      'rate_limit_exceeded',
      'RATE_LIMITED',
      'Too many interpretation requests; please retry shortly.',
      { 'Retry-After': String(rl.retryAfterSeconds) },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonError(400, 'invalid_json', 'BAD_REQUEST', 'Request body must be valid JSON.');
  }

  if (!isPlainRecord(rawBody)) {
    return jsonError(400, 'invalid_body', 'BAD_REQUEST', 'Request body must be a JSON object.');
  }

  const chartParsed = parseChart(rawBody.chart);
  if (!chartParsed.ok) {
    return jsonError(400, 'invalid_chart', 'INVALID_INPUT', chartParsed.message);
  }
  const messagesParsed = parseMessages(rawBody.messages);
  if (!messagesParsed.ok) {
    return jsonError(400, 'invalid_messages', 'INVALID_INPUT', messagesParsed.message);
  }
  const targetYearParsed = parseTargetYear(rawBody.targetYear);
  if (!targetYearParsed.ok) {
    return jsonError(400, 'invalid_target_year', 'INVALID_INPUT', targetYearParsed.message);
  }

  const chart = chartParsed.value;
  const messages = messagesParsed.value;
  const targetYear = targetYearParsed.value;
  const chartKey = getChartCacheKey(chart, { targetYear });

  // Strict paywall guard BEFORE every cache read or LLM invocation.
  if (cfg.aiPaywallMode === 'strict') {
    const token = extractBearerToken(req, rawBody.accessToken);
    let authorized = false;
    if (token !== null) {
      authorized = verifyAccessToken(token, 'interpret', chartKey, cfg.accessTokenSecret).valid;
    } else {
      authorized = await hasPaidEntitlement('interpret', chartKey);
    }

    if (!authorized) {
      return Response.json(
        {
          error: 'payment_required',
          code: 'PAYWALL_LOCKED',
          cacheKey: chartKey,
        },
        { status: 402 },
      );
    }
  }

  const msgHash = hashPromptMessages(messages);
  const redisKey = buildInterpretRedisKey(chartKey, msgHash);

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

  const pgHit = await getChartInterpretation(chartKey, msgHash);
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

  const patterns = await detectPatternsSafe(chart);
  const systemPrompt = buildChartSystemPrompt(chart, { targetYear, patterns });
  const model = resolveModelName(cfg);

  try {
    const stream = await streamLlmSse({
      systemPrompt,
      messages,
      signal: req.signal,
      onComplete: async (fullText: string) => {
        if (fullText.trim().length === 0) return;
        await Promise.all([
          setCachedStreamText(redisKey, fullText).catch(() => undefined),
          saveChartInterpretation({
            cacheKey: chartKey,
            topicKey: msgHash,
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
        'AI interpretation service is not configured.',
      );
    }
    if (err instanceof LlmUpstreamError) {
      return jsonError(
        502,
        'llm_upstream_error',
        err.code,
        'Upstream AI interpretation provider returned an error.',
      );
    }
    return jsonError(500, 'internal_error', 'INTERNAL_ERROR', 'Unexpected error starting stream.');
  }
}
