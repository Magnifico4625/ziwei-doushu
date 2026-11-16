import { getServerConfig, type ServerConfig } from '@/lib/server/env';
import { handleCorsPreflight, withCors } from '@/lib/server/cors';
import { extractBearerToken, verifyAccessToken } from '@/lib/server/access-token';
import {
  checkRateLimit,
  extractClientIp,
  type RateLimitRedisClient,
} from '@/lib/server/rate-limit';
import { MAX_AI_BODY_BYTES, readJsonBodyWithLimit } from '@/lib/server/request-body';
import {
  parseIanaTimeZoneField,
  parseRequestTimezoneOverride,
  parseTzAliasField,
} from '@/lib/server/timezone-input';
import {
  getSynastryInterpretation,
  saveSynastryInterpretation,
} from '@/lib/server/db';
import {
  buildSynastryRedisKey,
  canonicalPairEntitlementKey,
  canonicalPairKey,
  getCachedStreamText,
  getRedisClient,
  hashQuestion,
  scopedQuestionHash,
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
import { normalizeLang, type SupportedLang } from '@/lib/ziwei/i18n';
import { generateSynastryTeasers } from '@/lib/ziwei/paywall-teasers';
import type { ZiweiChart } from '@/lib/ziwei/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_HEMING_USER_PROMPTS: Record<SupportedLang, string> = {
  zh: '请结合双方紫微斗数命盘结构、宫位共振与飞星四化，生成完整的合盘深度分析与相处建议。',
  ru: 'Проведи полный глубокий разбор совместимости двух карт Цзы Вэй Доу Шу: резонанс дворцов, перекрёстные Сы-Хуа, сильные стороны, зоны трения и практические рекомендации.',
  en: 'Provide a comprehensive Zi Wei Dou Shu synastry analysis covering palace resonance, cross-chart Si Hua dynamics, strengths, friction points, and practical relationship guidance.',
};

