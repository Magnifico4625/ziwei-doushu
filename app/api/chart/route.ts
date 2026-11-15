import { getServerConfig } from '@/lib/server/env';
import { handleCorsPreflight, withCors } from '@/lib/server/cors';
import {
  checkRateLimit,
  extractClientIp,
  type RateLimitRedisClient,
} from '@/lib/server/rate-limit';
import {
  getChartInterpretation,
  getSynastryInterpretation,
} from '@/lib/server/db';
import {
  canonicalPairKey,
  getRedisClient,
  hashQuestion,
  scopedQuestionHash,
  scopedTopicKey,
} from '@/lib/server/cache';
import { generateChart } from '@/lib/ziwei/algorithm';
import {
  analyzeChartSummary,
  getChartCacheKey,
} from '@/lib/ziwei/chart-analyzer';
import {
  findCityByQuery,
  findCityInfo,
  getCityDisplayName,
} from '@/lib/ziwei/cities';
import { isValidGregorianDate } from '@/lib/ziwei/gregorian-date';
import { analyzeSynastry } from '@/lib/ziwei/heming';
import {
  normalizeLang,
  translateChartSummary,
  type SupportedLang,
} from '@/lib/ziwei/i18n';
import { detectPatterns } from '@/lib/ziwei/patterns';
import {
  generateChartTeasers,
  generateSynastryTeasers,
} from '@/lib/ziwei/paywall-teasers';
import { formToBirthInfo } from '@/lib/ziwei/share';
import type { LateZishiRule } from '@/lib/ziwei/true-solar-time';
import type { BirthFormState, BirthInfo, ZiweiChart } from '@/lib/ziwei/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

interface ResolvedCityLocation {
  province: string;
  city: string;
  longitude?: number;
  utcOffsetMinutes?: number;
  timeZone?: string;
}

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

