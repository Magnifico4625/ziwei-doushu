/**
 * 闰月「保持闰月」(origin-month) 在「本月 29 天、闰月 30 天」时必须能排盘。
 *
 * 口径（与 iztro fixLeap=false 一致，不把三十夹成二十九，也不滚进下月）：
 *   iztro `fixLunarMonthIndex` 只在 fixLeap && 闰月日>15 时把月份索引 +1。
 *   fixLeap=false 时闰月整月仍用本月序号安命宫、安月系星，日序用真实农历日。
 *   文档：https://docs.iztro.com/posts/astrolabe （byLunar 的 fixLeap：
 *   true = 前半月算上月、后半月算下月；false = 不调整）。
 *   上游 Rust 端口把这档写成 LeapMonthBoundary::AsPreviousMonth，并注明
 *   等价于 iztro fixLeap=false：
 *   https://docs.rs/iztro/latest/iztro/core/calculation/enum.LeapMonthBoundary.html
 *
 * 根因不在「三十日本月不存在所以要改日」，而在 lunar-lite@0.2.8 的 lunar2solar：
 *   它先 Lunar.fromYmd(年, 正数月, 日)，再决定要不要改成负月。
 *   lunar-typescript 在天数不够时抛 `only N days in lunar year Y month M`
 *   （Lunar.fromYmdHms）。2017 六月只有 29 天，闰六月有 30 天，
 *   lunar2solar('2017-6-30', true) 因此抛错，负月根本建不出来。
 *   6tail 负月才是闰月：Lunar.fromYmd(2017, -6, 30) = 2017-08-21。
 *   夹到二十九会排成另一天的盘（紫微落宫不同）。
 *
 * 能通过 lunar2solar 的闰月日上，byLunar(闰月, isLeapMonth=true, fixLeap=false)
 * 与 bySolar(原公历, fixLeap=false) 同盘。本测试把后者当作 origin-month 的对照盘。
 */
import assert from 'node:assert/strict';
import { astro } from 'iztro';
import { generateChart, type LunarMonthPolicy } from '../../lib/ziwei/algorithm';
import { BRANCHES } from '../../lib/ziwei/constants';
import type { ZiweiChart } from '../../lib/ziwei/types';

const POLICIES: LunarMonthPolicy[] = ['split', 'next-month', 'prev-month', 'origin-month'];

function majorLayout(chart: ZiweiChart): string {
  return chart.palaces
    .slice()
    .sort((a, b) => a.branch - b.branch)
    .map((p) => {
      const majors = p.stars.filter((s) => s.type === 'major').map((s) => s.name).join('+');
      return `${BRANCHES[p.branch]}${p.name}:${majors || '-'}`;
    })
    .join('|');
}

function starBranch(chart: ZiweiChart, name: string): string {
  const palace = chart.palaces.find((p) => p.stars.some((s) => s.name === name));
  return palace ? BRANCHES[palace.branch] : '';
}

/** 主星落宫与 iztro bySolar(原公历, fixLeap) 一致。亮度、杂耀由装配层另算，这里不比。 */
function assertMajorsMatchIztro(chart: ZiweiChart, fixLeap: boolean): void {
  const { year, month, day, hour, gender } = chart.birthInfo;
  const ref = astro.bySolar(
    `${year}-${month}-${day}`,
    hour,
    gender === 'male' ? '男' : '女',
    fixLeap,
    'zh-CN',
  );
  assert.equal(BRANCHES[chart.mingGongBranch], ref.earthlyBranchOfSoulPalace);
  assert.equal(BRANCHES[chart.shenGongBranch], ref.earthlyBranchOfBodyPalace);
  assert.equal(chart.wuxingJuName, ref.fiveElementsClass);
  for (const palace of ref.palaces) {
    const ours = chart.palaces.find((p) => BRANCHES[p.branch] === palace.earthlyBranch);
    assert.ok(ours, `missing palace at ${palace.earthlyBranch}`);
    const expected = palace.majorStars.map((s) => s.name).join('+');
    const actual = ours.stars.filter((s) => s.type === 'major').map((s) => s.name).join('+');
    assert.equal(actual, expected, `${palace.earthlyBranch}${palace.name}`);
  }
  for (const name of ['三台', '八座']) {
    const refPalace = ref.palaces.find((p) =>
      [...p.minorStars, ...p.adjectiveStars].some((s) => s.name === name),
    );
    assert.ok(refPalace, `iztro missing ${name}`);
    assert.equal(starBranch(chart, name), refPalace.earthlyBranch, name);
  }
}

