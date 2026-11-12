/**
 * v3.0 样本数据集的公历日期网格，以及「不存在的公历日期」清洗。
 *
 * 发布包不在本仓库（约 33 GB，挂在 GitHub Releases）。生成口径是
 * 1924–1983 × 月 12 × 日 1–30 × 时辰 12 × 性别 2 = 518,400。
 * 日 1–30 把 2 月 30 日和平年 2 月 29 日也算了进去。iztro 不报错，
 * 农历换算落到 3 月 1–2 日，于是这些样本和真实的 3 月 1–2 日样本重复。
 *
 * 只按记录声明的公历日期判断。农历三十、闰月不是公历错误，不能在这里删。
 */
import { isLeapGregorianYear, isValidGregorianDate } from './gregorian-date';

export const V3_SAMPLE_YEAR_MIN = 1924;
export const V3_SAMPLE_YEAR_MAX = 1983;
export const V3_SAMPLE_DAY_MAX = 30;
export const V3_SAMPLE_HOURS = 12;
export const V3_SAMPLE_GENDERS = ['male', 'female'] as const;

export type SampleGender = (typeof V3_SAMPLE_GENDERS)[number];

export interface GregorianYmd {
  year: number;
  month: number;
  day: number;
}

export interface SampleSlot extends GregorianYmd {
  hour: number;
  gender: SampleGender;
}

const SLOTS_PER_DATE = V3_SAMPLE_HOURS * V3_SAMPLE_GENDERS.length;

/**
 * JS `Date` 与 iztro 的公历→农历换算会把不存在的公历日挪到的那一天。
 * 日期本身合法时，结果与输入相同。
 */
export function rolledGregorianDate(year: number, month: number, day: number): GregorianYmd {
  const probe = new Date(Date.UTC(year, month - 1, day));
  return {
    year: probe.getUTCFullYear(),
    month: probe.getUTCMonth() + 1,
    day: probe.getUTCDate(),
  };
}

export interface V3GridAudit {
  before: number;
  removed: number;
  after: number;
  feb30: number;
  feb29NonLeap: number;
  leapYears: number;
  nonLeapYears: number;
  /** 非法日期顺延后与真实 3 月 1 日或 3 月 2 日撞车的样本条数。 */
  marchDuplicatePairsBefore: number;
  marchDuplicatePairsAfter: number;
}

export function auditV3SampleGrid(): V3GridAudit {
  let before = 0;
  let removed = 0;
  let feb30 = 0;
  let feb29NonLeap = 0;
  let leapYears = 0;
  let marchDuplicatePairsBefore = 0;

  for (let year = V3_SAMPLE_YEAR_MIN; year <= V3_SAMPLE_YEAR_MAX; year++) {
    if (isLeapGregorianYear(year)) leapYears += 1;
    for (let month = 1; month <= 12; month++) {
      for (let day = 1; day <= V3_SAMPLE_DAY_MAX; day++) {
        before += SLOTS_PER_DATE;
        if (isValidGregorianDate(year, month, day)) continue;
        removed += SLOTS_PER_DATE;
        if (month === 2 && day === 30) feb30 += SLOTS_PER_DATE;
        else if (month === 2 && day === 29) feb29NonLeap += SLOTS_PER_DATE;
        const rolled = rolledGregorianDate(year, month, day);
        if (rolled.year === year && rolled.month === 3 && (rolled.day === 1 || rolled.day === 2)) {
          marchDuplicatePairsBefore += SLOTS_PER_DATE;
        }
      }
    }
  }

  const years = V3_SAMPLE_YEAR_MAX - V3_SAMPLE_YEAR_MIN + 1;
  return {
    before,
    removed,
    after: before - removed,
    feb30,
    feb29NonLeap,
    leapYears,
    nonLeapYears: years - leapYears,
    marchDuplicatePairsBefore,
    marchDuplicatePairsAfter: countMarchRolloverExtras(false),
  };
}

/**
 * 同一时辰、性别下，有效排盘日是 3 月 1 日或 3 月 2 日的样本出现了几次。
 * 多出来的次数就是顺延造成的重复盘。`includeInvalid` 为 false 时只数合法日期。
 */
