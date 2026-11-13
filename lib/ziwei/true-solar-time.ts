/**
 * 真太阳时统一计算。
 *
 * 口径：地方真太阳时 = 钟表时间 + (出生地经度 - 时区标准经线) × 4 分钟 + 均时差。
 * 默认时区为 UTC+8（东八区，480 分钟，标准经线 120°E）；海外城市可传入各自时区的
 * `utcOffsetMinutes`（标准经线 = utcOffsetMinutes / 4）。
 * 均时差采用 NOAA 的 fractional-year 近似式，1900-2026 年范围内足以稳定
 * 判断紫微斗数的两小时时辰边界。
 *
 * 参考：https://gml.noaa.gov/grad/solcalc/solareqns.PDF
 */
import { isLeapGregorianYear, isValidGregorianDate } from './gregorian-date';

export { isValidGregorianDate };

/** 默认标准时区：UTC+8（北京时间，标准经线 120°E） */
export const DEFAULT_UTC_OFFSET_MINUTES = 480;
export const MIN_UTC_OFFSET_MINUTES = -720; // UTC-12:00
export const MAX_UTC_OFFSET_MINUTES = 840;  // UTC+14:00

export interface GregorianDate {
  year: number;
  month: number;
  day: number;
}

export type LateZishiRule = 'next-day' | 'current-day' | 'all-current' | 'day-cur-time-next';

export interface TrueSolarTimeInput extends GregorianDate {
  clockHour: number;
  clockMinute: number;
  /** 未提供经度时保持原钟表时间，不做真太阳时校正。 */
  longitude?: number;
  /**
   * 出生时区相对 UTC 的分钟偏移（默认 480 = UTC+8，标准经线 120°E）。
   * 海外城市按各自时区标准经线（utcOffsetMinutes / 4）计算经度时差。
   */
  utcOffsetMinutes?: number;
  /** 可选 IANA 时区标识（如 `America/New_York`、`Europe/Moscow`），按出生年月日时自动解析含夏令时在内的历史 UTC 偏移。 */
  timeZone?: string;
  /** 是否计入 NOAA 均时差（默认 true；仅在 dateValid 且提供经度时生效）。 */
  includeEquationOfTime?: boolean;
}

export interface TrueSolarTimeResult {
  dateValid: boolean;
  corrected: boolean;
  utcOffsetMinutes: number;
  timeZone?: string;
  standardMeridian: number;
  longitudeCorrectionMinutes: number;
  equationOfTimeMinutes: number;
  totalCorrectionMinutes: number;
  rawMinutes: number;
  normalizedMinutes: number;
  dayOffset: number;
  hour: number;
  minute: number;
  second: number;
  branch: number;
}

const SECONDS_PER_DAY = 86400;
const mod = (value: number, base: number) => ((value % base) + base) % base;

const dtfCache = new Map<string, Intl.DateTimeFormat>();

interface KnownOverseasZone {
  longitude: number;
  defaultUtcOffsetMinutes: number;
  timeZone: string;
}

