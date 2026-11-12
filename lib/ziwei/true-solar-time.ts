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
  /** 是否计入 NOAA 均时差（默认 true；仅在 dateValid 且提供经度时生效）。 */
  includeEquationOfTime?: boolean;
}

export interface TrueSolarTimeResult {
  dateValid: boolean;
  corrected: boolean;
  utcOffsetMinutes: number;
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

/** 由 UTC 偏移分钟数换算该时区的标准经线度数（东经为正，西经为负；1° = 4 分钟）。 */
export function standardMeridianDegrees(utcOffsetMinutes = DEFAULT_UTC_OFFSET_MINUTES): number {
  const offset = Number.isFinite(utcOffsetMinutes) ? utcOffsetMinutes : DEFAULT_UTC_OFFSET_MINUTES;
  return offset / 4;
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
  const utcOffsetMinutes = input.utcOffsetMinutes !== undefined && Number.isFinite(input.utcOffsetMinutes)
    ? input.utcOffsetMinutes
    : DEFAULT_UTC_OFFSET_MINUTES;
  const standardMeridian = standardMeridianDegrees(utcOffsetMinutes);
  const corrected = input.longitude !== undefined && Number.isFinite(input.longitude);
  const longitudeCorrectionMinutes = corrected ? (input.longitude! - standardMeridian) * 4 : 0;
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