type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonError(
  req: Request,
  status: number,
  error: string,
  code: string,
  message?: string,
  headers?: HeadersInit,
): Response {
  return withCors(
    req,
    Response.json(
      {
        error,
        code,
        ...(message ? { message } : {}),
      },
      { status, headers },
    ),
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

function parseLang(raw: unknown): ParseResult<SupportedLang> {
  if (raw === undefined || raw === null) {
    return { ok: true, value: 'zh' };
  }
  if (typeof raw !== 'string') {
    return { ok: false, message: "lang must be 'ru', 'zh', or 'en'" };
  }
  return { ok: true, value: normalizeLang(raw, 'zh') };
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
  const parsedTimeZone = parseIanaTimeZoneField(
    raw.birthInfo.timeZone,
    `${label}.birthInfo.timeZone`,
  );
  if (!parsedTimeZone.ok) {
    return parsedTimeZone;
  }
  const parsedTzAlias = parseTzAliasField(
    (raw.birthInfo as Record<string, unknown>).tz,
    `${label}.birthInfo.tz`,
  );
  if (!parsedTzAlias.ok) {
    return parsedTzAlias;
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

export async function OPTIONS(req: Request): Promise<Response> {
  return handleCorsPreflight(req);
}

export async function POST(req: Request): Promise<Response> {
  const bodyResult = await readJsonBodyWithLimit(req, MAX_AI_BODY_BYTES);
  if (!bodyResult.ok) {
    return jsonError(req, bodyResult.status, bodyResult.error, bodyResult.code, bodyResult.message);
  }
  const rawBody = bodyResult.value;

  const requestZoneParsed = parseRequestTimezoneOverride(req, rawBody);
  if (!requestZoneParsed.ok) {
    return jsonError(req, 400, 'invalid_timezone', 'INVALID_INPUT', requestZoneParsed.message);
  }
  const langParsed = parseLang(rawBody.lang);
  if (!langParsed.ok) {
    return jsonError(req, 400, 'invalid_lang', 'INVALID_INPUT', langParsed.message);
  }
  const chartAParsed = parseChart(rawBody.chartA, 'chartA');
  if (!chartAParsed.ok) {
    return jsonError(req, 400, 'invalid_chart', 'INVALID_INPUT', chartAParsed.message);
  }
  const chartBParsed = parseChart(rawBody.chartB, 'chartB');
  if (!chartBParsed.ok) {
    return jsonError(req, 400, 'invalid_chart', 'INVALID_INPUT', chartBParsed.message);
  }
  const targetYearParsed = parseTargetYear(rawBody.targetYear);
  if (!targetYearParsed.ok) {
    return jsonError(req, 400, 'invalid_target_year', 'INVALID_INPUT', targetYearParsed.message);
  }

  if (rawBody.question !== undefined && rawBody.question !== null && typeof rawBody.question !== 'string') {
    return jsonError(req, 400, 'invalid_question', 'INVALID_INPUT', 'question must be a string.');
  }
  if (
    rawBody.previewOnly !== undefined &&
    rawBody.previewOnly !== null &&
    typeof rawBody.previewOnly !== 'boolean'
  ) {
    return jsonError(req, 400, 'invalid_preview_flag', 'INVALID_INPUT', 'previewOnly must be a boolean.');
  }

  const lang = langParsed.value;
  const chartA = chartAParsed.value;
  const chartB = chartBParsed.value;
  const targetYear = targetYearParsed.value;
  const question =
    typeof rawBody.question === 'string' && rawBody.question.trim().length > 0
      ? rawBody.question.trim()
      : undefined;

  const pairKey = canonicalPairKey(chartA, chartB, targetYear);
  const entitlementKey = canonicalPairEntitlementKey(chartA, chartB);
  const synastry = analyzeSynastry(chartA, chartB, { targetYear });

  // Zero-LLM deterministic synastry preview with localized teasers & overview
  if (rawBody.previewOnly === true) {
    const teasers = generateSynastryTeasers(synastry, lang);
    return withCors(
      req,
      Response.json(
        {
          ok: true,
          lang,
          pairKey,
          entitlementKey,
          synastry,
          overview: teasers.overview,
          teasers,
        },
        { status: 200 },
      ),
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
      req,
      429,
      'rate_limit_exceeded',
      'RATE_LIMITED',
      'Too many synastry requests; please retry shortly.',
      { 'Retry-After': String(rl.retryAfterSeconds) },
    );
  }

  // Strict paywall guard BEFORE cache read or LLM invocation.
  // Requires a valid signed accessToken bound to the year- & language-agnostic entitlementKey.
  if (cfg.aiPaywallMode === 'strict') {
    const token = extractBearerToken(req, rawBody.accessToken);
    const authorized =
      token !== null &&
      verifyAccessToken(token, 'heming', entitlementKey, cfg.accessTokenSecret).valid;

    if (!authorized) {
      return withCors(
        req,
        Response.json(
          {
            error: 'payment_required',
            code: 'PAYWALL_LOCKED',
            pairKey,
            entitlementKey,
          },
          { status: 402 },
        ),
      );
    }
  }

  const questionHash = hashQuestion(question);
  const scopedQHash = scopedQuestionHash(questionHash, lang);
  const redisKey = buildSynastryRedisKey(pairKey, questionHash, lang);

  const redisHit = await getCachedStreamText(redisKey);
  if (redisHit !== null) {
    return withCors(
      req,
      new Response(createSseFromCachedText(redisHit), {
        status: 200,
        headers: {
          ...SSE_HEADERS,
          'X-Cache': 'HIT',
        },
      }),
    );
  }

  const pgHit = await getSynastryInterpretation(pairKey, scopedQHash);
  if (pgHit !== null) {
    await setCachedStreamText(redisKey, pgHit.content).catch(() => undefined);
    return withCors(
      req,
      new Response(createSseFromCachedText(pgHit.content), {
        status: 200,
        headers: {
          ...SSE_HEADERS,
          'X-Cache': 'HIT',
        },
      }),
    );
  }

  const systemPrompt = buildSynastrySystemPrompt(chartA, chartB, synastry, question, lang);
  const model = resolveModelName(cfg);

  try {
    const stream = await streamLlmSse({
      systemPrompt,
      messages: [
        {
          role: 'user',
          content: question ?? DEFAULT_HEMING_USER_PROMPTS[lang],
        },
      ],
      lang,
      signal: req.signal,
      onComplete: async (fullText: string) => {
        if (fullText.trim().length === 0) return;
        await Promise.all([
          setCachedStreamText(redisKey, fullText).catch(() => undefined),
          saveSynastryInterpretation({
            pairKey,
            questionHash: scopedQHash,
            content: fullText,
            provider: cfg.aiProvider,
            model,
          }).catch(() => undefined),
        ]);
      },
    });

    return withCors(
      req,
      new Response(stream, {
        status: 200,
        headers: {
          ...SSE_HEADERS,
          'X-Cache': 'MISS',
        },
      }),
    );
  } catch (err) {
    if (err instanceof LlmConfigError) {
      return jsonError(
        req,
        503,
        'llm_not_configured',
        err.code,
        'AI synastry service is not configured.',
      );
    }
    if (err instanceof LlmUpstreamError) {
      return jsonError(
        req,
        502,
        'llm_upstream_error',
        err.code,
        'Upstream AI synastry provider returned an error.',
      );
    }
    return jsonError(
      req,
      500,
      'internal_error',
      'INTERNAL_ERROR',
      'Unexpected error starting stream.',
    );
  }
}
