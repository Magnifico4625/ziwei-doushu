import type { BirthFormState } from '@/components/BirthForm';
import { findCityInfo } from './cities';
import { isValidGregorianDate } from './gregorian-date';
import {
  calculateTrueSolarTime,
  DEFAULT_UTC_OFFSET_MINUTES,
  resolveZiweiDayOffset,
  shiftGregorianDate,
  standardMeridianDegrees,
  type LateZishiRule,
  type TrueSolarTimeResult,
} from './true-solar-time';
import type { BirthInfo } from './types';

export interface TrueSolarBranchOptions {
  year?: number;
  month?: number;
  day?: number;
  utcOffsetMinutes?: number;
  includeEquationOfTime?: boolean;
}

/**
 * 根据钟表时间 + 经度（及时区标准经线）计算真太阳时时辰支 (0-11)。
 * 内部统一委托给 `true-solar-time.ts` 的 `calculateTrueSolarTime`。
 */
export function calcTrueSolarBranch(
  clockHour: number,
  clockMinute: number,
  longitude: number,
  utcOffsetOrOptions?: number | TrueSolarBranchOptions,
): number {
  const opts: TrueSolarBranchOptions = typeof utcOffsetOrOptions === 'number'
    ? { utcOffsetMinutes: utcOffsetOrOptions }
    : (utcOffsetOrOptions ?? {});
  return calculateTrueSolarTime({
    year: opts.year ?? 0,
    month: opts.month ?? 0,
    day: opts.day ?? 0,
    clockHour,
    clockMinute,
    longitude,
    utcOffsetMinutes: opts.utcOffsetMinutes,
    includeEquationOfTime: opts.includeEquationOfTime,
  }).branch;
}

/** 解析表单对应的标准时区 UTC 偏移分钟数（显式传入 > 城市表配置 > undefined）。 */
export function resolveFormUtcOffsetMinutes(
  form: Pick<BirthFormState, 'province' | 'city' | 'utcOffsetMinutes'>,
): number | undefined {
  if (form.utcOffsetMinutes !== undefined && Number.isFinite(form.utcOffsetMinutes)) {
    return form.utcOffsetMinutes;
  }
  if (form.province && form.city) {
    return findCityInfo(form.province, form.city)?.utcOffsetMinutes;
  }
  return undefined;
}

/** 判断表单是否提供了需要做真太阳时校正的出生地经度/时区信息。 */
export function hasFormLocationCorrection(
  form: Pick<BirthFormState, 'province' | 'city' | 'longitude' | 'utcOffsetMinutes'>,
): boolean {
  const tz = resolveFormUtcOffsetMinutes(form);
  const stdMeridian = standardMeridianDegrees(tz ?? DEFAULT_UTC_OFFSET_MINUTES);
  return Boolean(
    form.province
    || form.city
    || tz !== undefined
    || (Number.isFinite(form.longitude) && form.longitude !== stdMeridian),
  );
}

/**
 * 统一计算表单的真太阳时结果（含经度修正、均时差与跨日偏移）。
 * 未选择地点且经度停留在默认标准经线时，保持钟表时间不做真太阳时偏移。
 */
export function resolveFormTrueSolarTime(form: BirthFormState): TrueSolarTimeResult {
  const year = parseInt(form.year, 10) || 0;
  const month = parseInt(form.month, 10) || 0;
  const day = parseInt(form.day, 10) || 0;
  const clockHour = parseInt(form.clockHour, 10) || 0;
  const clockMinute = parseInt(form.clockMinute, 10) || 0;
  const utcOffsetMinutes = resolveFormUtcOffsetMinutes(form);
  const corrected = !form.unknownTime && hasFormLocationCorrection(form);
  return calculateTrueSolarTime({
    year,
    month,
    day,
    clockHour,
    clockMinute,
    longitude: corrected ? form.longitude : undefined,
    utcOffsetMinutes,
  });
}

/** BirthFormState → BirthInfo
 *
 * 真太阳时与子时规则（统一委托 `true-solar-time.ts`）：
 * · 未填地点时按钟表时间：23:00-23:59 = 晚子时，按次日排盘（日期 +1）；00:00-00:59 = 早子时，按本日排盘
 * · 填写出生地（或指定经度/时区）时：先按 `(longitude - standardMeridian) * 4 + 均时差` 求真太阳时，
 *   再由 `resolveZiweiDayOffset` 合并真太阳日跨界（-1/0/+1）与晚子时进位规则
 */
export function formToBirthInfo(
  form: BirthFormState,
  lateZishi: LateZishiRule = 'next-day',
): BirthInfo {
  const typedYear = parseInt(form.year, 10) || 0;
  const typedMonth = parseInt(form.month, 10) || 0;
  const typedDay = parseInt(form.day, 10) || 0;
  const clockHour = parseInt(form.clockHour, 10) || 0;
  const clockMinute = parseInt(form.clockMinute, 10) || 0;

  // 先拒绝不存在的公历日。若先做晚子时/真太阳时跨日进位，2 月 30 日会被顺延到 3 月。
  if (!isValidGregorianDate(typedYear, typedMonth, typedDay)) {
    throw new RangeError(`solar date does not exist: ${typedYear}-${typedMonth}-${typedDay}`);
  }

  let y = typedYear;
  let m = typedMonth;
  let d = typedDay;
  let hour = 0;

  if (!form.unknownTime) {
    const solar = resolveFormTrueSolarTime(form);
    const dayOffset = resolveZiweiDayOffset(solar, lateZishi);
    if (dayOffset !== 0) {
      const shifted = shiftGregorianDate({ year: typedYear, month: typedMonth, day: typedDay }, dayOffset);
      y = shifted.year;
      m = shifted.month;
      d = shifted.day;
    }
    hour = solar.branch;
  }

  const utcOffsetMinutes = resolveFormUtcOffsetMinutes(form);
  const info: BirthInfo = {
    year: y,
    month: m,
    day: d,
    hour,
    gender: form.gender,
    name: form.name || undefined,
    province: form.province || undefined,
    city: form.city || undefined,
    longitude: form.province ? form.longitude : undefined,
    // 已知钟点才保留。不参与安星；排盘日仍是上面的 year/month/day。
    origInput: form.unknownTime ? undefined : {
      year: typedYear,
      month: typedMonth,
      day: typedDay,
      clockHour,
      clockMinute,
    },
  };
  if (utcOffsetMinutes !== undefined) {
    info.utcOffsetMinutes = utcOffsetMinutes;
  }
  return info;
}