const KNOWN_OVERSEAS_CITY_TIMEZONES: readonly KnownOverseasZone[] = [
  { longitude: 37.6, defaultUtcOffsetMinutes: 180, timeZone: 'Europe/Moscow' },
  { longitude: 30.3, defaultUtcOffsetMinutes: 180, timeZone: 'Europe/Moscow' },
  { longitude: 60.6, defaultUtcOffsetMinutes: 300, timeZone: 'Asia/Yekaterinburg' },
  { longitude: 82.9, defaultUtcOffsetMinutes: 420, timeZone: 'Asia/Novosibirsk' },
  { longitude: 131.9, defaultUtcOffsetMinutes: 600, timeZone: 'Asia/Vladivostok' },
  { longitude: 76.9, defaultUtcOffsetMinutes: 300, timeZone: 'Asia/Almaty' },
  { longitude: 27.6, defaultUtcOffsetMinutes: 180, timeZone: 'Europe/Minsk' },
  { longitude: 139.7, defaultUtcOffsetMinutes: 540, timeZone: 'Asia/Tokyo' },
  { longitude: 127.0, defaultUtcOffsetMinutes: 540, timeZone: 'Asia/Seoul' },
  { longitude: 103.8, defaultUtcOffsetMinutes: 480, timeZone: 'Asia/Singapore' },
  { longitude: 101.7, defaultUtcOffsetMinutes: 480, timeZone: 'Asia/Kuala_Lumpur' },
  { longitude: 100.5, defaultUtcOffsetMinutes: 420, timeZone: 'Asia/Bangkok' },
  { longitude: 77.2, defaultUtcOffsetMinutes: 330, timeZone: 'Asia/Kolkata' },
  { longitude: 72.8, defaultUtcOffsetMinutes: 330, timeZone: 'Asia/Kolkata' },
  { longitude: -0.1, defaultUtcOffsetMinutes: 0, timeZone: 'Europe/London' },
  { longitude: 2.3, defaultUtcOffsetMinutes: 60, timeZone: 'Europe/Paris' },
  { longitude: 13.4, defaultUtcOffsetMinutes: 60, timeZone: 'Europe/Berlin' },
  { longitude: -74.0, defaultUtcOffsetMinutes: -300, timeZone: 'America/New_York' },
  { longitude: -118.2, defaultUtcOffsetMinutes: -480, timeZone: 'America/Los_Angeles' },
  { longitude: -79.4, defaultUtcOffsetMinutes: -300, timeZone: 'America/Toronto' },
  { longitude: -123.1, defaultUtcOffsetMinutes: -480, timeZone: 'America/Vancouver' },
  { longitude: 151.2, defaultUtcOffsetMinutes: 600, timeZone: 'Australia/Sydney' },
  { longitude: 145.0, defaultUtcOffsetMinutes: 600, timeZone: 'Australia/Melbourne' },
];

/** 校验 UTC 偏移分钟数是否为 [-720, 840] 范围内的整数。 */
export function isValidUtcOffsetMinutes(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= MIN_UTC_OFFSET_MINUTES
    && value <= MAX_UTC_OFFSET_MINUTES;
}

/** 校验经度是否在 [-180, 180] 范围内。 */
export function isValidLongitude(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= -180
    && value <= 180;
}

function getZoneFormatter(timeZone: string): Intl.DateTimeFormat | undefined {
  const trimmed = timeZone.trim();
  if (!trimmed) return undefined;
  const cached = dtfCache.get(trimmed);
  if (cached) return cached;
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: trimmed,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    dtfCache.set(trimmed, dtf);
    return dtf;
  } catch {
    return undefined;
  }
}

/** 校验是否为运行时 `Intl.DateTimeFormat` 支持的 IANA 时区标识。 */
export function isValidTimeZone(timeZone: unknown): timeZone is string {
  return typeof timeZone === 'string' && getZoneFormatter(timeZone) !== undefined;
}

/**
 * 解析指定 IANA 时区在给定当地公历日期与时刻的 UTC 偏移（分钟），
 * 自动包含历史夏令时（DST）与时区改革（如俄罗斯 2011–2014 永久夏令时）。
 */
export function resolveTimeZoneOffsetMinutes(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  clockHour = 12,
  clockMinute = 0,
): number | undefined {
  if (!isValidTimeZone(timeZone) || !isValidGregorianDate(year, month, day)) return undefined;
  const dtf = getZoneFormatter(timeZone);
  if (!dtf) return undefined;

  const h = Number.isFinite(clockHour) ? Math.min(23, Math.max(0, Math.floor(clockHour))) : 12;
  const mi = Number.isFinite(clockMinute) ? Math.min(59, Math.max(0, Math.floor(clockMinute))) : 0;
  const approxUtcMs = Date.UTC(year, month - 1, day, h, mi, 0);

  const offsetAt = (utcMs: number): number => {
    const parts = dtf.formatToParts(new Date(utcMs));
    const vals: Record<string, number> = {};
    for (const p of parts) {
      if (p.type !== 'literal') vals[p.type] = Number(p.value);
    }
    const asUtc = Date.UTC(
      vals.year,
      (vals.month ?? 1) - 1,
      vals.day ?? 1,
      vals.hour ?? 0,
      vals.minute ?? 0,
      vals.second ?? 0,
    );
    return Math.round((asUtc - utcMs) / 60_000);
  };

  const o1 = offsetAt(approxUtcMs);
  const o2 = offsetAt(approxUtcMs - o1 * 60_000);
  return offsetAt(approxUtcMs - o2 * 60_000);
}

