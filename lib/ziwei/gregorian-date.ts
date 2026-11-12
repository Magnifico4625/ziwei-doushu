/**
 * 公历日期是否真实存在。
 *
 * 不用 `Date` 构造结果来判断：`new Date(year, month - 1, day)` 会把
 * 2 月 30 日、平年 2 月 29 日静默顺延到 3 月，调用方看起来像是排过盘。
 * 这里按公历历法本身判断（400 年一闰，100 年不闰，4 年一闰）。
 *
 * 农历不走这里。农历月可以有三十日，闰月是否存在由 lunar-solar.ts 查表。
 */

export function isLeapGregorianYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * 旧实现用 `Date.UTC` 做往返。这个 API 把 0–99 年折成 1900–1999，
 * 所以 `getUTCFullYear()` 对不上原年份，main 会拒绝这些年。100 年起的真实日期仍然放行。
 */
export const GREGORIAN_YEAR_MIN = 100;

/** 该公历月的天数。月份不在 1–12 时返回 0。 */
export function daysInGregorianMonth(year: number, month: number): number {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return 0;
  if (month === 2) return isLeapGregorianYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

export function isValidGregorianDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year >= 0 && year < GREGORIAN_YEAR_MIN) return false;
  const days = daysInGregorianMonth(year, month);
  return days > 0 && day >= 1 && day <= days;
}

export function assertValidGregorianDate(year: number, month: number, day: number): void {
  if (!isValidGregorianDate(year, month, day)) {
    throw new RangeError(`solar date does not exist: ${year}-${month}-${day}`);
  }
}
