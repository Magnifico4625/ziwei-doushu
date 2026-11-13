import type { BirthFormState } from '@/components/BirthForm';
import { findCityInfo, resolveCityUtcOffsetMinutes } from './cities';
import { chinaDSTRange, chinaDSTSpan, isChinaDST } from './dst-cn';
import { isValidGregorianDate } from './gregorian-date';
import {
  calculateTrueSolarTime,
  DEFAULT_UTC_OFFSET_MINUTES,
  isValidLongitude,
  isValidTimeZone,
  isValidUtcOffsetMinutes,
  resolveTimeZoneOffsetMinutes,
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
  timeZone?: string;
  includeEquationOfTime?: boolean;
}

/**
 * 根据钟表时间 + 经度（及时区标准经线 / IANA 时区）计算真太阳时时辰支 (0-11)。
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
    timeZone: opts.timeZone,
    includeEquationOfTime: opts.includeEquationOfTime,
  }).branch;
}

type FormTimezoneFields = Pick<BirthFormState, 'province' | 'city' | 'utcOffsetMinutes'>
  & Partial<Pick<BirthFormState, 'year' | 'month' | 'day' | 'clockHour' | 'clockMinute' | 'timeZone'>>;

/** 解析表单对应的 IANA 时区标识（`timeZone === ''` 表示手动固定时区，否则取显式 `form.timeZone` > 城市表 `cityMeta.timeZone`）。 */
export function resolveFormTimeZone(
  form: Pick<BirthFormState, 'province' | 'city'> & Partial<Pick<BirthFormState, 'timeZone' | 'utcOffsetMinutes'>>,
): string | undefined {
  if (form.timeZone === '') return undefined;
  if (form.timeZone && isValidTimeZone(form.timeZone)) return form.timeZone.trim();
  if (form.province && form.city) {
    return findCityInfo(form.province, form.city)?.timeZone;
  }
  return undefined;
}

function parseFormDateTime(form: Partial<Pick<BirthFormState, 'year' | 'month' | 'day' | 'clockHour' | 'clockMinute'>>) {
  return {
    year: form.year ? parseInt(form.year, 10) || 0 : 0,
    month: form.month ? parseInt(form.month, 10) || 0 : 0,
    day: form.day ? parseInt(form.day, 10) || 0 : 0,
    hour: form.clockHour !== undefined ? (parseInt(form.clockHour, 10) || 0) : 12,
    minute: form.clockMinute !== undefined ? (parseInt(form.clockMinute, 10) || 0) : 0,
  };
}

function isManualTimezoneOverride(
  form: FormTimezoneFields,
  tzId: string | undefined,
  cityExpectedOffset: number | undefined,
): boolean {
  if (!isValidUtcOffsetMinutes(form.utcOffsetMinutes)) return false;
  if (form.timeZone === '' || !tzId) return true;
  if (form.timeZone === undefined && cityExpectedOffset !== undefined && form.utcOffsetMinutes !== cityExpectedOffset) {
    return true;
  }
  return false;
}

/** 解析表单对应的实际 UTC 偏移分钟数：若存在 IANA 时区且未手动覆盖为其他时区，则按出生年月日时解析含夏令时在内的历史偏移。 */
export function resolveFormUtcOffsetMinutes(form: FormTimezoneFields): number | undefined {
  const cityMeta = form.province && form.city ? findCityInfo(form.province, form.city) : undefined;
  const tzId = resolveFormTimeZone(form);
  const { year, month, day, hour, minute } = parseFormDateTime(form);

  const dynamicOffset = tzId && isValidGregorianDate(year, month, day)
    ? resolveTimeZoneOffsetMinutes(tzId, year, month, day, hour, minute)
    : undefined;
  const cityExpectedOffset = dynamicOffset ?? cityMeta?.utcOffsetMinutes;

  if (isManualTimezoneOverride(form, tzId, cityExpectedOffset)) {
    return form.utcOffsetMinutes;
  }

  if (dynamicOffset !== undefined) return dynamicOffset;
  if (cityMeta?.utcOffsetMinutes !== undefined) return cityMeta.utcOffsetMinutes;
  return isValidUtcOffsetMinutes(form.utcOffsetMinutes) ? form.utcOffsetMinutes : undefined;
}