export function countMarchRolloverExtras(includeInvalid: boolean): number {
  const counts = new Map<string, number>();
  for (let year = V3_SAMPLE_YEAR_MIN; year <= V3_SAMPLE_YEAR_MAX; year++) {
    for (let month = 1; month <= 12; month++) {
      for (let day = 1; day <= V3_SAMPLE_DAY_MAX; day++) {
        const valid = isValidGregorianDate(year, month, day);
        if (!includeInvalid && !valid) continue;
        const effective = valid ? { year, month, day } : rolledGregorianDate(year, month, day);
        if (effective.month !== 3 || (effective.day !== 1 && effective.day !== 2)) continue;
        if (effective.year !== year) continue;
        for (let hour = 0; hour < V3_SAMPLE_HOURS; hour++) {
          for (const gender of V3_SAMPLE_GENDERS) {
            const key = `${effective.year}-3-${effective.day}-${hour}-${gender}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
        }
      }
    }
  }
  let extras = 0;
  for (const count of counts.values()) {
    if (count > 1) extras += count - 1;
  }
  return extras;
}

/** 将来重新生成样本时用：只产出真实存在的公历日。 */
export function* iterateV3BirthDates(validOnly = true): Generator<GregorianYmd> {
  for (let year = V3_SAMPLE_YEAR_MIN; year <= V3_SAMPLE_YEAR_MAX; year++) {
    for (let month = 1; month <= 12; month++) {
      for (let day = 1; day <= V3_SAMPLE_DAY_MAX; day++) {
        if (validOnly && !isValidGregorianDate(year, month, day)) continue;
        yield { year, month, day };
      }
    }
  }
}

export type SampleCalendarDecision = 'keep' | 'drop' | 'unrecognized';

const SAMPLE_FILENAME = /^(\d{4})-(\d{2})-(\d{2})-h(\d{2})-/;

export function gregorianDateFromSampleFilename(filename: string): GregorianYmd | null {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const match = SAMPLE_FILENAME.exec(base);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function integerField(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
  }
  return null;
}

export interface DeclaredSampleDate {
  birthInfo?: { year?: unknown; month?: unknown; day?: unknown } | null;
  filename?: string;
}

export interface SampleDateDecision {
  decision: SampleCalendarDecision;
  date: GregorianYmd | null;
  source: 'birthInfo' | 'filename' | null;
}

/**
 * 样本该留还是该丢。
 * 有 `birthInfo` 的年月日时，只把这三个字段当公历，不读农历字段。
 * 没有出生日期时，才看文件名 `YYYY-MM-DD-hHH-*` 里的公历。
 * 两边都看不出公历日期（例如一条只声明了农历的记录）则保留，避免误删。
 */
export function classifyDeclaredSampleDate(input: DeclaredSampleDate): SampleDateDecision {
  const info = input.birthInfo;
  const hasBirthFields = !!info && (info.year !== undefined || info.month !== undefined || info.day !== undefined);
  if (hasBirthFields && info) {
    const year = integerField(info.year);
    const month = integerField(info.month);
    const day = integerField(info.day);
    if (year === null || month === null || day === null) {
      return { decision: 'unrecognized', date: null, source: 'birthInfo' };
    }
    const date = { year, month, day };
    return {
      decision: isValidGregorianDate(year, month, day) ? 'keep' : 'drop',
      date,
      source: 'birthInfo',
    };
  }
  if (input.filename) {
    const date = gregorianDateFromSampleFilename(input.filename);
    if (date) {
      return {
        decision: isValidGregorianDate(date.year, date.month, date.day) ? 'keep' : 'drop',
        date,
        source: 'filename',
      };
    }
  }
  return { decision: 'unrecognized', date: null, source: null };
}

export interface SampleCleanStats {
  before: number;
  removed: number;
  kept: number;
  unrecognized: number;
}

export function partitionSampleRecords<T>(
  records: readonly T[],
  read: (record: T) => DeclaredSampleDate,
): { kept: T[]; removed: T[]; unrecognized: T[]; stats: SampleCleanStats } {
  const kept: T[] = [];
  const removed: T[] = [];
  const unrecognized: T[] = [];
  for (const record of records) {
    const { decision } = classifyDeclaredSampleDate(read(record));
    if (decision === 'drop') removed.push(record);
    else if (decision === 'unrecognized') unrecognized.push(record);
    else kept.push(record);
  }
  return {
    kept,
    removed,
    unrecognized,
    stats: {
      before: records.length,
      removed: removed.length,
      kept: kept.length,
      unrecognized: unrecognized.length,
    },
  };
}

/** 非法公历日期顺延后，与同网格里真实 3 月 1–2 日撞车的对数。清洗后应为 0。 */
export function marchContentDuplicateCount(
  records: readonly SampleSlot[],
): number {
  const present = new Set(records.map((record) => (
    `${record.year}-${record.month}-${record.day}-${record.hour}-${record.gender}`
  )));
  let duplicates = 0;
  for (const record of records) {
    if (isValidGregorianDate(record.year, record.month, record.day)) continue;
    const rolled = rolledGregorianDate(record.year, record.month, record.day);
    if (rolled.month !== 3 || (rolled.day !== 1 && rolled.day !== 2)) continue;
    const target = `${rolled.year}-${rolled.month}-${rolled.day}-${record.hour}-${record.gender}`;
    if (present.has(target)) duplicates += 1;
  }
  return duplicates;
}