function inferOverseasTimeZone(longitude?: number, utcOffsetMinutes?: number): string | undefined {
  if (!isValidLongitude(longitude) || !isValidUtcOffsetMinutes(utcOffsetMinutes)) return undefined;
  const hit = KNOWN_OVERSEAS_CITY_TIMEZONES.find(
    (entry) => Math.abs(entry.longitude - longitude) < 1e-6
      && entry.defaultUtcOffsetMinutes === utcOffsetMinutes,
  );
  return hit?.timeZone;
}

/** 由 UTC 偏移分钟数换算该时区的标准经线度数（东经为正，西经为负；1° = 4 分钟，归一化至 [-180°, 180°]）。 */
export function standardMeridianDegrees(utcOffsetMinutes = DEFAULT_UTC_OFFSET_MINUTES): number {
  const offset = Number.isFinite(utcOffsetMinutes) ? utcOffsetMinutes : DEFAULT_UTC_OFFSET_MINUTES;
  const raw = offset / 4;
  return raw > 180 ? raw - 360 : raw < -180 ? raw + 360 : raw;
}

/** 格式化 UTC 偏移标签，如 `UTC+8`、`UTC+3`、`UTC+5:30`、`UTC-5`。 */
export function formatUtcOffsetLabel(utcOffsetMinutes = DEFAULT_UTC_OFFSET_MINUTES): string {
  const offset = Number.isFinite(utcOffsetMinutes) ? Math.round(utcOffsetMinutes) : DEFAULT_UTC_OFFSET_MINUTES;
  if (offset === 0) return 'UTC+0';
  const sign = offset > 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  return mins === 0 ? `UTC${sign}${hours}` : `UTC${sign}${hours}:${String(mins).padStart(2, '0')}`;
}

export function shiftGregorianDate(date: GregorianDate, dayOffset: number): GregorianDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + dayOffset));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function sameGregorianDate(a: GregorianDate, b: GregorianDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function dayOfYear(year: number, month: number, day: number): number {
  return Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / 86_400_000);
}

/** NOAA 均时差近似值，返回分钟；正值表示真太阳时快于平太阳时。 */
export function equationOfTimeMinutes(
  year: number,
  month: number,
  day: number,
  clockHour = 12,
  clockMinute = 0,
): number {
  if (!isValidGregorianDate(year, month, day)) return 0;
  const daysInYear = isLeapGregorianYear(year) ? 366 : 365;
  const fractionalHour = clockHour + clockMinute / 60;
  const gamma = (2 * Math.PI / daysInYear)
    * (dayOfYear(year, month, day) - 1 + (fractionalHour - 12) / 24);
  return 229.18 * (
    0.000075
    + 0.001868 * Math.cos(gamma)
    - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma)
    - 0.040849 * Math.sin(2 * gamma)
  );
}

export function branchFromSolarMinutes(normalizedMinutes: number): number {
  if (normalizedMinutes >= 1380 || normalizedMinutes < 60) return 0;
  return Math.floor((normalizedMinutes - 60) / 120) + 1;
}

