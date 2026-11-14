/**
 * Regression suite for deterministic Zi Wei Dou Shu chart analyzer (`lib/ziwei/chart-analyzer.ts`).
 *
 * Verifies:
 * 1. Cache-key determinism and sensitivity to date/hour/gender/school/leapMonthPolicy/targetYear.
 * 2. Free Life/Body/SanFangSiZheng summary including empty-palace borrowing & favorable SiHua.
 * 3. Zero-LLM paywall pain-point detection (Natal HuaJi on major & lucky stars, Self-HuaJi,
 *    DaXian HuaJi, LiuNian HuaJi, Double HuaJi stack/clash/clamp, and heavy Sha clusters).
 * 4. Compact (< 3 KB) LLM prompt payload structure & metadata stripping.
 */

import assert from 'node:assert/strict';
import { generateChart, setBrightnessSchool } from '../../lib/ziwei/algorithm';
import { BRANCHES } from '../../lib/ziwei/constants';
import { DEFAULT_LEAP_MONTH } from '../../lib/ziwei/school-config';
import { detectSelfSihua, getDaXianSiHua, getLiuNianSiHua } from '../../lib/ziwei/sihua';
import {
  analyzeChartSummary,
  buildChartPromptPayload,
  extractChartPainPoints,
  extractFreeMingSummary,
  getBirthChartKeyParams,
  getChartCacheKey,
  type PatternSummary,
} from '../../lib/ziwei/chart-analyzer';
import type { ZiweiChart } from '../../lib/ziwei/types';

// ── 1) Cache Key Determinism & Sensitivity ────────────────────────────────────

{
  const chartA = generateChart({
    year: 1990,
    month: 5,
    day: 15,
    hour: 4,
    gender: 'male',
    name: 'Alice Example',
    province: '北京',
    city: '北京',
    longitude: 116.4,
    utcOffsetMinutes: 480,
    timeZone: 'Asia/Shanghai',
    origInput: { year: 1990, month: 5, day: 15, clockHour: 8, clockMinute: 12 },
  });

  const chartB = generateChart({
    year: 1990,
    month: 5,
    day: 15,
    hour: 4,
    gender: 'male',
    name: 'Totally Different Name',
    province: '海外 / 国际',
    city: '莫斯科',
    longitude: 37.6,
    utcOffsetMinutes: 180,
    timeZone: 'Europe/Moscow',
  });

  const keyA = getChartCacheKey(chartA);
  const keyB = getChartCacheKey(chartB);
  assert.equal(keyA, keyB, 'identical natal matrix must yield identical cache key regardless of name/city');
  assert.equal(
    keyA,
    `ziwei:v1:1990-05-15:4:male:default:${DEFAULT_LEAP_MONTH}`,
    'canonical key format should match solarDate:hour:gender:brightnessSchool:leapMonthPolicy',
  );

  // 'QS' and 'default' normalize to identical school key (matching algorithm.ts & school-config.ts)
  assert.equal(
    getChartCacheKey(chartA, { brightnessSchool: 'QS' }),
    getChartCacheKey(chartA, { brightnessSchool: 'default' }),
  );
  assert.notEqual(
    getChartCacheKey(chartA, { brightnessSchool: 'XD2' }),
    keyA,
    'distinct brightnessSchool must yield distinct cache key',
  );
  assert.notEqual(
    getChartCacheKey(chartA, { brightnessSchool: 'ZZ' }),
    getChartCacheKey(chartA, { brightnessSchool: 'XD1' }),
  );

  // Hour & Gender sensitivity
  const diffHour = generateChart({ year: 1990, month: 5, day: 15, hour: 5, gender: 'male' });
  const diffGender = generateChart({ year: 1990, month: 5, day: 15, hour: 4, gender: 'female' });
  assert.notEqual(getChartCacheKey(diffHour), keyA, 'hour change must invalidate cache key');
  assert.notEqual(getChartCacheKey(diffGender), keyA, 'gender change must invalidate cache key');

  // Leap month policy sensitivity (automatic capture from generateChart + explicit override)
  const leapDefault = generateChart({ year: 2017, month: 8, day: 21, hour: 4, gender: 'female' });
  const leapOrigin = generateChart(
    { year: 2017, month: 8, day: 21, hour: 4, gender: 'female' },
    { leapMonth: 'origin-month' },
  );
  const leapNext = generateChart(
    { year: 2017, month: 8, day: 21, hour: 4, gender: 'female' },
    { leapMonth: 'next-month' },
  );
  assert.notEqual(getChartCacheKey(leapDefault), getChartCacheKey(leapOrigin));
  assert.notEqual(getChartCacheKey(leapOrigin), getChartCacheKey(leapNext));
  assert.equal(getBirthChartKeyParams(leapOrigin).leapMonthPolicy, 'origin-month');
  assert.equal(
    getBirthChartKeyParams(leapDefault, { leapMonthPolicy: 'prev-month' }).leapMonthPolicy,
    'prev-month',
  );

  // Target year sensitivity
  const key2026 = getChartCacheKey(chartA, { targetYear: 2026 });
  const key2027 = getChartCacheKey(chartA, { targetYear: 2027 });
  assert.notEqual(key2026, keyA);
  assert.notEqual(key2026, key2027);
  assert.equal(getBirthChartKeyParams(chartA, { targetYear: 2026 }).targetYear, 2026);

  assert.throws(() => getChartCacheKey(chartA, { targetYear: 2026.5 }), RangeError);
}

