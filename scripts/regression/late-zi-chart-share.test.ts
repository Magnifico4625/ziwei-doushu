/**
 * 晚子时：/chart 与分享链接必须排出同一张盘。
 *
 * 项目口径（README、school 默认 lateZishi = next-day、share.ts）：
 *   · 23:00–23:59 晚子时，按次日排盘，时辰支仍是子（0）
 *   · 00:00–00:59 早子时，按当日排盘，时辰支也是子（0）
 *   · 「日期 +1」只作用于已经存在的公历日；2 月 30 日、平年 2 月 29 日先拒绝，再交给 iztro
 *
 * main 上 /chart 走 BirthForm.handleSubmit，把表单上的公历日原样交出去，23 点不换日。
 * 分享 / 合盘走 formToBirthInfo，23 点才 +1。同一份生辰因此两张盘。
 *
 * 跑: npx tsx scripts/regression/late-zi-chart-share.test.ts
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Solar } from 'lunar-javascript';
import type { BirthFormState } from '../../components/BirthForm';
import { generateChart } from '../../lib/ziwei/algorithm';
import { isValidGregorianDate } from '../../lib/ziwei/gregorian-date';
import { lunarToSolar } from '../../lib/ziwei/lunar-solar';
import { SCHOOL_DEFAULT_CONFIG } from '../../lib/ziwei/school-config';
import { calcTrueSolarBranch, formToBirthInfo } from '../../lib/ziwei/share';
import type { BirthInfo, ZiweiChart } from '../../lib/ziwei/types';

assert.equal(
  SCHOOL_DEFAULT_CONFIG.lateZishi,
  'next-day',
  'default late-zi rule is the next civil day; this test locks that convention',
);

const birthFormSrc = readFileSync(path.resolve('components/BirthForm.tsx'), 'utf8');
const submitStart = birthFormSrc.indexOf('const handleSubmit');
const submitEnd = birthFormSrc.indexOf('const bg = isDark');
assert.ok(submitStart >= 0 && submitEnd > submitStart, 'BirthForm handleSubmit block should be locatable');
const submitBody = birthFormSrc.slice(submitStart, submitEnd);
const chartUsesSharedHelper = /onSubmit\(formToBirthInfo\(form\)\)/.test(submitBody);
const chartSubmitsRawDate = /onSubmit\(\s*\{/.test(submitBody);
assert.equal(
  chartUsesSharedHelper && chartSubmitsRawDate,
  false,
  'handleSubmit cannot both call formToBirthInfo and submit the raw year/month/day',
);

function blankForm(year: string, month: string, day: string, clockHour: string, clockMinute = '30'): BirthFormState {
  return {
    name: '',
    year,
    month,
    day,
    clockHour,
    clockMinute,
    unknownTime: false,
    province: '',
    city: '',
    longitude: 120,
    gender: 'male',
  };
}

/**
 * main 上 /chart 的提交结果（BirthForm.handleSubmit，9624865）。
 * 只用作对照基线：23 点不换日。时辰支与 formToBirthInfo 用同一个 calcTrueSolarBranch。
 */
function mainChartBirthInfo(form: BirthFormState): BirthInfo {
  const year = parseInt(form.year, 10) || 0;
  const month = parseInt(form.month, 10) || 0;
  const day = parseInt(form.day, 10) || 0;
  const hour = form.unknownTime
    ? 0
    : calcTrueSolarBranch(parseInt(form.clockHour, 10) || 0, parseInt(form.clockMinute, 10) || 0, form.longitude);
  return {
    year,
    month,
    day,
    hour,
    gender: form.gender,
    name: form.name || undefined,
    province: form.province || undefined,
    city: form.city || undefined,
    longitude: form.province ? form.longitude : undefined,
  };
}

/** /chart 现在必须走 formToBirthInfo；没接上之前，测试看到的就是 main 的原始日期。 */
function chartBirthInfo(form: BirthFormState): BirthInfo {
  return chartUsesSharedHelper ? formToBirthInfo(form) : mainChartBirthInfo(form);
}

function ymdh(info: BirthInfo): { year: number; month: number; day: number; hour: number } {
  return { year: info.year, month: info.month, day: info.day, hour: info.hour };
}

function starLayout(chart: ZiweiChart): string {
  return chart.palaces
    .slice()
    .sort((a, b) => a.branch - b.branch)
    .map((palace) => {
      const stars = palace.stars.map((star) => `${star.name}${star.siHua ? `/${star.siHua}` : ''}`).join('+');
      return `${palace.branch}${palace.name}:${stars}`;
    })
    .join('|');
}