export function calculateTrueSolarTime(input: TrueSolarTimeInput): TrueSolarTimeResult {
  const dateValid = isValidGregorianDate(input.year, input.month, input.day);
  const explicitZone = isValidTimeZone(input.timeZone) ? input.timeZone.trim() : undefined;
  const inferredZone = explicitZone ? undefined : inferOverseasTimeZone(input.longitude, input.utcOffsetMinutes);
  const effectiveZone = explicitZone ?? inferredZone;

  const tzResolvedOffset = dateValid && effectiveZone
    ? resolveTimeZoneOffsetMinutes(effectiveZone, input.year, input.month, input.day, input.clockHour, input.clockMinute)
    : undefined;

  const utcOffsetMinutes = tzResolvedOffset !== undefined
    ? tzResolvedOffset
    : isValidUtcOffsetMinutes(input.utcOffsetMinutes)
      ? input.utcOffsetMinutes
      : DEFAULT_UTC_OFFSET_MINUTES;
  const standardMeridian = standardMeridianDegrees(utcOffsetMinutes);
  const corrected = isValidLongitude(input.longitude);
  const rawLonDelta = corrected ? input.longitude! - standardMeridian : 0;
  const lonDelta = rawLonDelta > 180 ? rawLonDelta - 360 : rawLonDelta < -180 ? rawLonDelta + 360 : rawLonDelta;
  const longitudeCorrectionMinutes = corrected ? lonDelta * 4 : 0;
  const eot = corrected && dateValid && input.includeEquationOfTime !== false
    ? equationOfTimeMinutes(input.year, input.month, input.day, input.clockHour, input.clockMinute)
    : 0;
  const totalCorrectionMinutes = longitudeCorrectionMinutes + eot;
  const rawMinutes = input.clockHour * 60 + input.clockMinute + totalCorrectionMinutes;

  // 页面输入精度为分钟；显示和时辰边界统一按最近一秒，避免浮点毛刺。
  const roundedTotalSeconds = Math.round(rawMinutes * 60);
  const dayOffset = Math.floor(roundedTotalSeconds / SECONDS_PER_DAY);
  const secondOfDay = mod(roundedTotalSeconds, SECONDS_PER_DAY);
  const hour = Math.floor(secondOfDay / 3600);
  const minute = Math.floor((secondOfDay % 3600) / 60);
  const second = secondOfDay % 60;
  const normalizedMinutes = secondOfDay / 60;

  return {
    dateValid,
    corrected,
    utcOffsetMinutes,
    ...(effectiveZone ? { timeZone: effectiveZone } : {}),
    standardMeridian,
    longitudeCorrectionMinutes,
    equationOfTimeMinutes: eot,
    totalCorrectionMinutes,
    rawMinutes,
    normalizedMinutes,
    dayOffset,
    hour,
    minute,
    second,
    branch: branchFromSolarMinutes(normalizedMinutes),
  };
}

/** 把真太阳日与晚子时流派规则合并成最终排盘日相对输入日的偏移。 */
export function resolveZiweiDayOffset(
  solar: Pick<TrueSolarTimeResult, 'dayOffset' | 'normalizedMinutes' | 'branch'>,
  lateZishi: LateZishiRule = 'next-day',
): number {
  // day-cur-time-next changes the hour-pillar convention, not the Ziwei
  // main-chart date. Only the explicit next-day rule advances this date.
  const nextDayRule = lateZishi === 'next-day';
  const isLateZishi = solar.branch === 0 && solar.normalizedMinutes >= 1380;

  if (solar.dayOffset < 0 && isLateZishi) {
    return nextDayRule ? solar.dayOffset + 1 : solar.dayOffset;
  }
  if (solar.dayOffset !== 0) return solar.dayOffset;
  if (isLateZishi) return nextDayRule ? 1 : 0;
  return 0;
}

export function formatTrueSolarClock(solar: Pick<TrueSolarTimeResult, 'hour' | 'minute' | 'second'>, withSeconds = false): string {
  const base = `${String(solar.hour).padStart(2, '0')}:${String(solar.minute).padStart(2, '0')}`;
  return withSeconds ? `${base}:${String(solar.second).padStart(2, '0')}` : base;
}

export function formatSignedMinutes(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? '+' : ''}${rounded}`;
}