interface FrozenCase {
  label: string;
  year: number;
  month: number;
  day: number;
  /** hour=4、女命。origin-month 在「本月没有三十」时没有旧盘，不冻结，改走 iztro 对照。 */
  layouts: Partial<Record<LunarMonthPolicy, string>>;
  lunar: Record<LunarMonthPolicy, string>;
}

// 冻结值取修复前 generateChart（辰时、女）。只锁主星宫位，防止其它口径被这次修改带走。
const FROZEN: FrozenCase[] = [
  {
    label: '2017 闰六月三十',
    year: 2017, month: 8, day: 21,
    lunar: {
      split: '2017-7-29',
      'next-month': '2017-7-29',
      'prev-month': '2017-6-29',
      'origin-month': '2017-6L-30',
    },
    layouts: {
      split: '子财帛:贪狼|丑子女:天同+巨门|寅夫妻:武曲+天相|卯兄弟:太阳+天梁|辰命宫:七杀|巳父母:天机|午福德:紫微|未田宅:-|申官禄:破军|酉仆役:-|戌迁移:廉贞+天府|亥疾厄:太阴',
      'next-month': '子财帛:天同+太阴|丑子女:武曲+贪狼|寅夫妻:太阳+巨门|卯兄弟:天相|辰命宫:天机+天梁|巳父母:紫微+七杀|午福德:-|未田宅:-|申官禄:-|酉仆役:廉贞+破军|戌迁移:-|亥疾厄:天府',
      'prev-month': '子子女:贪狼|丑夫妻:天同+巨门|寅兄弟:武曲+天相|卯命宫:太阳+天梁|辰父母:七杀|巳福德:天机|午田宅:紫微|未官禄:-|申仆役:破军|酉迁移:-|戌疾厄:廉贞+天府|亥财帛:太阴',
    },
  },
  {
    label: '2017 闰六月廿九',
    year: 2017, month: 8, day: 20,
    lunar: {
      split: '2017-7-29',
      'next-month': '2017-7-29',
      'prev-month': '2017-6-29',
      'origin-month': '2017-6L-29',
    },
    layouts: {
      split: '子财帛:天同+太阴|丑子女:武曲+贪狼|寅夫妻:太阳+巨门|卯兄弟:天相|辰命宫:天机+天梁|巳父母:紫微+七杀|午福德:-|未田宅:-|申官禄:-|酉仆役:廉贞+破军|戌迁移:-|亥疾厄:天府',
      'next-month': '子财帛:天同+太阴|丑子女:武曲+贪狼|寅夫妻:太阳+巨门|卯兄弟:天相|辰命宫:天机+天梁|巳父母:紫微+七杀|午福德:-|未田宅:-|申官禄:-|酉仆役:廉贞+破军|戌迁移:-|亥疾厄:天府',
      'prev-month': '子子女:贪狼|丑夫妻:天同+巨门|寅兄弟:武曲+天相|卯命宫:太阳+天梁|辰父母:七杀|巳福德:天机|午田宅:紫微|未官禄:-|申仆役:破军|酉迁移:-|戌疾厄:廉贞+天府|亥财帛:太阴',
      'origin-month': '子子女:贪狼|丑夫妻:天同+巨门|寅兄弟:武曲+天相|卯命宫:太阳+天梁|辰父母:七杀|巳福德:天机|午田宅:紫微|未官禄:-|申仆役:破军|酉迁移:-|戌疾厄:廉贞+天府|亥财帛:太阴',
    },
  },
  {
    label: '2020 闰四月廿九',
    year: 2020, month: 6, day: 20,
    lunar: {
      split: '2020-5-29',
      'next-month': '2020-5-29',
      'prev-month': '2020-4-29',
      'origin-month': '2020-4L-29',
    },
    layouts: {
      split: '子夫妻:贪狼|丑兄弟:天同+巨门|寅命宫:武曲+天相|卯父母:太阳+天梁|辰福德:七杀|巳田宅:天机|午官禄:紫微|未仆役:-|申迁移:破军|酉疾厄:-|戌财帛:廉贞+天府|亥子女:太阴',
      'next-month': '子夫妻:贪狼|丑兄弟:天同+巨门|寅命宫:武曲+天相|卯父母:太阳+天梁|辰福德:七杀|巳田宅:天机|午官禄:紫微|未仆役:-|申迁移:破军|酉疾厄:-|戌财帛:廉贞+天府|亥子女:太阴',
      'prev-month': '子兄弟:天同+太阴|丑命宫:武曲+贪狼|寅父母:太阳+巨门|卯福德:天相|辰田宅:天机+天梁|巳官禄:紫微+七杀|午仆役:-|未迁移:-|申疾厄:-|酉财帛:廉贞+破军|戌子女:-|亥夫妻:天府',
      'origin-month': '子兄弟:天同+太阴|丑命宫:武曲+贪狼|寅父母:太阳+巨门|卯福德:天相|辰田宅:天机+天梁|巳官禄:紫微+七杀|午仆役:-|未迁移:-|申疾厄:-|酉财帛:廉贞+破军|戌子女:-|亥夫妻:天府',
    },
  },
  {
    label: '2020 闰四月初一',
    year: 2020, month: 5, day: 23,
    lunar: {
      split: '2020-4-1',
      'next-month': '2020-5-1',
      'prev-month': '2020-4-1',
      'origin-month': '2020-4L-1',
    },
    layouts: {
      split: '子兄弟:天梁|丑命宫:廉贞+七杀|寅父母:-|卯福德:-|辰田宅:天同|巳官禄:武曲+破军|午仆役:太阳|未迁移:天府|申疾厄:天机+太阴|酉财帛:紫微+贪狼|戌子女:巨门|亥夫妻:天相',
      'next-month': '子夫妻:贪狼|丑兄弟:天同+巨门|寅命宫:武曲+天相|卯父母:太阳+天梁|辰福德:七杀|巳田宅:天机|午官禄:紫微|未仆役:-|申迁移:破军|酉疾厄:-|戌财帛:廉贞+天府|亥子女:太阴',
      'prev-month': '子兄弟:天梁|丑命宫:廉贞+七杀|寅父母:-|卯福德:-|辰田宅:天同|巳官禄:武曲+破军|午仆役:太阳|未迁移:天府|申疾厄:天机+太阴|酉财帛:紫微+贪狼|戌子女:巨门|亥夫妻:天相',
      'origin-month': '子兄弟:天梁|丑命宫:廉贞+七杀|寅父母:-|卯福德:-|辰田宅:天同|巳官禄:武曲+破军|午仆役:太阳|未迁移:天府|申疾厄:天机+太阴|酉财帛:紫微+贪狼|戌子女:巨门|亥夫妻:天相',
    },
  },
  {
    label: '2023 闰二月廿九',
    year: 2023, month: 4, day: 19,
    lunar: {
      split: '2023-3-29',
      'next-month': '2023-3-29',
      'prev-month': '2023-2-29',
      'origin-month': '2023-2L-29',
    },
    layouts: {
      split: '子命宫:贪狼|丑父母:天同+巨门|寅福德:武曲+天相|卯田宅:太阳+天梁|辰官禄:七杀|巳仆役:天机|午迁移:紫微|未疾厄:-|申财帛:破军|酉子女:-|戌夫妻:廉贞+天府|亥兄弟:太阴',
      'next-month': '子命宫:贪狼|丑父母:天同+巨门|寅福德:武曲+天相|卯田宅:太阳+天梁|辰官禄:七杀|巳仆役:天机|午迁移:紫微|未疾厄:-|申财帛:破军|酉子女:-|戌夫妻:廉贞+天府|亥兄弟:太阴',
      'prev-month': '子父母:太阳|丑福德:天府|寅田宅:天机+太阴|卯官禄:紫微+贪狼|辰仆役:巨门|巳迁移:天相|午疾厄:天梁|未财帛:廉贞+七杀|申子女:-|酉夫妻:-|戌兄弟:天同|亥命宫:武曲+破军',
      'origin-month': '子父母:太阳|丑福德:天府|寅田宅:天机+太阴|卯官禄:紫微+贪狼|辰仆役:巨门|巳迁移:天相|午疾厄:天梁|未财帛:廉贞+七杀|申子女:-|酉夫妻:-|戌兄弟:天同|亥命宫:武曲+破军',
    },
  },
  {
    label: '2023 闰二月初一',
    year: 2023, month: 3, day: 22,
    lunar: {
      split: '2023-2-1',
      'next-month': '2023-3-1',
      'prev-month': '2023-2-1',
      'origin-month': '2023-2L-1',
    },
    layouts: {
      split: '子父母:天机|丑福德:紫微+破军|寅田宅:-|卯官禄:天府|辰仆役:太阴|巳迁移:廉贞+贪狼|午疾厄:巨门|未财帛:天相|申子女:天同+天梁|酉夫妻:武曲+七杀|戌兄弟:太阳|亥命宫:-',
      'next-month': '子命宫:-|丑父母:-|寅福德:-|卯田宅:廉贞+破军|辰官禄:-|巳仆役:天府|午迁移:天同+太阴|未疾厄:武曲+贪狼|申财帛:太阳+巨门|酉子女:天相|戌夫妻:天机+天梁|亥兄弟:紫微+七杀',
      'prev-month': '子父母:天机|丑福德:紫微+破军|寅田宅:-|卯官禄:天府|辰仆役:太阴|巳迁移:廉贞+贪狼|午疾厄:巨门|未财帛:天相|申子女:天同+天梁|酉夫妻:武曲+七杀|戌兄弟:太阳|亥命宫:-',
      'origin-month': '子父母:天机|丑福德:紫微+破军|寅田宅:-|卯官禄:天府|辰仆役:太阴|巳迁移:廉贞+贪狼|午疾厄:巨门|未财帛:天相|申子女:天同+天梁|酉夫妻:武曲+七杀|戌兄弟:太阳|亥命宫:-',
    },
  },
  {
    label: '1979 闰六月三十（本月、闰月都是 30 天，修复前就能排）',
    year: 1979, month: 8, day: 22,
    lunar: {
      split: '1979-7-29',
      'next-month': '1979-7-29',
      'prev-month': '1979-6-30',
      'origin-month': '1979-6L-30',
    },
    layouts: {
      split: '子财帛:-|丑子女:-|寅夫妻:-|卯兄弟:廉贞+破军|辰命宫:-|巳父母:天府|午福德:天同+太阴|未田宅:武曲+贪狼|申官禄:太阳+巨门|酉仆役:天相|戌迁移:天机+天梁|亥疾厄:紫微+七杀',
      'next-month': '子财帛:七杀|丑子女:-|寅夫妻:廉贞|卯兄弟:-|辰命宫:破军|巳父母:天同|午福德:武曲+天府|未田宅:太阳+太阴|申官禄:贪狼|酉仆役:天机+巨门|戌迁移:紫微+天相|亥疾厄:天梁',
      'prev-month': '子子女:贪狼|丑夫妻:天同+巨门|寅兄弟:武曲+天相|卯命宫:太阳+天梁|辰父母:七杀|巳福德:天机|午田宅:紫微|未官禄:-|申仆役:破军|酉迁移:-|戌疾厄:廉贞+天府|亥财帛:太阴',
      'origin-month': '子子女:贪狼|丑夫妻:天同+巨门|寅兄弟:武曲+天相|卯命宫:太阳+天梁|辰父母:七杀|巳福德:天机|午田宅:紫微|未官禄:-|申仆役:破军|酉迁移:-|戌疾厄:廉贞+天府|亥财帛:太阴',
    },
  },
  {
    label: '1944 闰四月三十',
    year: 1944, month: 6, day: 20,
    lunar: {
      split: '1944-5-29',
      'next-month': '1944-5-29',
      'prev-month': '1944-4-29',
      'origin-month': '1944-4L-30',
    },
    layouts: {
      split: '子夫妻:贪狼|丑兄弟:天同+巨门|寅命宫:武曲+天相|卯父母:太阳+天梁|辰福德:七杀|巳田宅:天机|午官禄:紫微|未仆役:-|申迁移:破军|酉疾厄:-|戌财帛:廉贞+天府|亥子女:太阴',
      'next-month': '子夫妻:天同+太阴|丑兄弟:武曲+贪狼|寅命宫:太阳+巨门|卯父母:天相|辰福德:天机+天梁|巳田宅:紫微+七杀|午官禄:-|未仆役:-|申迁移:-|酉疾厄:廉贞+破军|戌财帛:-|亥子女:天府',
      'prev-month': '子兄弟:太阳|丑命宫:天府|寅父母:天机+太阴|卯福德:紫微+贪狼|辰田宅:巨门|巳官禄:天相|午仆役:天梁|未迁移:廉贞+七杀|申疾厄:-|酉财帛:-|戌子女:天同|亥夫妻:武曲+破军',
    },
  },
];