// ── 2) Free Ming / Shen / SanFangSiZheng & Empty-Palace Borrowing ─────────────

{
  // 2023-03-22 h4 female has empty 命宫 at 亥, borrowing 廉贞 + 贪狼 from 迁移 at 巳
  const emptyMingChart = generateChart({ year: 2023, month: 3, day: 22, hour: 4, gender: 'female' });
  const mingSummary = extractFreeMingSummary(emptyMingChart);

  assert.equal(mingSummary.mingPalace.palaceName, '命宫');
  assert.equal(mingSummary.mingPalace.branchName, '亥');
  assert.equal(mingSummary.mingPalace.isEmpty, true);
  assert.equal(mingSummary.mingPalace.majorStars.length, 0);
  assert.equal(mingSummary.mingPalace.borrowedFromName, '迁移');
  assert.deepEqual(mingSummary.mingPalace.borrowedStars, ['廉贞', '贪狼']);
  assert.deepEqual(
    mingSummary.mingPalace.effectiveMajorStars.map((s) => s.name),
    ['廉贞', '贪狼'],
  );
  assert.ok(mingSummary.mingPalace.effectiveMajorStars.every((s) => s.borrowed === true));

  // Verify SanFangSiZheng canonical 4 palaces (命宫, 财帛, 官禄, 迁移)
  assert.deepEqual(
    mingSummary.sanFangSiZheng.map((p) => p.palaceName),
    ['命宫', '财帛', '官禄', '迁移'],
  );

  // 2017-08-20 h4 female has empty 官禄 at 申, borrowing 太阳 + 巨门 from 夫妻 at 寅
  const emptyCareerChart = generateChart({ year: 2017, month: 8, day: 20, hour: 4, gender: 'female' });
  const careerSummary = extractFreeMingSummary(emptyCareerChart);
  const guan = careerSummary.sanFangSiZheng.find((p) => p.palaceName === '官禄');
  assert.ok(guan);
  assert.equal(guan.isEmpty, true);
  assert.equal(guan.borrowedFromName, '夫妻');
  assert.deepEqual(guan.borrowedStars, ['太阳', '巨门']);
  assert.ok(guan.effectiveMajorStars.every((s) => s.borrowed === true));

  // 1988-10-08 h7 male (戊年): 贪狼禄, 太阴权, 右弼科 (tests lucky-star SiHua & non-empty 命宫)
  const wuChart = generateChart({ year: 1988, month: 10, day: 8, hour: 7, gender: 'male' });
  const wuSummary = extractFreeMingSummary(wuChart);
  assert.equal(wuSummary.mingPalace.isEmpty, false);
  assert.deepEqual(wuSummary.mingPalace.borrowedStars, []);
  assert.deepEqual(
    wuSummary.favorableSiHua.map((f) => `${f.starName}:${f.siHua}`),
    ['贪狼:禄', '太阴:权', '右弼:科'],
  );
  assert.equal(wuSummary.shenPalace.isSameAsMing, false);

  // 1992-01-10 h0 male has 命身同宫 (isSameAsMing === true)
  const sameMingShen = generateChart({ year: 1992, month: 1, day: 10, hour: 0, gender: 'male' });
  assert.equal(extractFreeMingSummary(sameMingShen).shenPalace.isSameAsMing, true);
}

