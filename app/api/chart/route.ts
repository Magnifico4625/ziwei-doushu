import { getServerConfig } from '@/lib/server/env';
import {
  checkRateLimit,
  extractClientIp,
  type RateLimitRedisClient,
} from '@/lib/server/rate-limit';
import {
  getChartInterpretation,
  getSynastryInterpretation,
} from '@/lib/server/db';
import { canonicalPairKey, getRedisClient, hashQuestion } from '@/lib/server/cache';
import { generateChart } from '@/lib/ziwei/algorithm';
import {
  analyzeChartSummary,
  getChartCacheKey,
  type PatternSummary,
} from '@/lib/ziwei/chart-analyzer';
import { isValidGregorianDate } from '@/lib/ziwei/gregorian-date';
import { analyzeSynastry } from '@/lib/ziwei/heming';
import { formToBirthInfo } from '@/lib/ziwei/share';
import type { LateZishiRule } from '@/lib/ziwei/true-solar-time';
import type { BirthFormState, BirthInfo, ZiweiChart } from '@/lib/ziwei/types';

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

function parseOptionalTargetYear(raw: unknown): ParseResult<number | undefined> {
  if (raw === undefined || raw === null) {
    return { ok: true, value: undefined };
  }
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 100 || raw > 9999) {
    return { ok: false, message: 'targetYear must be an integer between 100 and 9999' };
  }
  return { ok: true, value: raw };
}

function parseLateZishi(raw: unknown): ParseResult<LateZishiRule> {
  if (raw === undefined || raw === null) {
    return { ok: true, value: 'next-day' };
  }
  if (raw === 'next-day' || raw === 'current-day') {
    return { ok: true, value: raw };
  }
  return { ok: false, message: "lateZishi must be 'next-day' or 'current-day'" };
}

function parseBirthInfo(raw: unknown): ParseResult<BirthInfo> {
  if (!isPlainRecord(raw)) {
    return { ok: false, message: 'birthInfo must be an object' };
  }
  const { year, month, day, hour, gender } = raw;
  if (
    typeof year !== 'number' ||
    typeof month !== 'number' ||
    typeof day !== 'number' ||
    !isValidGregorianDate(year, month, day)
  ) {
    return { ok: false, message: 'Invalid or nonexistent Gregorian birth date' };
  }
  if (typeof hour !== 'number' || !Number.isInteger(hour) || hour < 0 || hour > 11) {
    return { ok: false, message: 'birthInfo.hour must be an integer from 0 to 11' };
  }
  if (gender !== 'male' && gender !== 'female') {
    return { ok: false, message: "birthInfo.gender must be 'male' or 'female'" };
  }
  if (raw.longitude !== undefined) {
    if (typeof raw.longitude !== 'number' || !Number.isFinite(raw.longitude) || raw.longitude < -180 || raw.longitude > 180) {
      return { ok: false, message: 'birthInfo.longitude must be within [-180, 180]' };
    }
  }
  if (raw.utcOffsetMinutes !== undefined) {
    if (
      typeof raw.utcOffsetMinutes !== 'number' ||
      !Number.isInteger(raw.utcOffsetMinutes) ||
      raw.utcOffsetMinutes < -720 ||
      raw.utcOffsetMinutes > 840
    ) {
      return { ok: false, message: 'birthInfo.utcOffsetMinutes must be an integer in [-720, 840]' };
    }
  }

  return {
    ok: true,
    value: {
      year,
      month,
      day,
      hour,
      gender,
      ...(typeof raw.name === 'string' && raw.name ? { name: raw.name } : {}),
      ...(typeof raw.province === 'string' && raw.province ? { province: raw.province } : {}),
      ...(typeof raw.city === 'string' && raw.city ? { city: raw.city } : {}),
      ...(typeof raw.longitude === 'number' ? { longitude: raw.longitude } : {}),
      ...(typeof raw.utcOffsetMinutes === 'number'
        ? { utcOffsetMinutes: raw.utcOffsetMinutes }
        : {}),
      ...(typeof raw.timeZone === 'string' ? { timeZone: raw.timeZone } : {}),
    },
  };
}

