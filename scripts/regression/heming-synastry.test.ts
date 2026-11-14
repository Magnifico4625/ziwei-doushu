/**
 * 回归测试 — 紫微合盘确定性引擎 (lib/ziwei/heming.ts)
 *
 * 覆盖：
 *  1. 十二地支六合/三合/六冲/同宫数学对称性与完备性
 *  2. 夫妻宫空宫借对宫主星（含借宫 STAR_IN_FUQI_GU 评估与天作之合互映）
 *  3. 跨盘飞星四化（化禄入命/夫妻、化忌直入夫妻、化忌入官禄冲夫妻、互化忌、额外宫干飞化）
 *  4. 宫位地支六冲（命宫 vs 夫妻 diff === 6）、六合、三合、同宫
 *  5. 五星与一星极端组合及 HEMING_SCORE_CRITERIA 对齐
 *  6. 流年叠加（targetYear 共享吉年 vs 双忌冲压压力年、异常年份校验）
 *  7. 确定性、姓名无关性、A/B 互换对称性、Compact Prompt Payload < 3 KB
 */

import assert from 'node:assert/strict';
import { generateChart } from '../../lib/ziwei/algorithm';
import { HEMING_SCORE_CRITERIA } from '../../lib/ziwei/heming-knowledge';
import {
  analyzePalaceBranchRelation,
  analyzeSynastry,
  buildSynastryPromptPayload,
  findStarInPalaces,
} from '../../lib/ziwei/heming';

// ── 1. 地支关系辅助函数完备性与对称性 ────────────────────────────────────
{
  const liuhePairs: Array<[number, number]> = [[0, 1], [2, 11], [3, 10], [4, 9], [5, 8], [6, 7]];
  for (const [a, b] of liuhePairs) {
    assert.equal(analyzePalaceBranchRelation(a, b).relation, 'liuhe');
    assert.equal(analyzePalaceBranchRelation(b, a).relation, 'liuhe');
  }
  const sanheTriads: Array<[number, number, number]> = [
    [8, 0, 4], [11, 3, 7], [2, 6, 10], [5, 9, 1],
  ];
  for (const [x, y, z] of sanheTriads) {
    assert.equal(analyzePalaceBranchRelation(x, y).relation, 'sanhe');
    assert.equal(analyzePalaceBranchRelation(y, z).relation, 'sanhe');
    assert.equal(analyzePalaceBranchRelation(x, z).relation, 'sanhe');
  }
  for (let i = 0; i < 12; i++) {
    assert.equal(analyzePalaceBranchRelation(i, i).relation, 'same');
    assert.equal(analyzePalaceBranchRelation(i, (i + 6) % 12).relation, 'liuchong');
    assert.equal(analyzePalaceBranchRelation(i, (i + 6) % 12).diff, 6);
    for (let j = 0; j < 12; j++) {
      assert.equal(
        analyzePalaceBranchRelation(i, j).relation,
        analyzePalaceBranchRelation(j, i).relation,
      );
    }
  }
}

// ── 2. 空宫借对宫主星 + 互为天作之合 ──────────────────────────────────────
const chartEmptyA = generateChart({ year: 1996, month: 11, day: 3, hour: 1, gender: 'female' });
const chartEmptyB = generateChart({ year: 1993, month: 4, day: 7, hour: 4, gender: 'male' });
const resEmpty = analyzeSynastry(chartEmptyA, chartEmptyB, { targetYear: 2026 });

assert.equal(resEmpty.personA.fuqiGong.isEmpty, true);
assert.equal(resEmpty.personA.fuqiGong.borrowedFromName, '官禄');
assert.deepEqual(resEmpty.personA.fuqiGong.borrowedStars, ['太阳', '太阴']);
assert.deepEqual(resEmpty.personA.fuqiGong.effectiveMajorStars, ['太阳', '太阴']);
assert.equal(resEmpty.palaceResonance.assessmentA.isEmpty, true);
assert.deepEqual(
  resEmpty.palaceResonance.assessmentA.starAssessments.map((s) => s.starName),
  ['太阳', '太阴'],
);
assert.ok(resEmpty.palaceResonance.assessmentA.starAssessments.every((s) => s.isBorrowed));

assert.equal(resEmpty.personB.fuqiGong.isEmpty, true);
assert.equal(resEmpty.personB.fuqiGong.borrowedFromName, '官禄');
assert.deepEqual(resEmpty.personB.fuqiGong.borrowedStars, ['天机', '天梁']);
assert.ok(resEmpty.palaceResonance.assessmentB.starAssessments.every((s) => s.isBorrowed));