// ── 3) Zero-LLM Pain-Point Extraction ─────────────────────────────────────────

{
  // 1990-05-15 h4 male (庚年): 天同化忌 in 财帛 (with 擎羊)
  const chart90 = generateChart({ year: 1990, month: 5, day: 15, hour: 4, gender: 'male' });
  const basePains = extractChartPainPoints(chart90);

  const natalJi = basePains.find((p) => p.category === 'natal_huaji');
  assert.ok(natalJi, 'must detect natal HuaJi');
  assert.equal(natalJi.palaceName, '财帛');
  assert.equal(natalJi.isLockedPalace, true);
  assert.equal(natalJi.severity, 'high');
  assert.ok(natalJi.stars.includes('天同'));
  assert.ok(natalJi.siHua.includes('natal:忌'));
  assert.ok(natalJi.facts.includes('opposes_palace:福德'));

  // 2025 (乙年 -> 太阴化忌 in 福德) clashes opposite 财帛 (Natal + DaXian 天同化忌) => 双忌冲 + 双忌叠
  const pains2025 = extractChartPainPoints(chart90, { targetYear: 2025 });
  const stackJi = pains2025.find((p) => p.id.startsWith('double_huaji:stack:'));
  const clashJi = pains2025.find((p) => p.id.startsWith('double_huaji:clash:'));
  const annualJi = pains2025.find((p) => p.category === 'liunian_huaji');
  assert.ok(stackJi, 'must detect same-palace double HuaJi');
  assert.equal(stackJi.severity, 'high');
  assert.equal(stackJi.palaceName, '财帛');
  assert.ok(clashJi, 'must detect opposite-palace double HuaJi clash (双忌冲)');
  assert.equal(clashJi.severity, 'high');
  assert.ok(clashJi.facts.includes('opposite_palace_double_ji'));
  assert.ok(clashJi.facts.includes('axis_palaces:财帛<->福德'));
  assert.ok(annualJi, 'must detect 2025 annual HuaJi');
  assert.equal(annualJi.palaceName, '福德');
  assert.ok(annualJi.facts.includes('target_year:2025'));

  // 1995-11-03 h9 male in 2026: Natal 太阴化忌@福德 + DaXian 廉贞化忌@官禄 clamp 田宅 (双忌夹)
  const chart95 = generateChart({ year: 1995, month: 11, day: 3, hour: 9, gender: 'male' });
  const pains95 = extractChartPainPoints(chart95, { targetYear: 2026 });
  const clampJi = pains95.find((p) => p.id.startsWith('double_huaji:clamp:'));
  assert.ok(clampJi, 'must detect adjacent-palace HuaJi clamp (双忌夹)');
  assert.equal(clampJi.palaceName, '田宅');
  assert.equal(clampJi.severity, 'high');
  assert.ok(clampJi.facts.includes('clamped_by_huaji'));

  // Verify non-major (lucky star) Natal HuaJi detection: 辛年 文昌化忌 & 己年 文曲化忌
  const xinChart = generateChart({ year: 1981, month: 6, day: 15, hour: 4, gender: 'male' });
  const xinNatalJi = extractChartPainPoints(xinChart).find((p) => p.category === 'natal_huaji');
  assert.ok(xinNatalJi && xinNatalJi.stars.includes('文昌'), 'must detect 辛年 文昌化忌');

  const jiChart = generateChart({ year: 1989, month: 6, day: 15, hour: 4, gender: 'female' });
  const jiNatalJi = extractChartPainPoints(jiChart).find((p) => p.category === 'natal_huaji');
  assert.ok(jiNatalJi && jiNatalJi.stars.includes('文曲'), 'must detect 己年 文曲化忌');

  // Verify self-transformation (自化忌) fallback computation via detectSelfSihua & pre-populated override
  const wuChart = generateChart({ year: 1988, month: 10, day: 8, hour: 7, gender: 'male' });
  const expectedSelfJiPalaces = wuChart.palaces
    .filter((p) => detectSelfSihua(p).some((m) => m.siHua === '忌'))
    .map((p) => p.name);
  assert.ok(expectedSelfJiPalaces.length > 0, '1988-10-08 chart should have at least one 自化忌 palace');
  const detectedSelfJi = extractChartPainPoints(wuChart)
    .filter((p) => p.category === 'self_huaji')
    .map((p) => p.palaceName);
  assert.deepEqual(detectedSelfJi.sort(), expectedSelfJiPalaces.sort());

  // Populated palace.selfSihua override is honored
  const clonedChart: ZiweiChart = {
    ...chart90,
    palaces: chart90.palaces.map((p) =>
      p.name === '夫妻'
        ? { ...p, selfSihua: [{ siHua: '忌', starName: '太阳' }] }
        : p,
    ),
  };
  const customSelf = extractChartPainPoints(clonedChart).find(
    (p) => p.category === 'self_huaji' && p.palaceName === '夫妻',
  );
  assert.ok(customSelf && customSelf.stars.includes('太阳'));

  // Childhood DaXian HuaJi (2023-03-22 h4 female in targetYear: 2026)
  const childChart = generateChart({ year: 2023, month: 3, day: 22, hour: 4, gender: 'female' });
  const childPains = extractChartPainPoints(childChart, { targetYear: 2026 });
  assert.ok(
    childPains.some((p) => p.category === 'daxian_huaji'),
    'must resolve childhood DaXian HuaJi when targetYear falls before first DaXian',
  );
  const ln2026 = getLiuNianSiHua(2026);
  const childAnnual = childPains.find((p) => p.category === 'liunian_huaji');
  assert.ok(childAnnual && childAnnual.stars.includes(ln2026.transforms['忌']));

  // Heavy Sha clustering in core locked palace (1992-01-10 h0 male: 夫妻 廉贞+贪狼+地空+地劫)
  const shaChart = generateChart({ year: 1992, month: 1, day: 10, hour: 0, gender: 'male' });
  const shaPain = extractChartPainPoints(shaChart).find(
    (p) => p.category === 'sha_cluster' && p.palaceName === '夫妻',
  );
  assert.ok(shaPain, 'must detect heavy Sha clustering with volatile/dim stars in 夫妻');
  assert.equal(shaPain.severity, 'high');
  assert.ok(shaPain.stars.includes('地空') && shaPain.stars.includes('地劫'));

  // maxPoints & priority sorting invariants
  const top2 = extractChartPainPoints(chart90, { targetYear: 2025, maxPoints: 2 });
  assert.equal(top2.length, 2);
  assert.ok(top2[0].priorityScore >= top2[1].priorityScore);
  assert.equal(extractChartPainPoints(chart90, { maxPoints: 0 }).length, 0);

  // Combined summary helper
  const summary = analyzeChartSummary(chart90, { targetYear: 2025, maxPainPoints: 3 });
  assert.equal(summary.cacheKey, getChartCacheKey(chart90, { targetYear: 2025 }));
  assert.equal(summary.painPoints.length, 3);
}

