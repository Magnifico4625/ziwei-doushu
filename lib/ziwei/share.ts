import type { BirthFormState } from '@/components/BirthForm';
import { isValidGregorianDate } from './gregorian-date';
import type { BirthInfo } from './types';

/** 根据北京时间 + 经度计算真太阳时时辰支 (0-11) */
export function calcTrueSolarBranch(clockHour: number, clockMinute: number, longitude: number): number {
  const clockMins = clockHour * 60 + clockMinute;
  const offset = (longitude - 120) * 4;
  const solar = ((clockMins + offset) % 1440 + 1440) % 1440;
  if (solar >= 1380 || solar < 60) return 0;
  return Math.floor((solar - 60) / 120) + 1;
}

/** BirthFormState → BirthInfo
 *
 * 子时规则（倪海厦体系/三合派标准）：
 * · 23:00-23:59 = 晚子时，**按次日**排盘（日期 +1）
 * · 00:00-00:59 = 早子时，按本日排盘
 * 这与「时辰支同为子(0)」并不冲突——子时分早晚两段，需要在日期上区分。
 */
export function formToBirthInfo(form: BirthFormState): BirthInfo {
  const typedYear = parseInt(form.year, 10) || 0;
  const typedMonth = parseInt(form.month, 10) || 0;
  const typedDay = parseInt(form.day, 10) || 0;
  const clockHour = parseInt(form.clockHour, 10) || 0;
  const clockMinute = parseInt(form.clockMinute, 10) || 0;

  // 先拒绝不存在的公历日。若先用 Date 做晚子时 +1，2 月 30 日会被顺延到 3 月。
  if (!isValidGregorianDate(typedYear, typedMonth, typedDay)) {
    throw new RangeError(`solar date does not exist: ${typedYear}-${typedMonth}-${typedDay}`);
  }

  let y = typedYear;
  let m = typedMonth;
  let d = typedDay;
  // 晚子时（23:00-23:59）按次日处理。输入日期已经确认存在，这里的进位只跨月末/年末。
  if (!form.unknownTime && clockHour === 23) {
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    y = next.getUTCFullYear();
    m = next.getUTCMonth() + 1;
    d = next.getUTCDate();
  }

  const hour = form.unknownTime
    ? 0
    : calcTrueSolarBranch(clockHour, clockMinute, form.longitude);
  return {
    year: y, month: m, day: d,
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

/** 晚子时换日已经发生：钟点是 23，且排盘日不同于输入日。 */
export function isLateZiNextDay(info: Pick<BirthInfo, 'year' | 'month' | 'day' | 'origInput'>): boolean {
  const orig = info.origInput;
  if (!orig || orig.clockHour !== 23) return false;
  return orig.year !== info.year || orig.month !== info.month || orig.day !== info.day;
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

export function lateZiNoteForChart(info: Pick<BirthInfo, 'year' | 'month' | 'day' | 'origInput'>, lang: NoteLang = currentNoteLang()): string {
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
  if (form.longitude && form.longitude !== 120) p.set('lo', String(form.longitude));
  p.set('g', form.gender === 'male' ? 'm' : 'f');
  return p;
}

/** URLSearchParams → Partial<BirthFormState>，不完整时返回 null */
export function searchParamsToForm(params: URLSearchParams): Partial<BirthFormState> | null {
  const year = params.get('y');
  const month = params.get('m');
  const day = params.get('d');
  if (!year || !month || !day) return null;
  return {
    name: params.get('n') || '',
    year,
    month,
    day,
    unknownTime: params.get('u') === '1',
    clockHour: params.get('h') || '8',
    clockMinute: params.get('mi') || '0',
    province: params.get('p') || '',
    city: params.get('c') || '',
    longitude: parseFloat(params.get('lo') || '120'),
    gender: params.get('g') === 'f' ? 'female' : 'male',
  };
}