assert.equal(resEmpty.palaceResonance.tianZuoZhiHe, 'mutual');
assert.ok(resEmpty.palaceResonance.aFuqiMatchesBMing.includes('太阴'));
assert.ok(resEmpty.palaceResonance.bFuqiMatchesAMing.includes('天机'));
assert.ok(resEmpty.highlights.some((h) => h.code === 'MUTUAL_MING_FUQI_MATCH'));
assert.ok(resEmpty.frictionPoints.some((f) => f.code === 'FUQI_EMPTY_BORROWED'));

// 丙干天同化禄入乙方命宫；癸干贪狼化忌入甲方仆役宫（验证 iztro 宫名 '命宫'/'仆役'）
const aToBLuEmpty = resEmpty.crossSiHua.aToB.hits.find((h) => h.siHua === '禄');
const bToAJiEmpty = resEmpty.crossSiHua.bToA.hits.find((h) => h.siHua === '忌');
assert.equal(aToBLuEmpty?.starName, '天同');
assert.equal(aToBLuEmpty?.palaceName, '命宫');
assert.equal(aToBLuEmpty?.isKeyRelationalHit, true);
assert.equal(bToAJiEmpty?.starName, '贪狼');
assert.equal(bToAJiEmpty?.palaceName, '仆役');
assert.equal(bToAJiEmpty?.isKeyRelationalHit, true);
assert.ok(findStarInPalaces(chartEmptyB, '天同')?.palace.name === '命宫');

// ── 3. 化禄入夫妻 + 化忌直入夫妻 + 互化忌 + 额外宫干飞化 ─────────────────
const chartC0 = generateChart({ year: 1990, month: 3, day: 15, hour: 2, gender: 'male' });
const chartC2F = generateChart({ year: 1988, month: 10, day: 8, hour: 7, gender: 'female' });
const resCross = analyzeSynastry(chartC0, chartC2F, {
  targetYear: 2026,
  crossStemSources: ['yearStem', 'mingStem', 'fuqiStem'],
});

const aLuCross = resCross.crossSiHua.aToB.hits.find((h) => h.siHua === '禄');
const aKeCross = resCross.crossSiHua.aToB.hits.find((h) => h.siHua === '科');
const bJiCross = resCross.crossSiHua.bToA.hits.find((h) => h.siHua === '忌');
assert.equal(aLuCross?.starName, '太阳');
assert.equal(aLuCross?.palaceName, '夫妻');
assert.equal(aKeCross?.starName, '太阴');
assert.equal(aKeCross?.palaceName, '命宫');
assert.equal(bJiCross?.starName, '天机');
assert.equal(bJiCross?.palaceName, '夫妻');
assert.equal(bJiCross?.polarity, 'negative');

assert.equal(resCross.crossSiHua.hasMutualHuaJi, true);
assert.equal(resCross.crossSiHua.bondType, 'mutual_ji_entanglement');
assert.ok(resCross.highlights.some((h) => h.code === 'CROSS_LU_INTO_FUQI'));
assert.ok(resCross.frictionPoints.some((f) => f.code === 'MUTUAL_HUAJI_ENTANGLEMENT'));
assert.ok(resCross.frictionPoints.some((f) => f.code === 'CROSS_JI_INTO_KEY_PALACE' && f.palaces.includes('夫妻')));
assert.equal(resCross.crossSiHua.additionalDirections.aToB.mingStem?.hits.length, 4);
assert.equal(resCross.crossSiHua.additionalDirections.bToA.fuqiStem?.hits.length, 4);

// ── 4. 化忌入官禄冲夫妻宫 ────────────────────────────────────────────────
const chartC1 = generateChart({ year: 1992, month: 7, day: 21, hour: 5, gender: 'female' });
const chartC4 = generateChart({ year: 1995, month: 1, day: 20, hour: 9, gender: 'male' });
const resClashFuqi = analyzeSynastry(chartC1, chartC4, { targetYear: 2026 });

const bJiClashFuqi = resClashFuqi.crossSiHua.bToA.hits.find((h) => h.siHua === '忌');
assert.equal(bJiClashFuqi?.starName, '太阳');
assert.equal(bJiClashFuqi?.palaceName, '官禄');
assert.equal(bJiClashFuqi?.clashesPalaceName, '夫妻');
assert.equal(bJiClashFuqi?.isKeyRelationalHit, true);
assert.ok(
  resClashFuqi.frictionPoints.some(
    (f) => f.code === 'CROSS_JI_CLASH_CORE_PALACE' && f.palaces.includes('官禄') && f.palaces.includes('夫妻'),
  ),
);