// ── 4) Compact LLM Prompt Payload (< 3 KB) ────────────────────────────────────

{
  const densePatterns: PatternSummary[] = [
    {
      name: '三奇加会',
      level: 'excellent',
      palaces: ['命宫', '财帛', '官禄'],
      description: '冗长的格局自然语言描述，不应该塞进紧凑提示词载荷里。'.repeat(8),
    },
    { name: '君臣庆会', level: 'excellent', palaces: ['命宫'] },
    { name: '府相朝垣', level: 'good', palaces: ['财帛', '官禄'] },
    { name: '火贪格', level: 'good', palaces: ['迁移'] },
    { name: '羊陀夹忌', level: 'caution', palaces: ['财帛', '福德'] },
    { name: '杀破狼', level: 'caution', palaces: ['命宫', '财帛', '官禄'] },
  ];

  // Test across 16 diverse charts including empty palaces & non-default school brightness
  setBrightnessSchool('XD2');
  try {
    for (let y = 1975; y <= 2020; y += 3) {
      const chart = generateChart({
        year: y,
        month: (y % 12) + 1,
        day: 15,
        hour: y % 12,
        gender: y % 2 === 0 ? 'male' : 'female',
        name: 'SECRET_PII_NAME',
        city: '莫斯科',
        longitude: 37.6,
        origInput: { year: y, month: 1, day: 1, clockHour: 23, clockMinute: 45 },
      });
      chart.analysisCacheProfile = 'signed-internal-profile-token';

      const payload = buildChartPromptPayload(chart, {
        targetYear: 2026,
        patterns: densePatterns,
      });

      const serialized = JSON.stringify(payload);
      const byteLen = Buffer.byteLength(serialized, 'utf8');
      assert.ok(
        byteLen < 3072,
        `prompt payload for ${y} exceeded 3 KB (${byteLen} bytes)`,
      );

      // Stripped PII & redundant UI/internal fields
      assert.equal(serialized.includes('SECRET_PII_NAME'), false);
      assert.equal(serialized.includes('signed-internal-profile-token'), false);
      assert.equal(serialized.includes('冗长的格局自然语言描述'), false);
      assert.equal(serialized.includes('莫斯科'), false);

      // Required condensed 12 palaces & metadata
      assert.equal(payload.palaces.length, 12);
      assert.ok(payload.wuxingJuName);
      assert.ok(payload.mingZhu);
      assert.ok(payload.shenZhu);
      assert.ok(payload.yinYangGender);
      assert.equal(payload.liuNian?.year, 2026);
      assert.ok(payload.patterns && payload.patterns.length >= 1);

      // Verify empty palaces expose borrowedFrom
      const emptyChartPalaces = chart.palaces.filter((p) => p.isEmpty);
      for (const ep of emptyChartPalaces) {
        const entry = payload.palaces.find((p) => p.name === ep.name);
        assert.ok(entry?.borrowedFrom, `empty palace ${ep.name} missing borrowedFrom`);
      }

      // Verify stars retain brightnessRaw / siHua notation
      const natalJiPalace = chart.palaces.find((p) => p.stars.some((s) => s.siHua === '忌'));
      if (natalJiPalace) {
        const pEntry = payload.palaces.find((p) => p.name === natalJiPalace.name);
        assert.ok(pEntry?.stars.some((s) => s.includes('忌')));
      }
    }
  } finally {
    setBrightnessSchool('default');
  }

  // Also verify without targetYear or patterns (daXian uses currentDaXianIndex, liuNian omitted)
  const chart90 = generateChart({ year: 1990, month: 5, day: 15, hour: 4, gender: 'male' });
  const natalPayload = buildChartPromptPayload(chart90);
  assert.equal(natalPayload.liuNian, undefined);
  assert.equal(natalPayload.patterns, undefined);
  const dx = getDaXianSiHua(chart90, chart90.currentDaXianIndex);
  if (dx) {
    assert.equal(natalPayload.daXian?.stem, dx.stemName);
  }
  assert.ok(
    natalPayload.palaces.some((p) => p.branch === BRANCHES[chart90.mingGongBranch]),
  );
}

console.log('✓ chart-analyzer regression passed (cache keys, Ming/SanFang borrowing, pain points, <3KB prompt payloads)');