function parseLang(raw: unknown): ParseResult<SupportedLang> {
  if (raw === undefined || raw === null) {
    return { ok: true, value: 'zh' };
  }
  if (typeof raw !== 'string') {
    return { ok: false, message: "lang must be 'ru', 'zh', or 'en'" };
  }
  return { ok: true, value: normalizeLang(raw, 'zh') };
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

function resolveCityLocation(
  rawProvince: string,
  rawCity: string,
  lang: SupportedLang,
): ResolvedCityLocation {
  const province = rawProvince.trim();
  const city = rawCity.trim();
  if (!city) {
    return { province, city };
  }

  const direct = province ? findCityInfo(province, city) : undefined;
  if (direct) {
    return {
      province,
      city,
      longitude: direct.longitude,
      utcOffsetMinutes: direct.utcOffsetMinutes,
      timeZone: direct.timeZone,
    };
  }

  const queried = findCityByQuery(city, lang);
  if (queried) {
    return {
      province: queried.provinceName,
      city: queried.city.name,
      longitude: queried.city.longitude,
      utcOffsetMinutes: queried.city.utcOffsetMinutes,
      timeZone: queried.city.timeZone,
    };
  }

  return { province, city };
}

function resolveLocalizedCityDisplay(
  chart: ZiweiChart,
  lang: SupportedLang,
): string | undefined {
  const rawCity = chart.birthInfo.city?.trim();
  if (!rawCity) return undefined;
  const direct = chart.birthInfo.province
    ? findCityInfo(chart.birthInfo.province, rawCity)
    : undefined;
  if (direct) {
    return getCityDisplayName(direct, lang);
  }
  const queried = findCityByQuery(rawCity, lang);
  return queried ? getCityDisplayName(queried.city, lang) : rawCity;
}

function parseBirthInfo(raw: unknown, lang: SupportedLang): ParseResult<BirthInfo> {
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
  if (raw.timeZone !== undefined && typeof raw.timeZone !== 'string') {
    return { ok: false, message: 'birthInfo.timeZone must be a string' };
  }

  const rawProvince = typeof raw.province === 'string' ? raw.province : '';
  const rawCity = typeof raw.city === 'string' ? raw.city : '';
  const loc = resolveCityLocation(rawProvince, rawCity, lang);

  const longitude = typeof raw.longitude === 'number' ? raw.longitude : loc.longitude;
  const utcOffsetMinutes =
    typeof raw.utcOffsetMinutes === 'number' ? raw.utcOffsetMinutes : loc.utcOffsetMinutes;
  const timeZone = typeof raw.timeZone === 'string' ? raw.timeZone : loc.timeZone;

  return {
    ok: true,
    value: {
      year,
      month,
      day,
      hour,
      gender,
      ...(typeof raw.name === 'string' && raw.name ? { name: raw.name } : {}),
      ...(loc.province ? { province: loc.province } : {}),
      ...(loc.city ? { city: loc.city } : {}),
      ...(longitude !== undefined ? { longitude } : {}),
      ...(utcOffsetMinutes !== undefined ? { utcOffsetMinutes } : {}),
      ...(timeZone !== undefined ? { timeZone } : {}),
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

function parseBirthForm(raw: unknown, lang: SupportedLang): ParseResult<BirthFormState> {
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

  if (raw.longitude !== undefined) {
    if (typeof raw.longitude !== 'number' || !Number.isFinite(raw.longitude) || raw.longitude < -180 || raw.longitude > 180) {
      return { ok: false, message: 'form.longitude must be a finite number in [-180, 180]' };
    }
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

  const rawProvince = typeof raw.province === 'string' ? raw.province : '';
  const rawCity = typeof raw.city === 'string' ? raw.city : '';
  const loc = resolveCityLocation(rawProvince, rawCity, lang);

  const longitude = typeof raw.longitude === 'number' ? raw.longitude : (loc.longitude ?? 120);
  const timeZone = typeof raw.timeZone === 'string' ? raw.timeZone : loc.timeZone;
  const utcOffsetMinutes =
    typeof raw.utcOffsetMinutes === 'number'
      ? raw.utcOffsetMinutes
      : !timeZone
        ? loc.utcOffsetMinutes
        : undefined;

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
      province: loc.province,
      city: loc.city,
      longitude,
      ...(utcOffsetMinutes !== undefined ? { utcOffsetMinutes } : {}),
      ...(timeZone !== undefined ? { timeZone } : {}),
      gender: raw.gender,
    },
  };
}

function parseChartObject(raw: unknown, lang: SupportedLang): ParseResult<ZiweiChart> {
  if (!isPlainRecord(raw)) {
    return { ok: false, message: 'chart must be an object' };
  }
  const birthParsed = parseBirthInfo(raw.birthInfo, lang);
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
  lang: SupportedLang,
): ParseResult<ZiweiChart> {
  if (chartRaw !== undefined) {
    return parseChartObject(chartRaw, lang);
  }
  if (formRaw !== undefined) {
    const parsedForm = parseBirthForm(formRaw, lang);
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
    const parsedInfo = parseBirthInfo(birthInfoRaw, lang);
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

export async function OPTIONS(req: Request): Promise<Response> {
  return handleCorsPreflight(req);
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
      req,
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
    return jsonError(req, 400, 'invalid_json', 'BAD_REQUEST', 'Request body must be valid JSON.');
  }

  if (!isPlainRecord(rawBody)) {
    return jsonError(req, 400, 'invalid_body', 'BAD_REQUEST', 'Request body must be a JSON object.');
  }

  const langParsed = parseLang(rawBody.lang);
  if (!langParsed.ok) {
    return jsonError(req, 400, 'invalid_lang', 'INVALID_INPUT', langParsed.message);
  }
  const targetYearParsed = parseOptionalTargetYear(rawBody.targetYear);
  if (!targetYearParsed.ok) {
    return jsonError(req, 400, 'invalid_target_year', 'INVALID_INPUT', targetYearParsed.message);
  }
  const lateZishiParsed = parseLateZishi(rawBody.lateZishi);
  if (!lateZishiParsed.ok) {
    return jsonError(req, 400, 'invalid_late_zishi', 'INVALID_INPUT', lateZishiParsed.message);
  }

  const lang = langParsed.value;
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
      lang,
    );
    if (!resolvedA.ok) {
      return jsonError(req, 400, 'invalid_synastry_input', 'INVALID_INPUT', `Partner A: ${resolvedA.message}`);
    }
    const resolvedB = resolveChartInput(
      rawBody.chartB,
      rawBody.birthInfoB,
      rawBody.formB,
      lateZishi,
      lang,
    );
    if (!resolvedB.ok) {
      return jsonError(req, 400, 'invalid_synastry_input', 'INVALID_INPUT', `Partner B: ${resolvedB.message}`);
    }

    const chartA = resolvedA.value;
    const chartB = resolvedB.value;
    const pairKey = canonicalPairKey(chartA, chartB, targetYear);
    const synastry = analyzeSynastry(chartA, chartB, { targetYear });
    const scopedQHash = scopedQuestionHash(hashQuestion(), lang);
    const hasCachedInterpretation = Boolean(
      (await getSynastryInterpretation(pairKey, scopedQHash)) ??
      (lang === 'zh' ? await getSynastryInterpretation(pairKey) : null),
    );
    const teasers = generateSynastryTeasers(synastry, lang);

    return withCors(
      req,
      Response.json(
        {
          ok: true,
          mode: 'synastry',
          lang,
          pairKey,
          chartA,
          chartB,
          synastry,
          teasers,
          hasCachedInterpretation,
        },
        { status: 200 },
      ),
    );
  }

  if (rawBody.form === undefined && rawBody.birthInfo === undefined) {
    return jsonError(
      req,
      400,
      'missing_birth_input',
      'INVALID_INPUT',
      'Provide birthInfo or form for natal chart generation, or partner A/B inputs for synastry.',
    );
  }

  const resolvedNatal = resolveChartInput(
    undefined,
    rawBody.birthInfo,
    rawBody.form,
    lateZishi,
    lang,
  );
  if (!resolvedNatal.ok) {
    return jsonError(req, 400, 'invalid_birth_input', 'INVALID_INPUT', resolvedNatal.message);
  }

  const chart = resolvedNatal.value;
  const cacheKey = getChartCacheKey(chart, { targetYear });
  const summary = analyzeChartSummary(chart, { targetYear });
  const patterns = detectPatterns(chart);
  const topicKey = typeof rawBody.topicKey === 'string' && rawBody.topicKey.trim().length > 0
    ? rawBody.topicKey.trim()
    : undefined;
  const cached = Boolean(
    await getChartInterpretation(cacheKey, scopedTopicKey(topicKey, lang)),
  );
  const teasers = generateChartTeasers(chart, summary, patterns, lang);
  const localizedSummary = translateChartSummary(chart, summary, patterns, lang);
  const localizedCity = resolveLocalizedCityDisplay(chart, lang);
  if (localizedCity) {
    localizedSummary.basic.city = localizedCity;
  }

  return withCors(
    req,
    Response.json(
      {
        ok: true,
        mode: 'natal',
        lang,
        cacheKey,
        chart,
        summary,
        patterns,
        freeLifePalace: teasers.freeLifePalace,
        teasers,
        localizedSummary,
        localizedPatterns: localizedSummary.patterns,
        hasCachedInterpretation: cached,
      },
      { status: 200 },
    ),
  );
}