function parseStrictDigits(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseBirthForm(raw: unknown): ParseResult<BirthFormState> {
  if (!isPlainRecord(raw)) {
    return { ok: false, message: 'form must be an object' };
  }
  const yearNum = parseStrictDigits(raw.year);
  const monthNum = parseStrictDigits(raw.month);
  const dayNum = parseStrictDigits(raw.day);
  if (
    yearNum === null ||
    monthNum === null ||
    dayNum === null ||
    !isValidGregorianDate(yearNum, monthNum, dayNum)
  ) {
    return { ok: false, message: 'Invalid or nonexistent Gregorian date in form' };
  }

  const unknownTime = typeof raw.unknownTime === 'boolean' ? raw.unknownTime : false;
  if (raw.unknownTime !== undefined && typeof raw.unknownTime !== 'boolean') {
    return { ok: false, message: 'form.unknownTime must be a boolean' };
  }

  let clockHourStr = '0';
  let clockMinuteStr = '0';
  if (!unknownTime) {
    const ch = parseStrictDigits(raw.clockHour);
    const cm = parseStrictDigits(raw.clockMinute);
    if (ch === null || ch < 0 || ch > 23) {
      return { ok: false, message: 'form.clockHour must be an integer string in 0..23' };
    }
    if (cm === null || cm < 0 || cm > 59) {
      return { ok: false, message: 'form.clockMinute must be an integer string in 0..59' };
    }
    clockHourStr = String(ch);
    clockMinuteStr = String(cm);
  }

  if (raw.gender !== 'male' && raw.gender !== 'female') {
    return { ok: false, message: "form.gender must be 'male' or 'female'" };
  }

  const longitude = raw.longitude === undefined ? 120 : raw.longitude;
  if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return { ok: false, message: 'form.longitude must be a finite number in [-180, 180]' };
  }

  if (raw.utcOffsetMinutes !== undefined) {
    if (
      typeof raw.utcOffsetMinutes !== 'number' ||
      !Number.isInteger(raw.utcOffsetMinutes) ||
      raw.utcOffsetMinutes < -720 ||
      raw.utcOffsetMinutes > 840
    ) {
      return { ok: false, message: 'form.utcOffsetMinutes must be an integer in [-720, 840]' };
    }
  }
  if (raw.timeZone !== undefined && typeof raw.timeZone !== 'string') {
    return { ok: false, message: 'form.timeZone must be a string' };
  }

  return {
    ok: true,
    value: {
      name: typeof raw.name === 'string' ? raw.name : '',
      year: String(yearNum),
      month: String(monthNum),
      day: String(dayNum),
      clockHour: clockHourStr,
      clockMinute: clockMinuteStr,
      unknownTime,
      province: typeof raw.province === 'string' ? raw.province : '',
      city: typeof raw.city === 'string' ? raw.city : '',
      longitude,
      ...(typeof raw.utcOffsetMinutes === 'number'
        ? { utcOffsetMinutes: raw.utcOffsetMinutes }
        : {}),
      ...(typeof raw.timeZone === 'string' ? { timeZone: raw.timeZone } : {}),
      gender: raw.gender,
    },
  };
}