// ── 5. 宫位地支六冲 (diff === 6)、六合、三合、同宫 ──────────────────────
const resBranchClash = analyzeSynastry(chartC0, chartEmptyA);
assert.equal(resBranchClash.palaceResonance.branchRelations.aMingVsBFuqi.relation, 'liuchong');
assert.equal(resBranchClash.palaceResonance.branchRelations.aMingVsBFuqi.diff, 6);
assert.equal(resBranchClash.palaceResonance.branchRelations.mingVsMing.relation, 'sanhe');
assert.ok(
  resBranchClash.frictionPoints.some((f) => f.code === 'BRANCH_LIUCHONG' && f.severity === 'high'),
);

const resLiuHe = analyzeSynastry(chartC0, chartEmptyB);
assert.equal(resLiuHe.palaceResonance.branchRelations.mingVsMing.relation, 'liuhe');
assert.ok(resLiuHe.highlights.some((h) => h.code === 'BRANCH_LIUHE'));

const chartSameB = generateChart({ year: 1994, month: 8, day: 14, hour: 8, gender: 'female' });
const resSame = analyzeSynastry(chartEmptyB, chartSameB);
assert.equal(resSame.palaceResonance.branchRelations.mingVsMing.relation, 'same');
assert.equal(resSame.palaceResonance.branchRelations.fuqiVsFuqi.relation, 'same');

// ── 6. 五星高配 vs 一星高危组合 & 评分边界 ──────────────────────────────
const chartMaxA = generateChart({ year: 1986, month: 2, day: 12, hour: 0, gender: 'male' });
const chartMaxB = generateChart({ year: 1986, month: 8, day: 12, hour: 9, gender: 'female' });
const resMax = analyzeSynastry(chartMaxA, chartMaxB);
assert.ok(resMax.score >= 85 && resMax.score <= 100, `expected >= 85, got ${resMax.score}`);
assert.equal(resMax.stars, 5);
assert.equal(resMax.level, '五星');
assert.equal(resMax.levelCriteria, HEMING_SCORE_CRITERIA['五星']);

const chartMinA = generateChart({ year: 1986, month: 11, day: 10, hour: 4, gender: 'male' });
const chartMinB = generateChart({ year: 1993, month: 11, day: 18, hour: 8, gender: 'female' });
const resMin = analyzeSynastry(chartMinA, chartMinB);
assert.ok(resMin.score >= 0 && resMin.score < 40, `expected < 40, got ${resMin.score}`);
assert.equal(resMin.stars, 1);
assert.equal(resMin.level, '一星');
assert.equal(resMin.levelCriteria, HEMING_SCORE_CRITERIA['一星']);
assert.ok(resMin.frictionPoints.some((f) => f.code === 'FUQI_SANXIONG_COMBO'));

// ── 7. 流年叠加压力测试 (shared_blessing vs shared_tension) ─────────────
const resYear2026 = analyzeSynastry(chartEmptyA, chartEmptyB, { targetYear: 2026 });
const resYear2024 = analyzeSynastry(chartEmptyA, chartEmptyB, { targetYear: 2024 });
const resYear2028 = analyzeSynastry(chartEmptyA, chartEmptyB, { targetYear: 2028 });
const resNoYear = analyzeSynastry(chartEmptyA, chartEmptyB);

assert.equal(resNoYear.annualOverlay, undefined);
assert.equal(resYear2026.score, resNoYear.score);
assert.equal(resYear2024.score, resNoYear.score);
assert.equal(resYear2026.annualOverlay?.outlook, 'shared_blessing');
assert.equal(resYear2026.annualOverlay?.isSharedBlessingYear, true);
assert.equal(resYear2026.annualOverlay?.isSharedTensionYear, false);
assert.ok(resYear2026.highlights.some((h) => h.code === 'ANNUAL_SHARED_BLESSING'));

assert.equal(resYear2024.annualOverlay?.outlook, 'shared_tension');
assert.equal(resYear2024.annualOverlay?.isSharedTensionYear, true);
assert.equal(resYear2028.annualOverlay?.outlook, 'shared_tension');
assert.equal(resYear2028.annualOverlay?.isSharedTensionYear, true);
assert.ok(resYear2028.frictionPoints.some((f) => f.code === 'ANNUAL_SHARED_TENSION'));
assert.ok(
  (resYear2026.annualOverlay?.yearScore ?? 0) > (resYear2028.annualOverlay?.yearScore ?? 100),
);

const chartStressA = generateChart({ year: 1984, month: 2, day: 10, hour: 1, gender: 'male' });
const chartStressB = generateChart({ year: 1985, month: 5, day: 18, hour: 2, gender: 'female' });
const resStress2026 = analyzeSynastry(chartStressA, chartStressB, { targetYear: 2026 });
assert.equal(resStress2026.annualOverlay?.isSharedTensionYear, true);
assert.equal(resStress2026.annualOverlay?.partnerA.liuNianSiHuaHits.find((h) => h.siHua === '忌')?.clashesPalaceName, '福德');
assert.equal(resStress2026.annualOverlay?.partnerB.liuNianSiHuaHits.find((h) => h.siHua === '忌')?.clashesPalaceName, '福德');