/** 判断表单是否提供了需要做真太阳时校正的出生地经度/时区信息。 */
export function hasFormLocationCorrection(
  form: Pick<BirthFormState, 'province' | 'city' | 'longitude' | 'utcOffsetMinutes'>
    & Partial<Pick<BirthFormState, 'year' | 'month' | 'day' | 'clockHour' | 'clockMinute' | 'timeZone'>>,
): boolean {
  const tz = resolveFormUtcOffsetMinutes(form);
  const stdMeridian = standardMeridianDegrees(tz ?? DEFAULT_UTC_OFFSET_MINUTES);
  return Boolean(
    form.province
    || form.city
    || tz !== undefined
    || resolveFormTimeZone(form)
    || (isValidLongitude(form.longitude) && form.longitude !== stdMeridian),
  );
}

/**
 * 统一计算表单的真太阳时结果（含经度修正、均时差、历史时区 DST 与跨日偏移）。
 * 未选择地点且经度停留在默认标准经线时，保持钟表时间不做真太阳时偏移。
 */
export function resolveFormTrueSolarTime(form: BirthFormState): TrueSolarTimeResult {
  const year = parseInt(form.year, 10) || 0;
  const month = parseInt(form.month, 10) || 0;
  const day = parseInt(form.day, 10) || 0;
  const clockHour = parseInt(form.clockHour, 10) || 0;
  const clockMinute = parseInt(form.clockMinute, 10) || 0;
  const utcOffsetMinutes = resolveFormUtcOffsetMinutes(form);
  const cityMeta = form.province && form.city ? findCityInfo(form.province, form.city) : undefined;
  const tzId = resolveFormTimeZone(form);
  const cityExpectedOffset = tzId && isValidGregorianDate(year, month, day)
    ? (resolveTimeZoneOffsetMinutes(tzId, year, month, day, clockHour, clockMinute) ?? cityMeta?.utcOffsetMinutes)
    : cityMeta?.utcOffsetMinutes;
  const manualOverride = isManualTimezoneOverride(form, tzId, cityExpectedOffset);
  const corrected = !form.unknownTime && hasFormLocationCorrection(form);
  const effectiveLongitude = corrected && isValidLongitude(form.longitude) ? form.longitude : undefined;

  return calculateTrueSolarTime({
    year,
    month,
    day,
    clockHour,
    clockMinute,
    longitude: effectiveLongitude,
    utcOffsetMinutes,
    timeZone: manualOverride ? undefined : tzId,
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
  const cityMeta = form.province && form.city ? findCityInfo(form.province, form.city) : undefined;
  const tzId = resolveFormTimeZone(form);
  const cityExpectedOffset = tzId && isValidGregorianDate(typedYear, typedMonth, typedDay)
    ? (resolveTimeZoneOffsetMinutes(tzId, typedYear, typedMonth, typedDay, clockHour, clockMinute) ?? cityMeta?.utcOffsetMinutes)
    : cityMeta?.utcOffsetMinutes;
  const manualOverride = isManualTimezoneOverride(form, tzId, cityExpectedOffset);
  const hasLoc = hasFormLocationCorrection(form);

  const info: BirthInfo = {
    year: y,
    month: m,
    day: d,
    hour,
    gender: form.gender,
    name: form.name || undefined,
    province: form.province || undefined,
    city: form.city || undefined,
    longitude: hasLoc && isValidLongitude(form.longitude) ? form.longitude : undefined,
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
  if (!manualOverride && tzId) {
    info.timeZone = tzId;
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

/**
 * 晚子时换日已经发生（真太阳时落入输入日的 23:00–23:59 晚子时并进位到次日）：
 * 若真太阳时本身已经跨过午夜（dayOffset === +1，实为次日 00:00–00:59 早子时），
 * 则不再误标为「晚子时：按次日排盘」。
 */
export function isLateZiNextDay(
  info: Pick<BirthInfo, 'year' | 'month' | 'day' | 'origInput' | 'longitude' | 'utcOffsetMinutes' | 'timeZone' | 'province' | 'city'> & { hour?: number },
): boolean {
  const orig = info.origInput;
  if (!orig) return false;
  if (!isValidGregorianDate(orig.year, orig.month, orig.day)) return false;
  if (info.hour !== undefined && info.hour !== 0) return false;

  const next = shiftGregorianDate(orig, 1);
  const isNextDay = info.year === next.year && info.month === next.month && info.day === next.day;
  if (!isNextDay) return false;

  const cityMeta = info.province && info.city ? findCityInfo(info.province, info.city) : undefined;
  const tzId = (info.timeZone && isValidTimeZone(info.timeZone)) ? info.timeZone.trim() : cityMeta?.timeZone;
  const dynamicOffset = tzId
    ? resolveTimeZoneOffsetMinutes(tzId, orig.year, orig.month, orig.day, orig.clockHour, orig.clockMinute)
    : undefined;
  const utcOffsetMinutes = isValidUtcOffsetMinutes(info.utcOffsetMinutes)
    ? info.utcOffsetMinutes
    : (dynamicOffset ?? cityMeta?.utcOffsetMinutes);
  const lon = isValidLongitude(info.longitude) ? info.longitude : cityMeta?.longitude;
  const stdMeridian = standardMeridianDegrees(utcOffsetMinutes ?? DEFAULT_UTC_OFFSET_MINUTES);
  const hasLoc = Boolean(
    info.province
    || info.city
    || tzId
    || utcOffsetMinutes !== undefined
    || (lon !== undefined && lon !== stdMeridian),
  );

  const solar = calculateTrueSolarTime({
    year: orig.year,
    month: orig.month,
    day: orig.day,
    clockHour: orig.clockHour,
    clockMinute: orig.clockMinute,
    longitude: hasLoc ? (lon ?? stdMeridian) : undefined,
    utcOffsetMinutes,
    timeZone: utcOffsetMinutes === undefined ? tzId : undefined,
  });

  return solar.dayOffset === 0 && solar.branch === 0 && solar.normalizedMinutes >= 1380;
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
  info: Pick<BirthInfo, 'year' | 'month' | 'day' | 'origInput' | 'longitude' | 'utcOffsetMinutes' | 'timeZone' | 'province' | 'city'> & { hour?: number },
  lang: NoteLang = currentNoteLang(),
): string {
  if (!isLateZiNextDay(info) || !info.origInput) return '';
  return lateZiShiftNote(info.origInput, lang);
}

const NON_MAINLAND_PROVINCES = new Set([
  '海外 / 国际',
  '香港特别行政区',
  '澳门特别行政区',
  '台湾省',
]);

/** 判断当前表单是否处于适用中国大陆夏令时提示的语境（国内东八区）。 */
export function isMainlandChinaFormContext(
  form: Pick<BirthFormState, 'province' | 'city' | 'utcOffsetMinutes'> & Partial<Pick<BirthFormState, 'timeZone'>>,
): boolean {
  if (form.province && NON_MAINLAND_PROVINCES.has(form.province)) return false;
  if (form.timeZone && form.timeZone !== 'Asia/Shanghai') return false;
  if (isValidUtcOffsetMinutes(form.utcOffsetMinutes) && form.utcOffsetMinutes !== DEFAULT_UTC_OFFSET_MINUTES) {
    return false;
  }
  return true;
}

/** 中国大陆历史夏令时提醒（1935–1991 年）：仅提醒，不静默修改用户输入。 */
export function chinaDstNoteForForm(
  form: Pick<BirthFormState, 'year' | 'month' | 'day' | 'unknownTime' | 'province' | 'city' | 'utcOffsetMinutes'>
    & Partial<Pick<BirthFormState, 'timeZone'>>,
  lang: NoteLang = currentNoteLang(),
): string {
  if (form.unknownTime) return '';
  if (!isMainlandChinaFormContext(form)) return '';
  const y = parseInt(form.year, 10) || 0;
  const m = parseInt(form.month, 10) || 0;
  const d = parseInt(form.day, 10) || 0;
  if (!isValidGregorianDate(y, m, d) || !isChinaDST(y, m, d)) return '';

  const range = chinaDSTRange(y);
  const span = chinaDSTSpan(y);
  if (lang === 'en') {
    const period = span ? `${span.startMonth}/${span.startDay}–${span.endMonth}/${span.endDay}` : 'summer DST';
    return `China DST applied on ${y}-${pad2(m)}-${pad2(d)} (${period}). The engine does not subtract 1 hour automatically; if the recorded time was daylight-saving clock time, subtract 1 hour.`;
  }
  if (lang === 'ru') {
    const period = span ? `${span.startDay}.${pad2(span.startMonth)}–${span.endDay}.${pad2(span.endMonth)}` : 'летний период';
    return `На дату ${y}-${pad2(m)}-${pad2(d)} в КНР действовало летнее время (${period}). Движок не вычитает 1 час автоматически: если время записано по летним часам, вычтите 1 час.`;
  }
  const rangeText = range ? `（当年夏令时区间：${range.start}–${range.end}）` : '';
  return `该日期处于中国大陆夏令时期间${rangeText}。引擎不会自动扣减 1 小时；若出生记录为夏令时钟表时间，请手动减 1 小时。`;
}

/** 校验并解析分享链接中的 `tz` 参数（仅接受 [-720, 840] 范围内的整数分钟偏移）。 */
export function parseShareTzParam(rawTz: string | null): number | undefined {
  if (rawTz === null) return undefined;
  const trimmed = rawTz.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return isValidUtcOffsetMinutes(parsed) ? parsed : undefined;
}

/** 校验并解析分享链接中的 `lo` 参数（仅接受 [-180, 180] 范围内的有效经度）。 */
export function parseShareLongitudeParam(rawLo: string | null): number | undefined {
  if (rawLo === null) return undefined;
  const trimmed = rawLo.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return isValidLongitude(parsed) ? parsed : undefined;
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
  if (isValidLongitude(form.longitude) && form.longitude !== stdMeridian) {
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
  const clockHour = params.get('h') || '8';
  const clockMinute = params.get('mi') || '0';
  const cityMeta = province && city ? findCityInfo(province, city) : undefined;
  const parsedTz = parseShareTzParam(params.get('tz'));
  const cityTz = cityMeta
    ? resolveCityUtcOffsetMinutes(
      cityMeta,
      parseInt(year, 10) || 0,
      parseInt(month, 10) || 0,
      parseInt(day, 10) || 0,
      parseInt(clockHour, 10) || 0,
      parseInt(clockMinute, 10) || 0,
    )
    : undefined;
  const utcOffsetMinutes = parsedTz !== undefined ? parsedTz : cityTz;
  const defaultLon = cityMeta?.longitude ?? standardMeridianDegrees(utcOffsetMinutes ?? DEFAULT_UTC_OFFSET_MINUTES);
  const parsedLo = parseShareLongitudeParam(params.get('lo'));
  const out: Partial<BirthFormState> = {
    name: params.get('n') || '',
    year,
    month,
    day,
    unknownTime: params.get('u') === '1',
    clockHour,
    clockMinute,
    province,
    city,
    longitude: parsedLo !== undefined ? parsedLo : defaultLon,
    gender: params.get('g') === 'f' ? 'female' : 'male',
  };
  if (utcOffsetMinutes !== undefined) {
    out.utcOffsetMinutes = utcOffsetMinutes;
  }
  if (cityMeta?.timeZone) {
    out.timeZone = parsedTz === undefined || parsedTz === cityTz ? cityMeta.timeZone : '';
  }
  return out;
}
