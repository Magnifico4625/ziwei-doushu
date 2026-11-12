/**
 * 不存在的公历日期：排盘必须拒绝，样本网格里的重复盘必须能被洗掉。
 *
 * v3 样本按每月 1–30 日生成。iztro 对 2 月 30 日、平年 2 月 29 日不报错，
 * 农历换算落到 3 月 1–2 日，于是和真实的 3 月样本重复。
 * 农历三十和闰月是合法的，不在这次清洗里。
 *
 * 跑: npx tsx scripts/regression/invalid-sample-dates.test.ts
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { astro } from 'iztro';
import { generateChart } from '../../lib/ziwei/algorithm';
import {
  daysInGregorianMonth,
  isLeapGregorianYear,
  isValidGregorianDate,
} from '../../lib/ziwei/gregorian-date';
import {
  isValidLunarDate,
  leapMonthOfLunarYear,
  lunarMonthDayCount,
} from '../../lib/ziwei/lunar-solar';
import {
  auditV3SampleGrid,
  classifyDeclaredSampleDate,
  countMarchRolloverExtras,
  iterateV3BirthDates,
  marchContentDuplicateCount,
  partitionSampleRecords,
  rolledGregorianDate,
  V3_SAMPLE_GENDERS,
  V3_SAMPLE_HOURS,
  V3_SAMPLE_YEAR_MAX,
  V3_SAMPLE_YEAR_MIN,
  type SampleSlot,
} from '../../lib/ziwei/sample-dates';
import { cleanSampleDirectory, cleanSampleJsonl } from '../dataset/clean-v3-samples';
import { formToBirthInfo } from '../../lib/ziwei/share';
import type { BirthInfo } from '../../lib/ziwei/types';
import type { BirthFormState } from '../../components/BirthForm';

const base: BirthInfo = { year: 2000, month: 3, day: 1, hour: 0, gender: 'male' };

function rejected(year: number, month: number, day: number): void {
  assert.equal(isValidGregorianDate(year, month, day), false, `${year}-${month}-${day} is not a real solar date`);
  assert.throws(
    () => generateChart({ ...base, year, month, day }),
    (error: unknown) => error instanceof RangeError && String((error as Error).message).includes(`${year}-${month}-${day}`),
    `${year}-${month}-${day} must be rejected before a chart is built`,
  );
}

function accepted(year: number, month: number, day: number): void {
  assert.equal(isValidGregorianDate(year, month, day), true, `${year}-${month}-${day} is a real solar date`);
  const chart = generateChart({ ...base, year, month, day });
  assert.equal(chart.birthInfo.year, year);
  assert.equal(chart.birthInfo.month, month);
  assert.equal(chart.birthInfo.day, day, `${year}-${month}-${day} must stay on that day`);
}

rejected(2023, 2, 30);
rejected(2024, 2, 30);
rejected(1900, 2, 29);
rejected(2023, 2, 29);
accepted(2000, 2, 29);
accepted(2024, 2, 29);
assert.equal(isLeapGregorianYear(1900), false);
assert.equal(isLeapGregorianYear(2000), true);
assert.equal(daysInGregorianMonth(1900, 2), 28);
assert.equal(daysInGregorianMonth(2000, 2), 29);
assert.equal(daysInGregorianMonth(2024, 4), 30);
assert.equal(isValidGregorianDate(2024, 4, 31), false);

// 公历校验必须和 Date 的顺延结果一致：合法日期不动，非法日期才被挪走。
for (let year = V3_SAMPLE_YEAR_MIN; year <= V3_SAMPLE_YEAR_MAX; year++) {
  for (let month = 1; month <= 12; month++) {
    for (let day = 1; day <= 31; day++) {
      const rolled = rolledGregorianDate(year, month, day);
      const same = rolled.year === year && rolled.month === month && rolled.day === day;
      assert.equal(isValidGregorianDate(year, month, day), same, `${year}-${month}-${day}`);
    }
  }
}

assert.deepEqual(rolledGregorianDate(2023, 2, 29), { year: 2023, month: 3, day: 1 });
assert.deepEqual(rolledGregorianDate(2023, 2, 30), { year: 2023, month: 3, day: 2 });
assert.deepEqual(rolledGregorianDate(2024, 2, 30), { year: 2024, month: 3, day: 1 });
assert.deepEqual(rolledGregorianDate(1900, 2, 29), { year: 1900, month: 3, day: 1 });
assert.deepEqual(rolledGregorianDate(2000, 2, 29), { year: 2000, month: 2, day: 29 });
assert.deepEqual(rolledGregorianDate(2024, 2, 29), { year: 2024, month: 2, day: 29 });

function formAt(year: string, month: string, day: string, clockHour: string): BirthFormState {
  return {
    name: '',
    year,
    month,
    day,
    clockHour,
    clockMinute: '30',
    unknownTime: false,
    province: '',
    city: '',
    longitude: 120,
    gender: 'male',
  };
}

assert.throws(
  () => formToBirthInfo(formAt('2023', '2', '30', '23')),
  RangeError,
  'late zi hour must not roll Feb 30 forward',
);
assert.throws(
  () => formToBirthInfo(formAt('2023', '2', '29', '8')),
  RangeError,
);
const leapLateZi = formToBirthInfo(formAt('2024', '2', '29', '23'));
assert.deepEqual(
  { year: leapLateZi.year, month: leapLateZi.month, day: leapLateZi.day },
  { year: 2024, month: 3, day: 1 },
);

interface PalaceLike {
  name: string;
  earthlyBranch: string;
  majorStars?: { name: string }[];
}

function chartAnchor(date: string): string {
  const chart = astro.bySolar(date, 0, '男', true, 'zh-CN');
  const palaces = chart.palaces as PalaceLike[];
  const ming = palaces.find((palace) => palace.name === '命宫');
  const ziwei = palaces.find((palace) => (palace.majorStars ?? []).some((star) => star.name === '紫微'));
  return `${chart.lunarDate}|${ming?.earthlyBranch}|${ziwei?.earthlyBranch}`;
}

// iztro 仍然会把不存在的公历日排成 3 月 1–2 日的盘。网格里每一个非法日期都核对一次。
let rolloverChecks = 0;
for (let year = V3_SAMPLE_YEAR_MIN; year <= V3_SAMPLE_YEAR_MAX; year++) {
  for (const day of [29, 30]) {
    if (isValidGregorianDate(year, 2, day)) continue;
    const rolled = rolledGregorianDate(year, 2, day);
    const from = `${year}-2-${day}`;
    const to = `${rolled.year}-${rolled.month}-${rolled.day}`;
    assert.equal(chartAnchor(from), chartAnchor(to), `${from} silently matches ${to}`);
    rolloverChecks += 1;
  }
}
assert.equal(rolloverChecks, 105);
assert.notEqual(chartAnchor('2000-2-29'), chartAnchor('2000-3-1'));
assert.notEqual(chartAnchor('2024-2-29'), chartAnchor('2024-3-1'));

const audit = auditV3SampleGrid();
assert.equal(audit.leapYears, 15);
assert.equal(audit.nonLeapYears, 45);
assert.equal(audit.feb30, 60 * V3_SAMPLE_HOURS * V3_SAMPLE_GENDERS.length);
assert.equal(audit.feb29NonLeap, 45 * V3_SAMPLE_HOURS * V3_SAMPLE_GENDERS.length);
assert.equal(audit.feb30 + audit.feb29NonLeap, audit.removed);
assert.equal(audit.before, 518_400);
assert.equal(audit.removed, 2_520);
assert.equal(audit.after, 515_880);
assert.equal(audit.marchDuplicatePairsBefore, audit.removed);
assert.equal(countMarchRolloverExtras(true), 2_520);
assert.equal(audit.marchDuplicatePairsAfter, 0);
assert.equal(countMarchRolloverExtras(false), 0);

let generatedDates = 0;
for (const date of iterateV3BirthDates(true)) {
  assert.equal(isValidGregorianDate(date.year, date.month, date.day), true);
  assert.equal(date.month === 2 && date.day === 30, false);
  generatedDates += 1;
}
assert.equal(generatedDates * V3_SAMPLE_HOURS * V3_SAMPLE_GENDERS.length, audit.after);

// 农历三十、闰月合法，清洗不能按「日 === 30」一刀切。
assert.equal(leapMonthOfLunarYear(1906), 4);
assert.equal(lunarMonthDayCount(1906, 4, true), 30);
assert.equal(isValidLunarDate(1906, 4, 30, true), true);
assert.equal(isValidLunarDate(1906, 4, 31, true), false);
let shortLunarMonth = false;
for (let year = 2020; year <= 2030 && !shortLunarMonth; year++) {
  for (let month = 1; month <= 12; month++) {
    if (lunarMonthDayCount(year, month, false) !== 29) continue;
    assert.equal(isValidLunarDate(year, month, 30, false), false);
    assert.equal(isValidLunarDate(year, month, 29, false), true);
    shortLunarMonth = true;
    break;
  }
}
assert.equal(shortLunarMonth, true);

interface FixtureRecord {
  id: string;
  birthInfo?: { year: number; month: number; day: number; hour: number; gender: 'male' | 'female' };
  lunarInfo?: { lunarDay: number; isLeapMonth: boolean };
  filename?: string;
}

const fixture: FixtureRecord[] = [
  { id: 'bad-2023-02-29', birthInfo: { year: 2023, month: 2, day: 29, hour: 0, gender: 'male' } },
  { id: 'bad-2023-02-30', birthInfo: { year: 2023, month: 2, day: 30, hour: 0, gender: 'male' } },
  { id: 'mar-1', birthInfo: { year: 2023, month: 3, day: 1, hour: 0, gender: 'male' } },
  { id: 'mar-2', birthInfo: { year: 2023, month: 3, day: 2, hour: 0, gender: 'male' } },
  { id: 'leap-feb-29', birthInfo: { year: 2024, month: 2, day: 29, hour: 0, gender: 'female' } },
  { id: 'bad-leap-feb-30', birthInfo: { year: 2024, month: 2, day: 30, hour: 0, gender: 'female' } },
  { id: 'leap-mar-1', birthInfo: { year: 2024, month: 3, day: 1, hour: 0, gender: 'female' } },
  { id: 'year-1900', birthInfo: { year: 1900, month: 2, day: 29, hour: 1, gender: 'male' } },
  { id: 'year-2000', birthInfo: { year: 2000, month: 2, day: 29, hour: 1, gender: 'male' } },
  {
    id: 'lunar-day-30',
    birthInfo: { year: 1925, month: 4, day: 30, hour: 2, gender: 'male' },
    lunarInfo: { lunarDay: 30, isLeapMonth: true },
  },
  { id: 'lunar-only', lunarInfo: { lunarDay: 30, isLeapMonth: true } },
];

const slots = (records: readonly FixtureRecord[]): SampleSlot[] => records.flatMap((record) => (
  record.birthInfo
    ? [{ ...record.birthInfo }]
    : []
));

assert.equal(marchContentDuplicateCount(slots(fixture)), 3);
const partitioned = partitionSampleRecords(fixture, (record) => ({
  birthInfo: record.birthInfo,
  filename: record.filename,
}));
assert.deepEqual(partitioned.removed.map((record) => record.id), [
  'bad-2023-02-29',
  'bad-2023-02-30',
  'bad-leap-feb-30',
  'year-1900',
]);
assert.equal(partitioned.stats.before, fixture.length);
assert.equal(partitioned.stats.removed, 4);
assert.equal(partitioned.stats.unrecognized, 1);
assert.equal(partitioned.unrecognized[0]?.id, 'lunar-only');
assert.equal(partitioned.kept.some((record) => record.id === 'lunar-day-30'), true);
assert.equal(partitioned.kept.some((record) => record.id === 'leap-feb-29'), true);
assert.equal(partitioned.kept.some((record) => record.id === 'year-2000'), true);
assert.equal(marchContentDuplicateCount(slots(partitioned.kept)), 0);
const marchLeft = partitioned.kept.filter((record) => record.birthInfo?.month === 3);
assert.deepEqual(marchLeft.map((record) => record.id), ['mar-1', 'mar-2', 'leap-mar-1']);

assert.equal(
  classifyDeclaredSampleDate({ filename: '1925-02-30-h00-male.json' }).decision,
  'drop',
);
assert.equal(
  classifyDeclaredSampleDate({
    birthInfo: { year: 1925, month: 4, day: 30 },
    filename: 'ignored.json',
  }).decision,
  'keep',
);

const root = mkdtempSync(path.join(tmpdir(), 'ziwei-samples-'));
const inputDir = path.join(root, 'in');
const outputDir = path.join(root, 'out');
mkdirSync(inputDir);
const files: Record<string, unknown> = {
  '2023-02-29-h00-male.json': { birthInfo: { year: 2023, month: 2, day: 29, hour: 0, gender: 'male' } },
  '2023-02-30-h00-male.json': { birthInfo: { year: 2023, month: 2, day: 30, hour: 0, gender: 'male' } },
  '2023-03-01-h00-male.json': { birthInfo: { year: 2023, month: 3, day: 1, hour: 0, gender: 'male' } },
  '2023-03-02-h00-male.json': { birthInfo: { year: 2023, month: 3, day: 2, hour: 0, gender: 'male' } },
  '2024-02-29-h00-female.json': { birthInfo: { year: 2024, month: 2, day: 29, hour: 0, gender: 'female' } },
  '2024-02-30-h00-female.json': { birthInfo: { year: 2024, month: 2, day: 30, hour: 0, gender: 'female' } },
  '1900-02-29-h01-male.json': { birthInfo: { year: 1900, month: 2, day: 29, hour: 1, gender: 'male' } },
  '2000-02-29-h01-male.json': { birthInfo: { year: 2000, month: 2, day: 29, hour: 1, gender: 'male' } },
  '1925-04-30-h02-male.json': {
    birthInfo: { year: 1925, month: 4, day: 30, hour: 2, gender: 'male' },
    lunarInfo: { lunarDay: 30, isLeapMonth: true },
  },
  'lunar-leap-month.json': { calendar: 'lunar', month: 4, day: 30, isLeapMonth: true },
  '2023-02-30-h03-male.json': {},
};
for (const [name, body] of Object.entries(files)) {
  writeFileSync(path.join(inputDir, name), JSON.stringify(body));
}

async function cleanFixtures(): Promise<void> {
  try {
    const directoryStats = await cleanSampleDirectory(inputDir, outputDir);
    assert.equal(directoryStats.before, 11);
    assert.equal(directoryStats.removed, 5);
    assert.equal(directoryStats.kept, 5);
    assert.equal(directoryStats.unrecognized, 1);
    assert.equal(directoryStats.errors.length, 0);
    const written = readdirSync(outputDir).sort();
    assert.deepEqual(written, [
      '1925-04-30-h02-male.json',
      '2000-02-29-h01-male.json',
      '2023-03-01-h00-male.json',
      '2023-03-02-h00-male.json',
      '2024-02-29-h00-female.json',
      'lunar-leap-month.json',
    ]);
    const keptLunar = JSON.parse(readFileSync(path.join(outputDir, '1925-04-30-h02-male.json'), 'utf8')) as {
      lunarInfo: { lunarDay: number; isLeapMonth: boolean };
    };
    assert.equal(keptLunar.lunarInfo.lunarDay, 30);
    assert.equal(keptLunar.lunarInfo.isLeapMonth, true);

    const jsonlPath = path.join(root, 'samples.jsonl');
    const jsonlOut = path.join(root, 'clean.jsonl');
    writeFileSync(jsonlPath, `${fixture.map((record) => JSON.stringify(record)).join('\n')}\n`);
    const jsonlStats = await cleanSampleJsonl(jsonlPath, jsonlOut);
    assert.equal(jsonlStats.before, fixture.length);
    assert.equal(jsonlStats.removed, 4);
    assert.equal(jsonlStats.kept, 6);
    assert.equal(jsonlStats.unrecognized, 1);
    const jsonlIds = readFileSync(jsonlOut, 'utf8').trim().split('\n').map((line) => JSON.parse(line).id as string);
    assert.equal(jsonlIds.includes('bad-2023-02-30'), false);
    assert.equal(jsonlIds.includes('mar-1'), true);
    assert.equal(jsonlIds.includes('lunar-only'), true);

    const cli = execFileSync(process.execPath, [
      path.resolve('node_modules/tsx/dist/cli.mjs'),
      path.resolve('scripts/dataset/clean-v3-samples.ts'),
    ], { encoding: 'utf8' });
    const gridLine = cli.trim().split('\n').find((line) => line.startsWith('{'));
    assert.ok(gridLine);
    const grid = JSON.parse(gridLine) as {
      grid: { before: number; removed: number; after: number; marchDuplicatePairsAfter: number };
    };
    assert.equal(grid.grid.before, 518_400);
    assert.equal(grid.grid.removed, 2_520);
    assert.equal(grid.grid.after, 515_880);
    assert.equal(grid.grid.marchDuplicatePairsAfter, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

cleanFixtures().then(() => {
  console.log(
    `invalid solar dates: before ${audit.before} removed ${audit.removed} after ${audit.after}; `
    + `March 1/2 duplicate rows before ${audit.marchDuplicatePairsBefore} after ${audit.marchDuplicatePairsAfter}; `
    + `iztro rollover checks ${rolloverChecks}`,
  );
}).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