/** 界面语言。页面是 zh-CN；en / ru 与 shierShenLabel 一样按 lang 切换，没有对应语言时用中文。 */
export type NoteLang = 'zh' | 'en' | 'ru';

export function currentNoteLang(): NoteLang {
  if (typeof document === 'undefined') return 'zh';
  const lang = document.documentElement.lang.toLowerCase();
  if (lang.startsWith('en')) return 'en';
  if (lang.startsWith('ru')) return 'ru';
  return 'zh';
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** 晚子时换日已经发生：排盘日为输入日的次日，且排盘时辰为子时（或钟点为 23 时）。 */
export function isLateZiNextDay(
  info: Pick<BirthInfo, 'year' | 'month' | 'day' | 'origInput'> & { hour?: number },
): boolean {
  const orig = info.origInput;
  if (!orig) return false;
  if (!isValidGregorianDate(orig.year, orig.month, orig.day)) return false;
  const next = shiftGregorianDate(orig, 1);
  const isNextDay = info.year === next.year && info.month === next.month && info.day === next.day;
  if (!isNextDay) return false;
  return orig.clockHour === 23 || info.hour === 0;
}

/** 晚子时说明。默认中文，与当前页面语言一致。 */
export function lateZiShiftNote(
  input: { year: number; month: number; day: number; clockHour: number; clockMinute: number },
  lang: NoteLang = 'zh',
): string {
  const stamp = `${input.year}-${pad2(input.month)}-${pad2(input.day)} ${pad2(input.clockHour)}:${pad2(input.clockMinute)}`;
  if (lang === 'en') return `Late Zi hour: charted on the next day (entered ${stamp})`;
  if (lang === 'ru') return `Поздний час Цзы: карта считается по следующему дню (ввод ${stamp})`;
  return `晚子时：按次日排盘（输入 ${stamp}）`;
}

export function lateZiNoteForChart(
  info: Pick<BirthInfo, 'year' | 'month' | 'day' | 'origInput'> & { hour?: number },
  lang: NoteLang = currentNoteLang(),
): string {
  if (!isLateZiNextDay(info) || !info.origInput) return '';
  return lateZiShiftNote(info.origInput, lang);
}

/** BirthFormState → URLSearchParams（用于分享链接） */
export function formToSearchParams(form: BirthFormState): URLSearchParams {
  const p = new URLSearchParams();
  if (form.name) p.set('n', form.name);
  p.set('y', form.year);
  p.set('m', form.month);
  p.set('d', form.day);
  if (form.unknownTime) {
    p.set('u', '1');
  } else {
    p.set('h', form.clockHour);
    p.set('mi', form.clockMinute);
  }
  if (form.province) p.set('p', form.province);
  if (form.city) p.set('c', form.city);
  const tz = resolveFormUtcOffsetMinutes(form);
  const stdMeridian = standardMeridianDegrees(tz ?? DEFAULT_UTC_OFFSET_MINUTES);
  if (Number.isFinite(form.longitude) && form.longitude !== stdMeridian) {
    p.set('lo', String(form.longitude));
  }
  if (tz !== undefined && tz !== DEFAULT_UTC_OFFSET_MINUTES) {
    p.set('tz', String(tz));
  }
  p.set('g', form.gender === 'male' ? 'm' : 'f');
  return p;
}

/** URLSearchParams → Partial<BirthFormState>，不完整时返回 null */
export function searchParamsToForm(params: URLSearchParams): Partial<BirthFormState> | null {
  const year = params.get('y');
  const month = params.get('m');
  const day = params.get('d');
  if (!year || !month || !day) return null;
  const province = params.get('p') || '';
  const city = params.get('c') || '';
  const cityMeta = province && city ? findCityInfo(province, city) : undefined;
  const rawTz = params.get('tz');
  const parsedTz = rawTz !== null && rawTz.trim() !== '' ? Number(rawTz) : undefined;
  const utcOffsetMinutes = parsedTz !== undefined && Number.isFinite(parsedTz)
    ? parsedTz
    : cityMeta?.utcOffsetMinutes;
  const defaultLon = cityMeta?.longitude ?? standardMeridianDegrees(utcOffsetMinutes ?? DEFAULT_UTC_OFFSET_MINUTES);
  const rawLo = params.get('lo');
  const parsedLo = rawLo !== null && rawLo.trim() !== '' ? parseFloat(rawLo) : NaN;
  const out: Partial<BirthFormState> = {
    name: params.get('n') || '',
    year,
    month,
    day,
    unknownTime: params.get('u') === '1',
    clockHour: params.get('h') || '8',
    clockMinute: params.get('mi') || '0',
    province,
    city,
    longitude: Number.isFinite(parsedLo) ? parsedLo : defaultLon,
    gender: params.get('g') === 'f' ? 'female' : 'male',
  };
  if (utcOffsetMinutes !== undefined) {
    out.utcOffsetMinutes = utcOffsetMinutes;
  }
  return out;
}