assert.throws(() => analyzeSynastry(chartEmptyA, chartEmptyB, { targetYear: Number.NaN }), RangeError);
assert.throws(() => analyzeSynastry(chartEmptyA, chartEmptyB, { targetYear: Infinity }), RangeError);

// ── 8. 确定性、姓名无关性、A/B 互换对称性 & Compact Payload < 3 KB ────────
const chartNamedA = generateChart({ year: 1996, month: 11, day: 3, hour: 1, gender: 'female', name: 'Alice' });
const chartNamedB = generateChart({ year: 1993, month: 4, day: 7, hour: 4, gender: 'male', name: 'Bob' });
const resNamed = analyzeSynastry(chartNamedA, chartNamedB, { targetYear: 2026 });
assert.equal(resNamed.personA.chartKey, resEmpty.personA.chartKey);
assert.equal(resNamed.personB.chartKey, resEmpty.personB.chartKey);
assert.equal(resNamed.score, resEmpty.score);
assert.deepEqual(resNamed.dimensions, resEmpty.dimensions);

const swapPairs = [
  [chartEmptyA, chartEmptyB],
  [chartC0, chartC2F],
  [chartC1, chartC4],
  [chartMaxA, chartMaxB],
  [chartMinA, chartMinB],
] as const;

for (const [a, b] of swapPairs) {
  const ab = analyzeSynastry(a, b, { targetYear: 2026 });
  const ba = analyzeSynastry(b, a, { targetYear: 2026 });
  assert.equal(ab.score, ba.score, 'A/B swap score must be identical');
  assert.equal(ab.stars, ba.stars);
  assert.equal(ab.level, ba.level);
  assert.deepEqual(ab.dimensions, ba.dimensions);
  assert.equal(ab.crossSiHua.hasMutualHuaJi, ba.crossSiHua.hasMutualHuaJi);
  assert.equal(ab.palaceResonance.tianZuoZhiHe, ba.palaceResonance.tianZuoZhiHe);
  assert.equal(ab.palaceResonance.elementRelation, ba.palaceResonance.elementRelation);
  assert.equal(ab.personA.chartKey, ba.personB.chartKey);
  assert.equal(ab.personB.chartKey, ba.personA.chartKey);
  assert.equal(
    ab.palaceResonance.branchRelations.aMingVsBFuqi.relation,
    ba.palaceResonance.branchRelations.bMingVsAFuqi.relation,
  );
  assert.deepEqual(
    ab.crossSiHua.aToB.hits.map((h) => `${h.siHua}:${h.starName}:${h.palaceName}`),
    ba.crossSiHua.bToA.hits.map((h) => `${h.siHua}:${h.starName}:${h.palaceName}`),
  );
  assert.equal(ab.annualOverlay?.yearScore, ba.annualOverlay?.yearScore);
  assert.equal(ab.annualOverlay?.outlook, ba.annualOverlay?.outlook);

  // Compact payload verification (< 3 KB)
  const payloadWithYear = buildSynastryPromptPayload(a, b, ab);
  const payloadBytesWithYear = Buffer.byteLength(JSON.stringify(payloadWithYear), 'utf8');
  assert.ok(
    payloadBytesWithYear < 3072,
    `payload with targetYear too large: ${payloadBytesWithYear} bytes`,
  );

  const abNoYear = analyzeSynastry(a, b);
  const payloadNoYear = buildSynastryPromptPayload(a, b, abNoYear);
  assert.deepEqual(buildSynastryPromptPayload(a, b), payloadNoYear);
  const payloadBytesNoYear = Buffer.byteLength(JSON.stringify(payloadNoYear), 'utf8');
  const rawChartsBytes = Buffer.byteLength(JSON.stringify({ a, b }), 'utf8');
  assert.ok(payloadBytesNoYear < 2800, `payload without targetYear too large: ${payloadBytesNoYear} bytes`);
  assert.ok(payloadBytesNoYear < rawChartsBytes / 4, 'payload must be >4x smaller than raw charts');
  assert.equal(payloadNoYear.annual, undefined);
  assert.equal(payloadWithYear.annual?.year, 2026);
}

console.log('✅ 紫微合盘确定性引擎全部回归断言通过（含空宫借星 / 跨盘飞化 / 六冲六合 / 五星一星 / 流年 / 对称性 / <3KB Payload）');