const birth = { hour: 4, gender: 'female' as const };

for (const item of FROZEN) {
  for (const policy of POLICIES) {
    const chart = generateChart(
      { year: item.year, month: item.month, day: item.day, ...birth },
      { leapMonth: policy },
    );
    const tag = `${item.label} / ${policy}`;
    const leap = chart.lunarInfo.isLeapMonth ? 'L' : '';
    const lunar = `${chart.lunarInfo.lunarYear}-${chart.lunarInfo.lunarMonth}${leap}-${chart.lunarInfo.lunarDay}`;
    assert.equal(lunar, item.lunar[policy], tag);
    const frozen = item.layouts[policy];
    if (frozen) assert.equal(majorLayout(chart), frozen, tag);
  }
}

// 本月只有 29 天的闰月三十：盘必须是「真实闰月日 + fixLeap=false」，不是夹日、也不是月中分界。
for (const [year, month, day, lunarMonth] of [
  [2017, 8, 21, 6],
  [1944, 6, 20, 4],
  [1955, 5, 21, 3],
] as const) {
  for (const hour of [0, 4, 11]) {
    for (const gender of ['male', 'female'] as const) {
      const chart = generateChart({ year, month, day, hour, gender }, { leapMonth: 'origin-month' });
      const tag = `${year}-${month}-${day} h${hour} ${gender}`;
      assert.equal(chart.lunarInfo.isLeapMonth, true, tag);
      assert.equal(chart.lunarInfo.lunarYear, year, tag);
      assert.equal(chart.lunarInfo.lunarMonth, lunarMonth, tag);
      assert.equal(chart.lunarInfo.lunarDay, 30, tag);
      assertMajorsMatchIztro(chart, false);
      const splitLike = astro.bySolar(`${year}-${month}-${day}`, hour, gender === 'male' ? '男' : '女', true, 'zh-CN');
      assert.notEqual(
        BRANCHES[chart.mingGongBranch],
        splitLike.earthlyBranchOfSoulPalace,
        `${tag} origin-month must not use the leap-month split`,
      );
    }
  }
}

// 2017-08-21 辰时女命：节气四柱仍是这一天，农历月柱按六月（未），不是夹到廿九之后的日柱。
{
  const chart = generateChart({ year: 2017, month: 8, day: 21, ...birth }, { leapMonth: 'origin-month' });
  assert.deepEqual(chart.lunarInfo.fourPillars, ['丁酉', '戊申', '庚辰', '庚辰']);
  assert.deepEqual(chart.lunarInfo.fourPillarsLunar, ['丁酉', '丁未', '庚辰', '庚辰']);
  const clamped = generateChart({ year: 2017, month: 8, day: 20, ...birth }, { leapMonth: 'origin-month' });
  assert.notEqual(chart.ziweiPos, clamped.ziweiPos);
  assert.notEqual(starBranch(chart, '三台'), starBranch(clamped, '三台'));
}

console.log('leap origin-month day-30 regression passed');