function fullHash(chart: ZiweiChart): string {
  const body = {
    y: chart.birthInfo.year,
    m: chart.birthInfo.month,
    d: chart.birthInfo.day,
    h: chart.birthInfo.hour,
    g: chart.birthInfo.gender,
    lunar: chart.lunarInfo,
    ming: chart.mingGongBranch,
    shen: chart.shenGongBranch,
    ziwei: chart.ziweiPos,
    ju: chart.wuxingJuName,
    yinYang: chart.yinYangGender,
    stars: starLayout(chart),
  };
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

function rawLunar(year: number, month: number, day: number): { year: number; month: number; day: number } {
  const lunar = Solar.fromYmd(year, month, day).getLunar();
  return {
    year: Number(lunar.getYear()),
    month: Number(lunar.getMonth()),
    day: Number(lunar.getDay()),
  };
}

function assertSameChart(form: BirthFormState, expected: { year: number; month: number; day: number; hour: number }, label: string): void {
  const chartInfo = chartBirthInfo(form);
  const shareInfo = formToBirthInfo(form);
  assert.deepEqual(ymdh(chartInfo), expected, `${label}: /chart`);
  assert.deepEqual(ymdh(shareInfo), expected, `${label}: share`);
  assert.deepEqual(chartInfo, shareInfo, `${label}: /chart BirthInfo must equal the share helper`);
  assert.equal(fullHash(generateChart(chartInfo)), fullHash(generateChart(shareInfo)), `${label}: chart hash`);
}

function assertRejected(year: string, month: string, day: string): void {
  const form = blankForm(year, month, day, '23');
  const label = `${year}-${month}-${day} 23:30`;
  assert.equal(isValidGregorianDate(Number(year), Number(month), Number(day)), false, label);
  assert.throws(
    () => chartBirthInfo(form),
    (error: unknown) => error instanceof RangeError && String((error as Error).message).includes(`${Number(year)}-${Number(month)}-${Number(day)}`),
    `${label} must be rejected on /chart before iztro`,
  );
  assert.throws(
    () => formToBirthInfo(form),
    (error: unknown) => error instanceof RangeError && String((error as Error).message).includes(`${Number(year)}-${Number(month)}-${Number(day)}`),
    `${label} must be rejected on the share path before iztro`,
  );
  assert.throws(
    () => generateChart({ year: Number(year), month: Number(month), day: Number(day), hour: 0, gender: 'male' }),
    RangeError,
    `${label} must still be rejected by generateChart`,
  );
}

assertSameChart(blankForm('1990', '1', '31', '23', '30'), { year: 1990, month: 2, day: 1, hour: 0 }, 'month end 1990-01-31 23:30');
assertSameChart(blankForm('1990', '1', '31', '23', '0'), { year: 1990, month: 2, day: 1, hour: 0 }, 'month end 1990-01-31 23:00');
assertSameChart(blankForm('1990', '1', '31', '23', '59'), { year: 1990, month: 2, day: 1, hour: 0 }, 'month end 1990-01-31 23:59');
assertSameChart(blankForm('1990', '1', '31', '0', '30'), { year: 1990, month: 1, day: 31, hour: 0 }, 'early zi stays on 1990-01-31');
assertSameChart(blankForm('1990', '4', '30', '23', '30'), { year: 1990, month: 5, day: 1, hour: 0 }, '30-day month 1990-04-30 23:30');

assertSameChart(blankForm('1990', '12', '31', '23', '30'), { year: 1991, month: 1, day: 1, hour: 0 }, 'year end 1990-12-31 23:30');
assertSameChart(blankForm('1990', '12', '31', '23', '59'), { year: 1991, month: 1, day: 1, hour: 0 }, 'year end 1990-12-31 23:59');
assertSameChart(blankForm('2000', '12', '31', '0', '0'), { year: 2000, month: 12, day: 31, hour: 0 }, 'early zi stays on 2000-12-31');
assertSameChart(blankForm('1990', '12', '31', '22', '59'), { year: 1990, month: 12, day: 31, hour: 11 }, '22:59 is still hai hour on the same day');

assertSameChart(blankForm('1990', '2', '28', '23', '30'), { year: 1990, month: 3, day: 1, hour: 0 }, 'common-year Feb 28 23:30');
assertSameChart(blankForm('1900', '2', '28', '23', '30'), { year: 1900, month: 3, day: 1, hour: 0 }, 'century common-year Feb 28 23:30');
assertSameChart(blankForm('2023', '2', '28', '23', '30'), { year: 2023, month: 3, day: 1, hour: 0 }, '2023 Feb 28 23:30');
assertSameChart(blankForm('2000', '2', '28', '23', '30'), { year: 2000, month: 2, day: 29, hour: 0 }, 'leap-year Feb 28 23:30 lands on Feb 29');
assertSameChart(blankForm('2000', '2', '29', '23', '0'), { year: 2000, month: 3, day: 1, hour: 0 }, 'leap-year Feb 29 23:00');
assertSameChart(blankForm('2000', '2', '29', '23', '59'), { year: 2000, month: 3, day: 1, hour: 0 }, 'leap-year Feb 29 23:59');
assertSameChart(blankForm('2024', '2', '28', '23', '30'), { year: 2024, month: 2, day: 29, hour: 0 }, '2024 Feb 28 23:30');
assertSameChart(blankForm('2024', '2', '29', '23', '30'), { year: 2024, month: 3, day: 1, hour: 0 }, '2024 Feb 29 23:30');
assertSameChart(blankForm('2024', '2', '29', '0', '30'), { year: 2024, month: 2, day: 29, hour: 0 }, 'early zi stays on leap-day Feb 29');

assertRejected('2023', '2', '29');
assertRejected('2023', '2', '30');
assertRejected('1900', '2', '29');
assertRejected('2024', '2', '30');
assertRejected('1990', '4', '31');

const named = blankForm('1990', '12', '31', '23', '30');
named.name = '晚子';
named.gender = 'female';
named.province = '新疆';
named.city = '乌鲁木齐';
named.longitude = 87.6;
const namedInfo = chartBirthInfo(named);
assert.deepEqual(ymdh(namedInfo), {
  year: 1991,
  month: 1,
  day: 1,
  hour: calcTrueSolarBranch(23, 30, 87.6),
});
assert.equal(namedInfo.name, '晚子');
assert.equal(namedInfo.gender, 'female');
assert.equal(namedInfo.province, '新疆');
assert.equal(namedInfo.city, '乌鲁木齐');
assert.equal(namedInfo.longitude, 87.6);
assert.deepEqual(namedInfo, formToBirthInfo(named));
assert.notEqual(calcTrueSolarBranch(23, 30, 87.6), 0, 'Urumqi 23:30 is not zi hour, but the date still advances');

const unknown = blankForm('1990', '1', '31', '23', '30');
unknown.unknownTime = true;
assertSameChart(unknown, { year: 1990, month: 1, day: 31, hour: 0 }, 'unknown time does not apply the late-zi day shift');

const leapMidSolar = lunarToSolar(2017, 6, 15, true);
const leapLastSolar = lunarToSolar(2017, 6, 30, true);
const leapStartSolar = lunarToSolar(2023, 2, 1, true);
assert.ok(leapMidSolar && leapLastSolar && leapStartSolar);
assert.deepEqual(leapLastSolar, { year: 2017, month: 8, day: 21 });
assert.deepEqual(leapStartSolar, { year: 2023, month: 3, day: 22 });

function lunarForm(solar: { year: number; month: number; day: number }): BirthFormState {
  return blankForm(String(solar.year), String(solar.month), String(solar.day), '23', '30');
}

const leapMidForm = lunarForm(leapMidSolar);
const leapMidInfo = chartBirthInfo(leapMidForm);
const leapMidRaw = rawLunar(leapMidSolar.year, leapMidSolar.month, leapMidSolar.day);
const leapMidNextRaw = rawLunar(leapMidInfo.year, leapMidInfo.month, leapMidInfo.day);
assert.ok(leapMidRaw.month < 0, '2017 leap-month day 15 is a lunar leap day');
assert.equal(leapMidNextRaw.month, leapMidRaw.month);
assert.equal(leapMidNextRaw.day, leapMidRaw.day + 1);
assertSameChart(leapMidForm, ymdh(formToBirthInfo(leapMidForm)), 'lunar leap month, middle day, 23:30');
assert.notEqual(
  starLayout(generateChart(mainChartBirthInfo(leapMidForm))),
  starLayout(generateChart(formToBirthInfo(leapMidForm))),
  'crossing the leap-month split at 23:30 changes the star layout',
);

const leapLastForm = lunarForm(leapLastSolar);
const leapLastInfo = chartBirthInfo(leapLastForm);
const leapLastRaw = rawLunar(leapLastSolar.year, leapLastSolar.month, leapLastSolar.day);
const leapLastNextRaw = rawLunar(leapLastInfo.year, leapLastInfo.month, leapLastInfo.day);
assert.ok(leapLastRaw.month < 0, '2017-08-21 is lunar leap month 6 day 30');
assert.ok(leapLastNextRaw.month > 0, 'the next civil day has left the leap month');
assertSameChart(leapLastForm, { year: 2017, month: 8, day: 22, hour: 0 }, 'lunar leap month, last day, 23:30');

const leapStartForm = lunarForm(leapStartSolar);
const leapStartInfo = chartBirthInfo(leapStartForm);
const leapStartRaw = rawLunar(leapStartSolar.year, leapStartSolar.month, leapStartSolar.day);
const leapStartNextRaw = rawLunar(leapStartInfo.year, leapStartInfo.month, leapStartInfo.day);
assert.ok(leapStartRaw.month < 0);
assert.equal(leapStartNextRaw.month, leapStartRaw.month);
assert.equal(leapStartNextRaw.day, 2);
assertSameChart(leapStartForm, { year: 2023, month: 3, day: 23, hour: 0 }, '2023 lunar leap month, first day, 23:30');

interface GridStats {
  samples: number;
  fullDiffs: number;
  starDiffs: number;
}

function compareGrid(forms: BirthFormState[]): GridStats {
  let samples = 0;
  let fullDiffs = 0;
  let starDiffs = 0;
  for (const form of forms) {
    const year = parseInt(form.year, 10);
    const month = parseInt(form.month, 10);
    const day = parseInt(form.day, 10);
    if (!isValidGregorianDate(year, month, day)) continue;
    const before = generateChart(mainChartBirthInfo(form));
    const after = generateChart(formToBirthInfo(form));
    samples += 1;
    if (fullHash(before) !== fullHash(after)) fullDiffs += 1;
    if (starLayout(before) !== starLayout(after)) starDiffs += 1;
  }
  return { samples, fullDiffs, starDiffs };
}

const years = [1990, 2000, 2023, 2024];
const months = [1, 2, 12];
const days = [1, 28, 29, 31];
const genders = ['male', 'female'] as const;

function gridForms(hours: string[], minutes: string[], longitude = 120): BirthFormState[] {
  const forms: BirthFormState[] = [];
  for (const year of years)
    for (const month of months)
      for (const day of days)
        for (const hour of hours)
          for (const minute of minutes)
            for (const gender of genders) {
              const form = blankForm(String(year), String(month), String(day), hour, minute);
              form.gender = gender;
              form.longitude = longitude;
              forms.push(form);
            }
  return forms;
}

const nonLate = compareGrid(gridForms(['0', '8', '22'], ['30']));
const late = compareGrid(gridForms(['23'], ['0', '59']));
const longitudes = [87.6, 116.4, 121.5, 126.5];
const longitudeDates = [
  blankForm('1990', '1', '31', '0', '30'),
  blankForm('2000', '2', '28', '0', '30'),
  blankForm('2000', '2', '29', '0', '30'),
  blankForm('2024', '12', '31', '0', '30'),
];
function longitudeForms(hours: string[]): BirthFormState[] {
  const forms: BirthFormState[] = [];
  for (const longitude of longitudes)
    for (const seed of longitudeDates)
      for (const hour of hours)
        for (const gender of genders) {
          forms.push({ ...seed, clockHour: hour, longitude, gender });
        }
  return forms;
}
const nonLateLongitude = compareGrid(longitudeForms(['0', '22']));
const lateLongitude = compareGrid(longitudeForms(['23']));

const unknownForms: BirthFormState[] = [];
for (const hour of ['0', '8', '23']) {
  const form = blankForm('1990', '1', '31', hour, '30');
  form.unknownTime = true;
  unknownForms.push(form);
}
const unknownStats = compareGrid(unknownForms);

assert.equal(nonLate.fullDiffs, 0, 'non-23:xx charts at longitude 120 must match main');
assert.equal(nonLate.starDiffs, 0);
assert.equal(nonLateLongitude.fullDiffs, 0, 'non-23:xx charts at other longitudes must match main');
assert.equal(nonLateLongitude.starDiffs, 0);
assert.equal(unknownStats.fullDiffs, 0, 'unknown time must not shift the chart date');
assert.equal(unknownStats.starDiffs, 0);
assert.equal(late.fullDiffs, late.samples, 'every valid 23:xx chart at longitude 120 changes');
assert.equal(late.starDiffs, late.samples, 'every valid 23:xx chart at longitude 120 changes star layout');
assert.equal(lateLongitude.fullDiffs, lateLongitude.samples, 'every valid 23:xx chart at other longitudes changes');
assert.equal(lateLongitude.starDiffs, lateLongitude.samples, 'every valid 23:xx chart at other longitudes changes star layout');
assert.equal(chartUsesSharedHelper, true, '/chart handleSubmit must call formToBirthInfo(form)');

console.log(
  `late zi /chart vs share: non-23 full diffs ${nonLate.fullDiffs}/${nonLate.samples}, `
  + `star diffs ${nonLate.starDiffs}; longitude non-23 ${nonLateLongitude.fullDiffs}/${nonLateLongitude.samples}; `
  + `23:xx full diffs ${late.fullDiffs}/${late.samples}, star diffs ${late.starDiffs}; `
  + `longitude 23:xx full diffs ${lateLongitude.fullDiffs}/${lateLongitude.samples}, star diffs ${lateLongitude.starDiffs}`,
);