function parseChartObject(raw: unknown): ParseResult<ZiweiChart> {
  if (!isPlainRecord(raw)) {
    return { ok: false, message: 'chart must be an object' };
  }
  const birthParsed = parseBirthInfo(raw.birthInfo);
  if (!birthParsed.ok) {
    return { ok: false, message: `chart.${birthParsed.message}` };
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

function resolveChartInput(
  chartRaw: unknown,
  birthInfoRaw: unknown,
  formRaw: unknown,
  lateZishi: LateZishiRule,
): ParseResult<ZiweiChart> {
  if (chartRaw !== undefined) {
    return parseChartObject(chartRaw);
  }
  if (formRaw !== undefined) {
    const parsedForm = parseBirthForm(formRaw);
    if (!parsedForm.ok) return parsedForm;
    try {
      const info = formToBirthInfo(parsedForm.value, lateZishi);
      return { ok: true, value: generateChart(info) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid birth form input';
      return { ok: false, message: msg };
    }
  }
  if (birthInfoRaw !== undefined) {
    const parsedInfo = parseBirthInfo(birthInfoRaw);
    if (!parsedInfo.ok) return parsedInfo;
    try {
      return { ok: true, value: generateChart(parsedInfo.value) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid birthInfo input';
      return { ok: false, message: msg };
    }
  }
  return { ok: false, message: 'Missing chart, birthInfo, or form input' };
}

export async function POST(req: Request): Promise<Response> {
  const cfg = getServerConfig();
  const ip = extractClientIp(req);
  const rl = await checkRateLimit({
    key: `chart:${ip}`,
    limit: cfg.chartRateLimitPerMin,
    windowSeconds: 60,
    redis: getRateLimitRedis(),
  });
  if (!rl.allowed) {
    return jsonError(
      429,
      'rate_limit_exceeded',
      'RATE_LIMITED',
      'Too many chart requests; please retry shortly.',
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

  const targetYearParsed = parseOptionalTargetYear(rawBody.targetYear);
  if (!targetYearParsed.ok) {
    return jsonError(400, 'invalid_target_year', 'INVALID_INPUT', targetYearParsed.message);
  }
  const lateZishiParsed = parseLateZishi(rawBody.lateZishi);
  if (!lateZishiParsed.ok) {
    return jsonError(400, 'invalid_late_zishi', 'INVALID_INPUT', lateZishiParsed.message);
  }

  const targetYear = targetYearParsed.value;
  const lateZishi = lateZishiParsed.value;

  const hasSynastryFields =
    rawBody.chartA !== undefined ||
    rawBody.chartB !== undefined ||
    rawBody.formA !== undefined ||
    rawBody.formB !== undefined ||
    rawBody.birthInfoA !== undefined ||
    rawBody.birthInfoB !== undefined;

  if (hasSynastryFields) {
    const resolvedA = resolveChartInput(
      rawBody.chartA,
      rawBody.birthInfoA,
      rawBody.formA,
      lateZishi,
    );
    if (!resolvedA.ok) {
      return jsonError(400, 'invalid_synastry_input', 'INVALID_INPUT', `Partner A: ${resolvedA.message}`);
    }
    const resolvedB = resolveChartInput(
      rawBody.chartB,
      rawBody.birthInfoB,
      rawBody.formB,
      lateZishi,
    );
    if (!resolvedB.ok) {
      return jsonError(400, 'invalid_synastry_input', 'INVALID_INPUT', `Partner B: ${resolvedB.message}`);
    }

    const chartA = resolvedA.value;
    const chartB = resolvedB.value;
    const pairKey = canonicalPairKey(chartA, chartB, targetYear);
    const synastry = analyzeSynastry(chartA, chartB, { targetYear });
    const hasCachedInterpretation = Boolean(
      (await getSynastryInterpretation(pairKey, hashQuestion())) ??
      (await getSynastryInterpretation(pairKey)),
    );

    return Response.json(
      {
        ok: true,
        mode: 'synastry',
        pairKey,
        chartA,
        chartB,
        synastry,
        hasCachedInterpretation,
      },
      { status: 200 },
    );
  }

  if (rawBody.form === undefined && rawBody.birthInfo === undefined) {
    return jsonError(
      400,
      'missing_birth_input',
      'INVALID_INPUT',
      'Provide birthInfo or form for natal chart generation, or partner A/B inputs for synastry.',
    );
  }

  const resolvedNatal = resolveChartInput(undefined, rawBody.birthInfo, rawBody.form, lateZishi);
  if (!resolvedNatal.ok) {
    return jsonError(400, 'invalid_birth_input', 'INVALID_INPUT', resolvedNatal.message);
  }

  const chart = resolvedNatal.value;
  const cacheKey = getChartCacheKey(chart, { targetYear });
  const summary = analyzeChartSummary(chart, { targetYear });
  const patterns = await detectPatternsSafe(chart);
  const topicKey = typeof rawBody.topicKey === 'string' && rawBody.topicKey.trim().length > 0
    ? rawBody.topicKey.trim()
    : undefined;
  const cached = Boolean(await getChartInterpretation(cacheKey, topicKey));

  return Response.json(
    {
      ok: true,
      mode: 'natal',
      cacheKey,
      chart,
      summary,
      patterns,
      hasCachedInterpretation: cached,
    },
    { status: 200 },
  );
}
