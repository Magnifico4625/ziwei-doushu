/**
 * Stage 3 (PR #12 / Slice A) comprehensive deterministic regression test:
 * 1. Client/server safety of `patterns.ts`, `famous.ts`, `heming-knowledge.ts`,
 *    `i18n.ts`, `db-analysis.ts`, `paywall-teasers.ts` (zero server-guard imports, zero LLM calls).
 * 2. Full `'ru' | 'zh' | 'en'` dictionary coverage in `lib/ziwei/i18n.ts`.
 * 3. Multilingual `lib/ziwei/cities.ts` lookup (`Москва`, `Moscow`, `莫斯科`) & DST preservation.
 * 4. Deterministic `命宫` Free Tier (`db-analysis.ts`) across all 14 Major Stars, key dual-star
 *    combinations, empty `命宫` (`空宫/借星`) borrowing, brightness, and natal SiHua nuances.
 * 5. Deterministic Zero-LLM paywall teasers (`paywall-teasers.ts`) for charts & synastry.
 * 6. Strict license & neutral-naming scan across `lib/ziwei/*` (plus `lib/server/*` and `app/api/*` when present).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { generateChart } from '../../lib/ziwei/algorithm';
import { analyzeChartSummary } from '../../lib/ziwei/chart-analyzer';
import {
  findCityByQuery,
  getCityDisplayName,
  inferCityTimeZone,
  PROVINCES,
} from '../../lib/ziwei/cities';
import { BRANCHES, PALACE_NAMES_ORDER, STEMS } from '../../lib/ziwei/constants';
import {
  ALL_MAJOR_STARS,
  generateFreeLifePalaceReading,
  KEY_DUAL_STAR_COMBOS,
  STAR_DB,
  TOPIC_LABEL,
  TOPIC_PALACE_NAME,
  type DualStarComboKey,
  type MajorStarName,
} from '../../lib/ziwei/db-analysis';
import { isChinaDST, isChinaDSTYear } from '../../lib/ziwei/dst-cn';
import { FAMOUS_PERSONS } from '../../lib/ziwei/famous';
import { analyzeSynastry, type SynastryResult } from '../../lib/ziwei/heming';
import {
  BRIGHTNESS_LABELS,
  normalizeLang,
  PALACE_LABELS,
  PATTERN_LABELS,
  SIHUA_LABELS,
  STAR_LABELS,
  translateBranch,
  translateBrightness,
  translateChartSummary,
  translatePalace,
  translatePattern,
  translateSiHua,
  translateStar,
  translateStem,
  translateWuxingJu,
  type SupportedLang,
} from '../../lib/ziwei/i18n';
import { detectPatterns } from '../../lib/ziwei/patterns';
import {
  generateChartTeasers,
  generateSynastryTeasers,
} from '../../lib/ziwei/paywall-teasers';
import { calculateTrueSolarTime, resolveTimeZoneOffsetMinutes } from '../../lib/ziwei/true-solar-time';
import type {
  BirthInfo,
  Palace,
  SiHua,
  Star,
  StarBrightness,
  ZiweiChart,
} from '../../lib/ziwei/types';

const REPO_ROOT = path.resolve(__dirname, '../..');
const HAS_CJK_RE = /[\u4e00-\u9fff]/;

let passed = 0;
function runTest(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}

function makeEmptyPalace(branchIdx: number, name: string): Palace {
  const stemIdx = (branchIdx + 2) % 10;
  return {
    branch: branchIdx,
    stem: stemIdx,
    name,
    stars: [],
    isMingGong: branchIdx === 0,
    isShenGong: branchIdx === 0,
    isEmpty: true,
    oppositeBranch: (branchIdx + 6) % 12,
  };
}

function makeSyntheticChart(options: {
  mingStars?: Star[];
  qianyiStars?: Star[];
  prePopulateBorrowed?: boolean;
  extraPalaceOverrides?: Partial<Record<string, Star[]>>;
}): ZiweiChart {
  const palaces: Palace[] = PALACE_NAMES_ORDER.map((name, idx) => makeEmptyPalace(idx, name));
  const ming = palaces[0];
  const qianyi = palaces[6];

  ming.stars = options.mingStars ? [...options.mingStars] : [];
  const mingHasMajor = ming.stars.some((s) => s.type === 'major');
  ming.isEmpty = !mingHasMajor;
  ming.oppositeBranch = 6;

  qianyi.stars = options.qianyiStars ? [...options.qianyiStars] : [];
  const qianyiMajors = qianyi.stars.filter((s) => s.type === 'major');
  qianyi.isEmpty = qianyiMajors.length === 0;
  qianyi.oppositeBranch = 0;

  if (ming.isEmpty && options.prePopulateBorrowed && qianyiMajors.length > 0) {
    ming.borrowedFromBranch = qianyi.branch;
    ming.borrowedFromName = qianyi.name;
    ming.borrowedStars = qianyiMajors.map((s) => s.name);
  }

  if (options.extraPalaceOverrides) {
    for (const p of palaces) {
      const ovStars = options.extraPalaceOverrides[p.name];
      if (!ovStars) continue;
      p.stars = [...ovStars];
      p.isEmpty = !p.stars.some((s) => s.type === 'major');
    }
  }

  const birthInfo: BirthInfo = {
    year: 1992,
    month: 6,
    day: 15,
    hour: 5,
    gender: 'male',
    name: 'TestFixture',
  };

  return {
    birthInfo,
    lunarInfo: {
      lunarYear: 1992,
      lunarMonth: 5,
      lunarDay: 15,
      yearStem: 8,
      yearBranch: 8,
      isLeapMonth: false,
    },
    mingGongBranch: 0,
    shenGongBranch: 0,
    wuxingJu: 4,
    wuxingJuName: '金四局',
    ziweiPos: 4,
    palaces,
    daXians: [
      {
        startAge: 4,
        endAge: 13,
        palaceBranch: 0,
        palaceName: '命宫',
        stemIndex: 2,
        stemName: '丙',
      },
      {
        startAge: 34,
        endAge: 43,
        palaceBranch: 3,
        palaceName: '子女',
        stemIndex: 5,
        stemName: '己',
      },
    ],
    currentAge: 35,
    currentDaXianIndex: 1,
    mingZhu: '贪狼',
    shenZhu: '火星',
  };
}

function collectSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (entry.isFile() && /\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// ── 1. Direct client/server import safety (zero server guard, zero legacy quote key) ──

const LEGACY_QUOTE_KEY = 'ni_' + 'quote';
const SERVER_GUARD_RE = new RegExp(`^\\s*import\\s+['"]${'server'}-only['"]`, 'm');

runTest('1. patterns.ts & famous.ts import directly for client/server use without legacy quote key', () => {
  const pureModules = [
    'lib/ziwei/patterns.ts',
    'lib/ziwei/famous.ts',
    'lib/ziwei/heming-knowledge.ts',
    'lib/ziwei/i18n.ts',
    'lib/ziwei/db-analysis.ts',
    'lib/ziwei/paywall-teasers.ts',
  ];
  for (const rel of pureModules) {
    const abs = path.join(REPO_ROOT, rel);
    const src = fs.readFileSync(abs, 'utf8');
    assert.ok(
      !SERVER_GUARD_RE.test(src),
      `${rel} must not import Next server guard`,
    );
  }

  assert.ok(Array.isArray(FAMOUS_PERSONS) && FAMOUS_PERSONS.length >= 10, 'FAMOUS_PERSONS populated');
  for (const person of FAMOUS_PERSONS) {
    assert.ok(!(LEGACY_QUOTE_KEY in person), `FAMOUS_PERSONS entry ${person.id} must not have ${LEGACY_QUOTE_KEY}`);
  }

  const chart = generateChart({
    year: 1990,
    month: 3,
    day: 12,
    hour: 4,
    gender: 'male',
  });
  const patterns = detectPatterns(chart);
  assert.ok(Array.isArray(patterns), 'detectPatterns returns Pattern[]');
  for (const pat of patterns) {
    assert.ok(!(LEGACY_QUOTE_KEY in pat), `Pattern ${pat.name} must not have ${LEGACY_QUOTE_KEY}`);
  }
});

// ── 2. Full i18n dictionary coverage ('ru' | 'zh' | 'en') ──

runTest('2a. i18n normalizeLang & basic dictionaries cover ru/zh/en cleanly', () => {
  assert.equal(normalizeLang(undefined), 'ru');
  assert.equal(normalizeLang('ru-RU'), 'ru');
  assert.equal(normalizeLang('zh-CN'), 'zh');
  assert.equal(normalizeLang('cn'), 'zh');
  assert.equal(normalizeLang('en-US'), 'en');
  assert.equal(normalizeLang('fr', 'en'), 'en');

  const langs: SupportedLang[] = ['ru', 'zh', 'en'];
  const canonicalPalaces = [
    '命宫', '身宫', '兄弟', '夫妻', '子女', '财帛',
    '疾厄', '迁移', '仆役', '交友', '官禄', '田宅', '福德', '父母',
  ];
  for (const p of canonicalPalaces) {
    assert.ok(PALACE_LABELS[p], `PALACE_LABELS missing ${p}`);
    for (const lang of langs) {
      const label = translatePalace(p, lang);
      assert.ok(label.trim().length > 0, `Empty palace translation for ${p} in ${lang}`);
      if (lang !== 'zh') {
        assert.ok(!HAS_CJK_RE.test(label), `CJK leaked in ${lang} palace label for ${p}: ${label}`);
      }
    }
  }

  const requiredStars = [
    ...ALL_MAJOR_STARS,
    '文昌', '文曲', '左辅', '右弼', '天魁', '天钺',
    '擎羊', '陀罗', '火星', '铃星', '地空', '地劫',
    '禄存', '天马', '红鸾', '天喜', '天姚', '咸池',
  ];
  for (const star of requiredStars) {
    assert.ok(STAR_LABELS[star], `STAR_LABELS missing ${star}`);
    for (const lang of langs) {
      const label = translateStar(star, lang);
      assert.ok(label.trim().length > 0, `Empty star translation for ${star} in ${lang}`);
      if (lang !== 'zh') {
        assert.ok(!HAS_CJK_RE.test(label), `CJK leaked in ${lang} star label for ${star}: ${label}`);
      }
    }
  }

  const sihuaList: SiHua[] = ['禄', '权', '科', '忌'];
  for (const sh of sihuaList) {
    assert.ok(SIHUA_LABELS[sh], `SIHUA_LABELS missing ${sh}`);
    for (const lang of langs) {
      const label = translateSiHua(sh, lang);
      assert.ok(label.trim().length > 0);
      if (lang !== 'zh') {
        assert.ok(!HAS_CJK_RE.test(label), `CJK leaked in ${lang} sihua label for ${sh}: ${label}`);
      }
    }
  }

  const brightnessList: Array<StarBrightness | 'bright' | 'normal' | 'dim'> = [
    '庙', '旺', '得', '利', '平', '不', '闲', '陷', '地', 'bright', 'normal', 'dim',
  ];
  for (const b of brightnessList) {
    assert.ok(BRIGHTNESS_LABELS[b], `BRIGHTNESS_LABELS missing ${b}`);
    for (const lang of langs) {
      const label = translateBrightness(b, lang);
      assert.ok(label.trim().length > 0);
      if (lang !== 'zh') {
        assert.ok(!HAS_CJK_RE.test(label), `CJK leaked in ${lang} brightness label for ${b}: ${label}`);
      }
    }
  }

  const bureaus = ['水二局', '木三局', '金四局', '土五局', '火六局'];
  for (const ju of bureaus) {
    for (const lang of langs) {
      const label = translateWuxingJu(ju, lang);
      assert.ok(label.trim().length > 0);
      if (lang !== 'zh') {
        assert.ok(!HAS_CJK_RE.test(label), `CJK leaked in ${lang} WuXingJu ${ju}: ${label}`);
      }
    }
  }

  for (const stem of STEMS) {
    for (const lang of langs) {
      const s = translateStem(stem, lang);
      assert.ok(s.trim().length > 0);
      if (lang !== 'zh') assert.ok(!HAS_CJK_RE.test(s), `CJK leaked in stem ${stem}: ${s}`);
    }
  }
  for (const branch of BRANCHES) {
    for (const lang of langs) {
      const b = translateBranch(branch, lang);
      assert.ok(b.trim().length > 0);
      if (lang !== 'zh') assert.ok(!HAS_CJK_RE.test(b), `CJK leaked in branch ${branch}: ${b}`);
    }
  }
});

runTest('2b. Every static pattern in patterns.ts + dynamic SiHua patterns covered in i18n', () => {
  const patternsSrc = fs.readFileSync(path.join(REPO_ROOT, 'lib/ziwei/patterns.ts'), 'utf8');
  const staticNames = new Set<string>();
  const re = /name:\s*'([^']+)'/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(patternsSrc)) !== null) {
    staticNames.add(match[1]);
  }
  assert.ok(staticNames.size >= 34, `Expected >= 34 static pattern names in patterns.ts, got ${staticNames.size}`);

  for (const name of staticNames) {
    assert.ok(PATTERN_LABELS[name], `PATTERN_LABELS missing static pattern "${name}"`);
    for (const lang of ['ru', 'zh', 'en'] as const) {
      const tr = translatePattern(name, 'good', undefined, lang);
      assert.ok(tr.name.trim().length > 0, `Empty pattern name for ${name} in ${lang}`);
      assert.ok(tr.description.trim().length > 0, `Empty pattern desc for ${name} in ${lang}`);
      if (lang !== 'zh') {
        assert.ok(!HAS_CJK_RE.test(tr.name), `CJK leaked in ${lang} pattern name for ${name}: ${tr.name}`);
        assert.ok(!HAS_CJK_RE.test(tr.description), `CJK leaked in ${lang} pattern desc for ${name}: ${tr.description}`);
      }
    }
  }

  for (const dyn of ['紫微化禄入命', '巨门化忌入命', '太阳化忌入迁']) {
    for (const lang of ['ru', 'zh', 'en'] as const) {
      const tr = translatePattern(dyn, 'caution', undefined, lang);
      assert.ok(tr.name.trim().length > 0 && tr.description.trim().length > 0);
      if (lang !== 'zh') {
        assert.ok(!HAS_CJK_RE.test(tr.name), `CJK leaked in dynamic pattern name ${dyn}: ${tr.name}`);
        assert.ok(!HAS_CJK_RE.test(tr.description), `CJK leaked in dynamic pattern desc ${dyn}: ${tr.description}`);
      }
    }
  }
});

runTest('2c. translateChartSummary localizes full ChartAnalysisSummary without CJK leakage in ru/en', () => {
  const chart = generateChart({
    year: 1988,
    month: 11,
    day: 24,
    hour: 7,
    gender: 'female',
  });
  const analysis = analyzeChartSummary(chart, { targetYear: 2026 });
  const patterns = detectPatterns(chart);

  for (const lang of ['ru', 'en'] as const) {
    const tr = translateChartSummary(chart, analysis, patterns, lang);
    assert.equal(tr.lang, lang);
    assert.ok(!HAS_CJK_RE.test(tr.basic.wuxingJu), `wuxingJu leaked CJK in ${lang}`);
    assert.ok(!HAS_CJK_RE.test(tr.basic.mingZhu), `mingZhu leaked CJK in ${lang}`);
    assert.ok(!HAS_CJK_RE.test(tr.basic.shenZhu), `shenZhu leaked CJK in ${lang}`);
    assert.ok(!HAS_CJK_RE.test(tr.mingPalace.palaceName), `mingPalace.palaceName leaked CJK in ${lang}`);
    for (const star of tr.mingPalace.effectiveMajorStars) {
      assert.ok(!HAS_CJK_RE.test(star.name), `star.name leaked CJK in ${lang}: ${star.name}`);
    }
    for (const pp of tr.painPoints) {
      assert.ok(!HAS_CJK_RE.test(pp.palaceName), `painPoint.palaceName leaked CJK in ${lang}`);
      assert.ok(!HAS_CJK_RE.test(pp.categoryLabel), `painPoint.categoryLabel leaked CJK in ${lang}`);
      for (const fact of pp.facts) {
        assert.ok(!HAS_CJK_RE.test(fact), `painPoint.fact leaked CJK in ${lang}: ${fact}`);
      }
    }
  }
});

// ── 3. Multilingual cities.ts lookup & DST correctness ──

runTest('3. cities.ts multilingual query lookup (ru/en/zh) + preserved 58 overseas + DST correctness', () => {
  const overseas = PROVINCES.find((p) => p.name === '海外 / 国际');
  assert.ok(overseas, 'Overseas province must exist');
  assert.equal(overseas.cities.length, 58, 'Existing 58 overseas cities invariant must hold');

  const ruHit = findCityByQuery('Москва', 'ru');
  const enHit = findCityByQuery('Moscow', 'en');
  const zhHit = findCityByQuery('莫斯科', 'zh');
  const prefixHit = findCityByQuery('г. Москва', 'ru');
  assert.ok(ruHit && enHit && zhHit && prefixHit, 'Moscow lookup works in ru/en/zh and admin-prefix');
  assert.equal(ruHit.city.name, '莫斯科');
  assert.equal(enHit.city.name, '莫斯科');
  assert.equal(zhHit.city.name, '莫斯科');
  assert.equal(prefixHit.city.name, '莫斯科');
  assert.equal(ruHit.city.timeZone, 'Europe/Moscow');

  assert.equal(getCityDisplayName(ruHit.city, 'ru'), 'Москва');
  assert.equal(getCityDisplayName(ruHit.city, 'en'), 'Moscow');
  assert.equal(getCityDisplayName(ruHit.city, 'zh'), '莫斯科');

  const spbAlias = findCityByQuery('СПб', 'ru');
  assert.ok(spbAlias && spbAlias.city.name === '圣彼得堡', 'Saint Petersburg alias lookup works');

  // Preserve inferCityTimeZone + historical DST correctness
  assert.equal(inferCityTimeZone(37.6, 180), 'Europe/Moscow');
  assert.equal(
    resolveTimeZoneOffsetMinutes('Europe/Moscow', 2014, 10, 26, 1, 30),
    240,
    'Moscow pre-permanent-UTC+3 2014-10-26 01:30 must resolve to UTC+4 (240)',
  );
  assert.equal(
    resolveTimeZoneOffsetMinutes('Europe/Moscow', 2014, 10, 27, 12, 0),
    180,
    'Moscow post-transition 2014-10-27 must resolve to UTC+3 (180)',
  );
  assert.equal(
    resolveTimeZoneOffsetMinutes('America/New_York', 2024, 7, 15, 12, 0),
    -240,
    'New York EDT summer offset must be -240',
  );
  assert.equal(
    resolveTimeZoneOffsetMinutes('America/New_York', 2024, 1, 15, 12, 0),
    -300,
    'New York EST winter offset must be -300',
  );

  // Preserve China historical DST helpers & TrueSolarTime integration
  assert.equal(isChinaDSTYear(1990), true);
  assert.equal(isChinaDST(1990, 7, 15), true);
  assert.equal(isChinaDST(1990, 12, 15), false);
  const solarMoscow = calculateTrueSolarTime({
    year: 2010,
    month: 7,
    day: 10,
    clockHour: 12,
    clockMinute: 0,
    longitude: ruHit.city.longitude,
    timeZone: ruHit.city.timeZone,
    utcOffsetMinutes: ruHit.city.utcOffsetMinutes,
  });
  assert.equal(solarMoscow.utcOffsetMinutes, 240, 'TrueSolarTime applies Moscow historical DST in 2010 summer');
});

// ── 4. Deterministic 命宫 Free Tier (db-analysis.ts) ──

runTest('4a. db-analysis preserves legacy SEO exports and empty STAR_DB', () => {
  assert.equal(TOPIC_PALACE_NAME.overview, '命宫');
  assert.equal(TOPIC_LABEL.career, '事业职业');
  assert.equal(Object.keys(STAR_DB).length, 0);
});

runTest('4b. generateFreeLifePalaceReading covers all 14 Major Stars in ru/zh/en', () => {
  assert.equal(ALL_MAJOR_STARS.length, 14);
  for (const starName of ALL_MAJOR_STARS) {
    const chart = makeSyntheticChart({
      mingStars: [{ name: starName, type: 'major', brightness: 'bright', brightnessRaw: '庙' }],
    });
    for (const lang of ['ru', 'zh', 'en'] as const) {
      const reading = generateFreeLifePalaceReading(chart, lang);
      assert.equal(reading.lang, lang);
      assert.equal(reading.isEmpty, false);
      assert.ok(reading.stars.every((s) => !s.borrowed));
      assert.ok(reading.archetypeTitle.trim().length > 0, `Empty title for ${starName} (${lang})`);
      assert.ok(reading.starSummary.trim().length > 0, `Empty summary for ${starName} (${lang})`);
      assert.ok(reading.paragraphs.length >= 2 && reading.paragraphs.length <= 3, `Expected 2-3 paragraphs for ${starName}`);
      assert.ok(reading.paragraphs.every((p) => p.trim().length >= 30), `Short paragraph for ${starName} (${lang})`);
      assert.ok(reading.keywords.length >= 3, `Expected >= 3 keywords for ${starName} (${lang})`);
      if (lang !== 'zh') {
        assert.ok(!HAS_CJK_RE.test(reading.archetypeTitle), `CJK leaked in title for ${starName} (${lang})`);
        assert.ok(!HAS_CJK_RE.test(reading.starSummary), `CJK leaked in starSummary for ${starName} (${lang})`);
        for (const p of reading.paragraphs) {
          assert.ok(!HAS_CJK_RE.test(p), `CJK leaked in paragraph for ${starName} (${lang}): ${p}`);
        }
        for (const kw of reading.keywords) {
          assert.ok(!HAS_CJK_RE.test(kw), `CJK leaked in keyword for ${starName} (${lang}): ${kw}`);
        }
      }
    }
  }
});

runTest('4c. generateFreeLifePalaceReading covers key dual-star combos regardless of star order', () => {
  const comboExamples: ReadonlyArray<[DualStarComboKey, MajorStarName, MajorStarName]> = [
    ['紫府', '紫微', '天府'],
    ['机月', '天机', '太阴'],
    ['日月', '太阳', '太阴'],
    ['廉杀', '廉贞', '七杀'],
    ['武杀', '武曲', '七杀'],
    ['武贪', '武曲', '贪狼'],
    ['巨日', '巨门', '太阳'],
    ['同梁', '天同', '天梁'],
    ['廉相', '廉贞', '天相'],
  ];

  assert.equal(KEY_DUAL_STAR_COMBOS.length, 9);
  for (const [comboKey, starA, starB] of comboExamples) {
    const forward = makeSyntheticChart({
      mingStars: [
        { name: starA, type: 'major', brightness: 'bright', brightnessRaw: '旺' },
        { name: starB, type: 'major', brightness: 'bright', brightnessRaw: '旺' },
      ],
    });
    const reversed = makeSyntheticChart({
      mingStars: [
        { name: starB, type: 'major', brightness: 'bright', brightnessRaw: '旺' },
        { name: starA, type: 'major', brightness: 'bright', brightnessRaw: '旺' },
      ],
    });

    for (const lang of ['ru', 'zh', 'en'] as const) {
      const r1 = generateFreeLifePalaceReading(forward, lang);
      const r2 = generateFreeLifePalaceReading(reversed, lang);
      assert.equal(r1.comboKey, comboKey, `Expected ${comboKey} for ${starA}+${starB}`);
      assert.equal(r2.comboKey, comboKey, `Expected ${comboKey} for reversed ${starB}+${starA}`);
      assert.equal(r1.archetypeTitle, r2.archetypeTitle, 'Combo title invariant under star ordering');
      assert.ok(r1.paragraphs.length >= 2);
      if (lang !== 'zh') {
        assert.ok(!HAS_CJK_RE.test(r1.archetypeTitle), `CJK leaked in dual title ${comboKey} (${lang})`);
        for (const p of r1.paragraphs) {
          assert.ok(!HAS_CJK_RE.test(p), `CJK leaked in dual paragraph ${comboKey} (${lang})`);
        }
      }
    }
  }
});

runTest('4d. Empty 命宫 (空宫/借星) borrows from opposite 迁移宫 and explains borrowed dynamic', () => {
  // Case A: pre-populated borrowedStars; Case B: empty 命宫 without pre-populated borrowedStars
  const cases = [
    makeSyntheticChart({
      mingStars: [],
      qianyiStars: [
        { name: '太阳', type: 'major', brightness: 'bright', brightnessRaw: '旺', siHua: '禄' },
        { name: '巨门', type: 'major', brightness: 'bright', brightnessRaw: '庙' },
      ],
      prePopulateBorrowed: true,
    }),
    makeSyntheticChart({
      mingStars: [],
      qianyiStars: [
        { name: '天机', type: 'major', brightness: 'normal', brightnessRaw: '平' },
        { name: '天梁', type: 'major', brightness: 'bright', brightnessRaw: '庙' },
      ],
      prePopulateBorrowed: false,
    }),
  ];

  for (const chart of cases) {
    for (const lang of ['ru', 'zh', 'en'] as const) {
      const reading = generateFreeLifePalaceReading(chart, lang);
      assert.equal(reading.isEmpty, true);
      assert.ok(reading.borrowedFromPalace, 'borrowedFromPalace populated');
      assert.ok(reading.stars.some((s) => s.borrowed), 'borrowed stars flagged in stars[]');
      const fullText = reading.paragraphs.join(' ');
      if (lang === 'ru') {
        assert.ok(/Пустой|заимств/i.test(fullText), 'RU reading notes empty/borrowed palace dynamic');
        assert.ok(!HAS_CJK_RE.test(fullText));
      } else if (lang === 'en') {
        assert.ok(/Empty|borrow/i.test(fullText), 'EN reading notes empty/borrowed palace dynamic');
        assert.ok(!HAS_CJK_RE.test(fullText));
      } else {
        assert.ok(/空宫|借星|迁移/.test(fullText), 'ZH reading notes 空宫/借星 dynamic');
      }
    }
  }

  // Edge case: both 命宫 and 迁移宫 empty (fallback without crash)
  const bothEmpty = makeSyntheticChart({ mingStars: [], qianyiStars: [] });
  for (const lang of ['ru', 'zh', 'en'] as const) {
    const reading = generateFreeLifePalaceReading(bothEmpty, lang);
    assert.equal(reading.isEmpty, true);
    assert.equal(reading.stars.length, 0);
    assert.ok(reading.paragraphs.length >= 2);
  }
});

runTest('4e. Brightness (庙/旺 vs 平 vs 陷) and natal SiHua (禄/权/科/忌) nuances differentiate output', () => {
  const brightChart = makeSyntheticChart({
    mingStars: [{ name: '太阴', type: 'major', brightness: 'bright', brightnessRaw: '庙', siHua: '禄' }],
  });
  const dimChart = makeSyntheticChart({
    mingStars: [{ name: '太阴', type: 'major', brightness: 'dim', brightnessRaw: '陷', siHua: '忌' }],
  });

  for (const lang of ['ru', 'zh', 'en'] as const) {
    const rBright = generateFreeLifePalaceReading(brightChart, lang);
    const rDim = generateFreeLifePalaceReading(dimChart, lang);
    assert.notEqual(rBright.brightnessNote, rDim.brightnessNote, `Brightness note differs in ${lang}`);
    assert.notEqual(rBright.siHuaNote, rDim.siHuaNote, `SiHua note differs in ${lang}`);
    assert.notEqual(rBright.paragraphs.join('\n'), rDim.paragraphs.join('\n'));
  }
});

// ── 5. Zero-LLM Paywall Teasers (paywall-teasers.ts) ──

runTest('5a. generateChartTeasers produces localized Free Tier + Patterns + Locked Hooks in ru/zh/en', () => {
  const realChart = generateChart({
    year: 1995,
    month: 9,
    day: 21,
    hour: 11,
    gender: 'female',
  });
  const realAnalysis = analyzeChartSummary(realChart, { targetYear: 2026 });
  const realPatterns = detectPatterns(realChart);

  const richChart = makeSyntheticChart({
    mingStars: [{ name: '紫微', type: 'major', brightness: 'bright', brightnessRaw: '庙', siHua: '权' }],
    extraPalaceOverrides: {
      财帛: [{ name: '破军', type: 'major', brightness: 'normal', brightnessRaw: '得' }],
      夫妻: [
        { name: '七杀', type: 'major', brightness: 'bright', brightnessRaw: '旺', siHua: '忌' },
        { name: '擎羊', type: 'sha', brightness: 'dim', brightnessRaw: '陷' },
      ],
    },
  });
  const richAnalysis = analyzeChartSummary(richChart, { targetYear: 2026 });
  const richPatterns = detectPatterns(richChart);

  for (const [chart, analysis, patterns] of [
    [realChart, realAnalysis, realPatterns],
    [richChart, richAnalysis, richPatterns],
  ] as const) {
    for (const lang of ['ru', 'zh', 'en'] as const) {
      const res = generateChartTeasers(chart, analysis, patterns, lang);
      assert.equal(res.lang, lang);
      assert.ok(res.freeLifePalace.paragraphs.length >= 2);
      assert.ok(res.patterns.headline.trim().length > 0);
      assert.ok(res.lockedTeasers.length >= 1, `Expected >= 1 locked teaser (${lang})`);
      assert.ok(res.unlockCta.trim().length > 0);
      for (const teaser of res.lockedTeasers) {
        assert.ok(teaser.hookHeadline.trim().length > 0);
        assert.ok(teaser.teaser.trim().length > 20);
        assert.ok(teaser.unlockCta.trim().length > 0);
        if (lang !== 'zh') {
          assert.ok(!HAS_CJK_RE.test(teaser.palaceName), `CJK leaked in teaser.palaceName (${lang})`);
          assert.ok(!HAS_CJK_RE.test(teaser.hookHeadline), `CJK leaked in teaser.hookHeadline (${lang})`);
          assert.ok(!HAS_CJK_RE.test(teaser.teaser), `CJK leaked in teaser.teaser (${lang}): ${teaser.teaser}`);
        }
      }
      if (lang !== 'zh') {
        assert.ok(!HAS_CJK_RE.test(res.patterns.headline), `CJK leaked in patterns.headline (${lang})`);
        for (const item of res.patterns.items) {
          assert.ok(!HAS_CJK_RE.test(item.label), `CJK leaked in pattern label (${lang}): ${item.label}`);
          assert.ok(!HAS_CJK_RE.test(item.summary), `CJK leaked in pattern summary (${lang}): ${item.summary}`);
        }
      }
    }
  }
});

runTest('5b. generateSynastryTeasers handles real synastry + empty friction fallback in ru/zh/en', () => {
  const chartA = generateChart({
    year: 1991,
    month: 4,
    day: 8,
    hour: 4,
    gender: 'male',
  });
  const chartB = generateChart({
    year: 1993,
    month: 10,
    day: 19,
    hour: 10,
    gender: 'female',
  });
  const synastry = analyzeSynastry(chartA, chartB, { targetYear: 2026 });

  const calmSynastry: SynastryResult = {
    ...synastry,
    score: 90,
    stars: 5,
    level: '五星',
    frictionPoints: [],
  };

  for (const resInput of [synastry, calmSynastry]) {
    for (const lang of ['ru', 'zh', 'en'] as const) {
      const out = generateSynastryTeasers(resInput, lang);
      assert.equal(out.lang, lang);
      assert.ok(out.scoreBandLabel.trim().length > 0);
      assert.ok(out.levelLabel.trim().length > 0);
      assert.ok(out.bondLabel.trim().length > 0);
      assert.ok(out.overview.trim().length > 20);
      assert.ok(out.lockedTeasers.length >= 1);
      assert.ok(out.unlockCta.trim().length > 0);
      if (lang !== 'zh') {
        assert.ok(!HAS_CJK_RE.test(out.scoreBandLabel));
        assert.ok(!HAS_CJK_RE.test(out.levelLabel));
        assert.ok(!HAS_CJK_RE.test(out.bondLabel));
        assert.ok(!HAS_CJK_RE.test(out.overview), `CJK leaked in synastry overview (${lang}): ${out.overview}`);
        for (const h of out.highlightSummaries) {
          assert.ok(!HAS_CJK_RE.test(h), `CJK leaked in highlight (${lang}): ${h}`);
        }
        for (const lt of out.lockedTeasers) {
          assert.ok(!HAS_CJK_RE.test(lt.hookHeadline), `CJK leaked in synastry hookHeadline (${lang}): ${lt.hookHeadline}`);
          assert.ok(!HAS_CJK_RE.test(lt.teaser), `CJK leaked in synastry teaser (${lang}): ${lt.teaser}`);
        }
      }
    }
  }
});

// ── 6. Strict Zero-LLM + Zero-`any` + License Cleanup Scan ──

runTest('6. Zero LLM/network calls in teaser/i18n modules & strict license scan across lib/ziwei/*', () => {
  const zeroLlmFiles = [
    path.join(REPO_ROOT, 'lib/ziwei/i18n.ts'),
    path.join(REPO_ROOT, 'lib/ziwei/db-analysis.ts'),
    path.join(REPO_ROOT, 'lib/ziwei/paywall-teasers.ts'),
  ];
  const tsAnyRe = new RegExp(`(:\\s*${'any'}\\b|\\bas\\s+${'any'}\\b|<${'any'}>|Array<${'any'}>)`);
  for (const file of zeroLlmFiles) {
    const src = fs.readFileSync(file, 'utf8');
    assert.ok(!/\bfetch\s*\(/.test(src), `${path.basename(file)} must not call fetch()`);
    assert.ok(!/@google\/genai|openai|anthropic/i.test(src), `${path.basename(file)} must not import LLM SDKs`);
    assert.ok(!tsAnyRe.test(src), `${path.basename(file)} must not use untyped any`);
  }

  const forbiddenTerms: ReadonlyArray<{ label: string; regex: RegExp }> = [
    { label: 'LEGACY_QUOTE', regex: new RegExp('ni_' + 'quote') },
    { label: 'LEGACY_DIR_NI', regex: new RegExp('lib/' + 'nihai', 'i') },
    { label: 'LEGACY_DOCS', regex: new RegExp('docs/' + 'tianji-ziwei', 'i') },
    { label: 'LEGACY_LICENSE', regex: new RegExp('CC\\s+BY-' + 'NC-SA', 'i') },
    { label: 'NI_HAI_XIA', regex: /\u502a\u6d77\u53a6/ },
    { label: 'NI_SHI', regex: /\u502a\u5e08/ },
    { label: 'TIAN_JI_BOOK', regex: /\u300a\u5929\u7eaa\u300b/ },
    { label: 'TIAN_JI', regex: /\u5929\u7eaa/ },
    { label: 'WEN_MO', regex: new RegExp('\\u6587\\u58a8|wen' + 'mo', 'i') },
  ];

  const scanRoots = [
    path.join(REPO_ROOT, 'lib/ziwei'),
    path.join(REPO_ROOT, 'lib/server'),
    path.join(REPO_ROOT, 'app/api'),
  ];
  const files = scanRoots.flatMap((dir) => collectSourceFiles(dir));
  assert.ok(files.some((f) => f.endsWith(`${path.sep}patterns.ts`)), 'lib/ziwei/patterns.ts scanned');

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const term of forbiddenTerms) {
      assert.ok(
        !term.regex.test(src),
        `Forbidden reference (${term.label}) found in ${path.relative(REPO_ROOT, file)}`,
      );
    }
  }
});

console.log(`\nALL ${passed} TESTS PASSED.`);
