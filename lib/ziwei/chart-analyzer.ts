/**
 * Deterministic Zi Wei Dou Shu chart analyzer (Zero-LLM, headless-safe).
 *
 * Provides:
 * - Canonical birth-matrix cache key generation (`getChartCacheKey`, `getBirthChartKeyParams`)
 * - Deterministic paywall pain-point extraction (`extractChartPainPoints`)
 * - Free Life/Body/SanFangSiZheng summary with empty-palace borrowing (`extractFreeMingSummary`)
 * - Compact (<3 KB) LLM prompt payload serialization (`buildChartPromptPayload`)
 */

import type {
  BirthInfo,
  Palace,
  SelfSihuaMark,
  SiHua,
  Star,
  StarBrightness,
  ZiweiChart,
} from './types';
import { BRANCHES, STEMS } from './constants';
import {
  DEFAULT_LEAP_MONTH,
  type BrightnessSchoolOption,
  type LeapMonth,
} from './school-config';
import {
  detectSelfSihua,
  getDaXianSiHua,
  getLiuNianSiHua,
  getYearBranchIndex,
} from './sihua';
import {
  CHILDHOOD_DAXIAN_INDEX,
  isChildhoodYear,
  resolveEffectiveDaXianIndex,
} from './yunxian-context';

// ────────────────── Constants ──────────────────

const LOCKED_PALACE_NAMES = new Set<string>([
  '财帛',
  '夫妻',
  '官禄',
  '疾厄',
  '田宅',
  '福德',
  '迁移',
]);

const CORE_LOCKED_PALACE_NAMES = new Set<string>([
  '财帛',
  '夫妻',
  '官禄',
  '疾厄',
]);

const SENSITIVE_PALACE_NAMES = new Set<string>([
  '命宫',
  ...LOCKED_PALACE_NAMES,
]);

const HEAVY_SHA_STARS = new Set<string>([
  '擎羊',
  '陀罗',
  '火星',
  '铃星',
  '地空',
  '地劫',
]);

const VOLATILE_MAJOR_STARS = new Set<string>([
  '七杀',
  '破军',
  '贪狼',
]);

const DIM_RAW_BRIGHTNESS = new Set<StarBrightness>(['陷', '不', '闲']);

const CORE_PROMPT_STARS = new Set<string>([
  '紫微', '天机', '太阳', '武曲', '天同', '廉贞', '天府',
  '太阴', '贪狼', '巨门', '天相', '天梁', '七杀', '破军',
  '左辅', '右弼', '文昌', '文曲', '天魁', '天钺', '禄存', '天马',
  '擎羊', '陀罗', '火星', '铃星', '地空', '地劫',
  '红鸾', '天喜', '天刑', '天姚', '孤辰', '寡宿', '咸池',
  '截空', '旬空', '天空', '大耗',
]);

const FAVORABLE_SIHUA_ORDER: readonly Exclude<SiHua, '忌'>[] = ['禄', '权', '科'];

const SEVERITY_RANK: Record<PainPointSeverity, number> = {
  high: 3,
  medium: 2,
  watch: 1,
};

const TARGET_PROMPT_PAYLOAD_BYTES = 2350;
const MAX_PROMPT_PAYLOAD_BYTES = 2880;

// ────────────────── Public Types ──────────────────

export interface ChartCacheKeyOptions {
  brightnessSchool?: BrightnessSchoolOption;
  leapMonthPolicy?: LeapMonth;
  targetYear?: number;
}

export interface BirthChartKeyParams {
  solarDate: string;
  hour: number;
  gender: 'male' | 'female';
  brightnessSchool: BrightnessSchoolOption;
  leapMonthPolicy: LeapMonth;
  targetYear?: number;
}

export type PainPointCategory =
  | 'natal_huaji'
  | 'self_huaji'
  | 'daxian_huaji'
  | 'liunian_huaji'
  | 'double_huaji'
  | 'sha_cluster';

export type PainPointSeverity = 'high' | 'medium' | 'watch';

export interface ChartPainPoint {
  id: string;
  palaceName: string;
  palaceBranch: number;
  palaceBranchName: string;
  category: PainPointCategory;
  severity: PainPointSeverity;
  priorityScore: number;
  isLockedPalace: boolean;
  stars: string[];
  siHua: string[];
  facts: string[];
}

export interface ExtractPainPointsOptions {
  targetYear?: number;
  maxPoints?: number;
}

export interface FreeStarSummary {
  name: string;
  type: Star['type'];
  brightness?: Star['brightness'];
  brightnessRaw?: StarBrightness;
  siHua?: SiHua;
  borrowed: boolean;
}

export interface FavorableSiHuaHighlight {
  siHua: Exclude<SiHua, '忌'>;
  starName: string;
  starType: Star['type'];
  palaceName: string;
  palaceBranch: number;
  palaceBranchName: string;
  inSanFang: boolean;
  inMingOrShen: boolean;
  brightness?: Star['brightness'];
  brightnessRaw?: StarBrightness;
}

export interface SanFangPalaceSummary {
  palaceName: string;
  branch: number;
  branchName: string;
  stem: number;
  stemName: string;
  isEmpty: boolean;
  majorStars: FreeStarSummary[];
  borrowedFromBranch?: number;
  borrowedFromName?: string;
  borrowedStars: string[];
  effectiveMajorStars: FreeStarSummary[];
  luckyStars: string[];
  shaStars: string[];
  favorableSiHua: Array<{ starName: string; siHua: Exclude<SiHua, '忌'> }>;
}

export interface FreeMingSummary {
  wuxingJu: number;
  wuxingJuName: string;
  mingZhu: string;
  shenZhu: string;
  yinYangGender: string;
  mingPalace: SanFangPalaceSummary;
  shenPalace: SanFangPalaceSummary & { isSameAsMing: boolean };
  sanFangSiZheng: SanFangPalaceSummary[];
  favorableSiHua: FavorableSiHuaHighlight[];
  sanFangFavorableSiHua: FavorableSiHuaHighlight[];
  hasSanQiJiaHui: boolean;
}

export interface ChartSummaryOptions {
  brightnessSchool?: BrightnessSchoolOption;
  leapMonthPolicy?: LeapMonth;
  targetYear?: number;
  maxPainPoints?: number;
}

export interface ChartAnalysisSummary {
  cacheKey: string;
  keyParams: BirthChartKeyParams;
  mingSummary: FreeMingSummary;
  painPoints: ChartPainPoint[];
}

export interface PatternSummary {
  name: string;
  level: 'excellent' | 'good' | 'neutral' | 'caution';
  palaces: readonly string[];
  description?: string;
  source?: string;
}

export interface BuildPromptPayloadOptions {
  targetYear?: number;
  patterns?: readonly PatternSummary[];
  maxPainPoints?: number;
  maxPatterns?: number;
}

export interface PromptPalaceEntry {
  name: string;
  branch: string;
  stem: string;
  borrowedFrom?: string;
  stars: string[];
  selfSihua?: string[];
}

export interface PromptCycleSiHua {
  stem: string;
  palace?: string;
  ageRange?: string;
  year?: number;
  branch?: string;
  hits: Record<SiHua, string>;
}

export interface PromptPainPointEntry {
  palace: string;
  category: PainPointCategory;
  severity: PainPointSeverity;
  stars: string[];
  siHua: string[];
  facts: string[];
}

export interface PromptPatternEntry {
  name: string;
  level: PatternSummary['level'];
  palaces: string[];
}

export interface ChartPromptPayload {
  gender: 'male' | 'female';
  yinYangGender: string;
  wuxingJuName: string;
  mingZhu: string;
  shenZhu: string;
  mingBranch: string;
  shenPalace: string;
  lunar: {
    year: number;
    month: number;
    day: number;
    isLeap: boolean;
    yearGZ: string;
  };
  fourPillars?: [string, string, string, string];
  fourPillarsLunar?: [string, string, string, string];
  palaces: PromptPalaceEntry[];
  daXian?: PromptCycleSiHua;
  liuNian?: PromptCycleSiHua;
  painPoints: PromptPainPointEntry[];
  patterns?: PromptPatternEntry[];
}

// ────────────────── Internal Helpers ──────────────────

type HuaJiLayer = 'natal' | 'daxian' | 'liunian';

interface HuaJiHit {
  layer: HuaJiLayer;
  starName: string;
  palace: Palace;
  star?: Star;
}

interface ActiveDaXianResolution {
  dxIndex: number;
  stemName: string;
  transforms: Record<SiHua, string>;
  palaceName?: string;
  ageRange?: string;
}

function normalizeBranch(branch: number): number {
  return ((Math.trunc(branch) % 12) + 12) % 12;
}

function branchNameOf(branch: number): string {
  return BRANCHES[normalizeBranch(branch)] ?? '';
}

function stemNameOf(stem: number): string {
  const idx = ((Math.trunc(stem) % 10) + 10) % 10;
  return STEMS[idx] ?? '';
}

function getPalaceByBranch(chart: ZiweiChart, branch: number): Palace | undefined {
  const target = normalizeBranch(branch);
  return chart.palaces.find((p) => normalizeBranch(p.branch) === target);
}

function getAdjacentPalaces(
  chart: ZiweiChart,
  branch: number,
): { prev?: Palace; next?: Palace } {
  return {
    prev: getPalaceByBranch(chart, branch - 1),
    next: getPalaceByBranch(chart, branch + 1),
  };
}

function hasStarNamed(palace: Palace | undefined, starName: string): boolean {
  return Boolean(palace?.stars.some((s) => s.name === starName));
}

function findStarPalace(chart: ZiweiChart, starName: string): Palace | undefined {
  if (!starName) return undefined;
  return chart.palaces.find((p) => p.stars.some((s) => s.name === starName));
}

function isStarDim(star: Star): boolean {
  if (star.brightness === 'dim') return true;
  return star.brightnessRaw !== undefined && DIM_RAW_BRIGHTNESS.has(star.brightnessRaw);
}

function resolvePalaceSelfSihua(palace: Palace): readonly SelfSihuaMark[] {
  if (palace.selfSihua !== undefined) {
    return palace.selfSihua;
  }
  return detectSelfSihua(palace);
}

function uniqueStrings(items: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function isLeapMonthPolicy(value: unknown): value is LeapMonth {
  return (
    value === 'split'
    || value === 'next-month'
    || value === 'prev-month'
    || value === 'origin-month'
  );
}

function readChartLeapMonthPolicy(chart: ZiweiChart): LeapMonth | undefined {
  const birthObj: unknown = chart.birthInfo;
  if (birthObj && typeof birthObj === 'object' && 'leapMonthPolicy' in birthObj) {
    const candidate = (birthObj as { leapMonthPolicy?: unknown }).leapMonthPolicy;
    if (isLeapMonthPolicy(candidate)) return candidate;
  }
  return undefined;
}

function normalizeBrightnessSchool(school?: BrightnessSchoolOption): BrightnessSchoolOption {
  if (!school || school === 'QS') return 'default';
  return school;
}

function validateTargetYear(targetYear: number): number {
  if (!Number.isInteger(targetYear)) {
    throw new RangeError(`targetYear must be an integer; received ${targetYear}`);
  }
  return targetYear;
}

function resolveActiveDaXian(
  chart: ZiweiChart,
  targetYear?: number,
): ActiveDaXianResolution | null {
  let effectiveDxIndex = -1;

  if (targetYear !== undefined) {
    const yearIndex = resolveEffectiveDaXianIndex(chart, 'liunian', targetYear);
    if (yearIndex >= 0) {
      effectiveDxIndex = yearIndex;
    } else if (isChildhoodYear(chart, targetYear)) {
      effectiveDxIndex = CHILDHOOD_DAXIAN_INDEX;
    }
  } else {
    const baseIndex = resolveEffectiveDaXianIndex(chart, 'mingpan', 0);
    if (baseIndex >= 0) {
      effectiveDxIndex = baseIndex;
    } else {
      const firstStartAge = chart.daXians[0]?.startAge;
      if (
        Number.isFinite(chart.currentAge)
        && chart.currentAge >= 1
        && firstStartAge !== undefined
        && chart.currentAge < firstStartAge
      ) {
        effectiveDxIndex = CHILDHOOD_DAXIAN_INDEX;
      }
    }
  }

  if (effectiveDxIndex === -1) return null;

  const siHuaInfo = getDaXianSiHua(chart, effectiveDxIndex, targetYear);
  if (!siHuaInfo) return null;

  if (effectiveDxIndex === CHILDHOOD_DAXIAN_INDEX) {
    const firstStartAge = chart.daXians[0]?.startAge;
    const endAge = firstStartAge !== undefined && firstStartAge > 1 ? firstStartAge - 1 : 1;
    const mingName = getPalaceByBranch(chart, chart.mingGongBranch)?.name ?? '命宫';
    return {
      dxIndex: effectiveDxIndex,
      stemName: siHuaInfo.stemName,
      transforms: siHuaInfo.transforms,
      palaceName: mingName,
      ageRange: `1-${endAge}`,
    };
  }

  const dx = chart.daXians[effectiveDxIndex];
  return {
    dxIndex: effectiveDxIndex,
    stemName: siHuaInfo.stemName,
    transforms: siHuaInfo.transforms,
    palaceName: dx?.palaceName,
    ageRange: dx ? `${dx.startAge}-${dx.endAge}` : undefined,
  };
}

function hasYangTuoClamp(chart: ZiweiChart, branch: number): boolean {
  const { prev, next } = getAdjacentPalaces(chart, branch);
  if (!prev || !next) return false;
  return (
    (hasStarNamed(prev, '擎羊') && hasStarNamed(next, '陀罗'))
    || (hasStarNamed(prev, '陀罗') && hasStarNamed(next, '擎羊'))
  );
}

function classifyPalaceWeight(palaceName: string): {
  baseJiScore: number;
  isCoreLocked: boolean;
  isSensitive: boolean;
} {
  const isCoreLocked = CORE_LOCKED_PALACE_NAMES.has(palaceName);
  const isSensitive = SENSITIVE_PALACE_NAMES.has(palaceName);
  if (isCoreLocked || palaceName === '命宫') {
    return { baseJiScore: 76, isCoreLocked, isSensitive };
  }
  if (LOCKED_PALACE_NAMES.has(palaceName)) {
    return { baseJiScore: 64, isCoreLocked, isSensitive };
  }
  return { baseJiScore: 46, isCoreLocked, isSensitive };
}

function severityFromScore(score: number): PainPointSeverity {
  if (score >= 80) return 'high';
  if (score >= 58) return 'medium';
  return 'watch';
}

function layerFactTag(layer: HuaJiLayer): string {
  return `layer:${layer}`;
}

function layerSiHuaTag(layer: HuaJiLayer): string {
  return `${layer}:忌`;
}

function buildPalaceRoleFacts(palace: Palace, oppName: string | undefined): string[] {
  const facts: string[] = [];
  if (LOCKED_PALACE_NAMES.has(palace.name)) facts.push('locked_palace');
  else if (palace.name === '命宫') facts.push('life_palace');
  if (oppName) facts.push(`opposes_palace:${oppName}`);
  return facts;
}

function resolvePalaceMajorStars(
  chart: ZiweiChart,
  palace: Palace,
): {
  isEmpty: boolean;
  directMajors: Star[];
  borrowedFromBranch?: number;
  borrowedFromName?: string;
  borrowedStars: string[];
  effectiveMajors: FreeStarSummary[];
} {
  const directMajors = palace.stars.filter((s) => s.type === 'major');
  const isEmpty = palace.isEmpty ?? directMajors.length === 0;
  const toFreeSummary = (s: Star, borrowed: boolean): FreeStarSummary => ({
    name: s.name,
    type: s.type,
    brightness: s.brightness,
    brightnessRaw: s.brightnessRaw,
    siHua: s.siHua,
    borrowed,
  });

  if (!isEmpty) {
    return {
      isEmpty: false,
      directMajors,
      borrowedStars: [],
      effectiveMajors: directMajors.map((s) => toFreeSummary(s, false)),
    };
  }

  const oppBranch = palace.borrowedFromBranch ?? palace.oppositeBranch ?? normalizeBranch(palace.branch + 6);
  const oppPalace = getPalaceByBranch(chart, oppBranch);
  const oppMajors = oppPalace ? oppPalace.stars.filter((s) => s.type === 'major') : [];
  const borrowedFromName = palace.borrowedFromName ?? oppPalace?.name;
  const borrowedStars = palace.borrowedStars && palace.borrowedStars.length > 0
    ? [...palace.borrowedStars]
    : oppMajors.map((s) => s.name);

  let effectiveMajors: FreeStarSummary[] = [];
  if (oppMajors.length > 0) {
    effectiveMajors = oppMajors.map((s) => toFreeSummary(s, true));
  } else if (borrowedStars.length > 0) {
    effectiveMajors = borrowedStars.map((name) => ({
      name,
      type: 'major',
      borrowed: true,
    }));
  }

  return {
    isEmpty: true,
    directMajors,
    borrowedFromBranch: oppPalace?.branch ?? oppBranch,
    borrowedFromName,
    borrowedStars,
    effectiveMajors,
  };
}

function summarizePalace(chart: ZiweiChart, palace: Palace): SanFangPalaceSummary {
  const resolved = resolvePalaceMajorStars(chart, palace);
  const favorableSiHua: Array<{ starName: string; siHua: Exclude<SiHua, '忌'> }> = [];
  for (const star of palace.stars) {
    if (star.siHua === '禄' || star.siHua === '权' || star.siHua === '科') {
      favorableSiHua.push({ starName: star.name, siHua: star.siHua });
    }
  }

  return {
    palaceName: palace.name,
    branch: normalizeBranch(palace.branch),
    branchName: branchNameOf(palace.branch),
    stem: palace.stem,
    stemName: stemNameOf(palace.stem),
    isEmpty: resolved.isEmpty,
    majorStars: resolved.directMajors.map((s) => ({
      name: s.name,
      type: s.type,
      brightness: s.brightness,
      brightnessRaw: s.brightnessRaw,
      siHua: s.siHua,
      borrowed: false,
    })),
    ...(resolved.isEmpty
      ? {
          borrowedFromBranch: resolved.borrowedFromBranch,
          borrowedFromName: resolved.borrowedFromName,
        }
      : {}),
    borrowedStars: resolved.borrowedStars,
    effectiveMajorStars: resolved.effectiveMajors,
    luckyStars: palace.stars.filter((s) => s.type === 'lucky').map((s) => s.name),
    shaStars: palace.stars.filter((s) => s.type === 'sha').map((s) => s.name),
    favorableSiHua,
  };
}

function buildCycleHits(chart: ZiweiChart, transforms: Record<SiHua, string>): Record<SiHua, string> {
  const formatHit = (siHua: SiHua): string => {
    const starName = transforms[siHua];
    if (!starName) return '';
    const palace = findStarPalace(chart, starName);
    return palace ? `${starName}@${palace.name}` : starName;
  };
  return {
    禄: formatHit('禄'),
    权: formatHit('权'),
    科: formatHit('科'),
    忌: formatHit('忌'),
  };
}

function formatPromptStar(star: Star): string {
  const parts: string[] = [];
  if (star.brightnessRaw) parts.push(star.brightnessRaw);
  if (star.siHua) parts.push(star.brightnessRaw ? star.siHua : `化${star.siHua}`);
  return parts.length > 0 ? `${star.name}(${parts.join(',')})` : star.name;
}

function formatPromptPalaces(chart: ZiweiChart, coreStarsOnly = false): PromptPalaceEntry[] {
  return [...chart.palaces]
    .sort((a, b) => normalizeBranch(a.branch) - normalizeBranch(b.branch))
    .map((palace) => {
      const selfMarks = resolvePalaceSelfSihua(palace).map((m) => `${m.siHua}:${m.starName}`);
      const visibleStars = coreStarsOnly
        ? palace.stars.filter(
            (s) => s.type === 'major' || CORE_PROMPT_STARS.has(s.name) || Boolean(s.siHua),
          )
        : palace.stars;

      const entry: PromptPalaceEntry = {
        name: palace.name,
        branch: branchNameOf(palace.branch),
        stem: stemNameOf(palace.stem),
        stars: visibleStars.map(formatPromptStar),
      };
      const isEmptyPalace = palace.isEmpty ?? !palace.stars.some((s) => s.type === 'major');
      if (isEmptyPalace) {
        const opp = getPalaceByBranch(
          chart,
          palace.borrowedFromBranch ?? palace.oppositeBranch ?? palace.branch + 6,
        );
        const bf = palace.borrowedFromName ?? opp?.name;
        if (bf) entry.borrowedFrom = bf;
      }
      if (selfMarks.length > 0) {
        entry.selfSihua = selfMarks;
      }
      return entry;
    });
}

function utf8ByteLength(value: unknown): number {
  const json = JSON.stringify(value);
  return new TextEncoder().encode(json).byteLength;
}

// ────────────────── Public API ──────────────────

/**
 * Extract canonical natal birth-matrix parameters used for deterministic cache keying.
 * Ignores display metadata such as user name, location labels, and original unadjusted clock time.
 */
export function getBirthChartKeyParams(
  chart: ZiweiChart,
  options?: ChartCacheKeyOptions,
): BirthChartKeyParams {
  const { year, month, day, hour, gender } = chart.birthInfo;
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new RangeError(`invalid chart birth date: ${year}-${month}-${day}`);
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 11) {
    throw new RangeError(`birthInfo.hour must be an integer in 0..11; received ${hour}`);
  }

  const solarDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const brightnessSchool = normalizeBrightnessSchool(options?.brightnessSchool);
  const leapMonthPolicy =
    options?.leapMonthPolicy
    ?? readChartLeapMonthPolicy(chart)
    ?? DEFAULT_LEAP_MONTH;

  const params: BirthChartKeyParams = {
    solarDate,
    hour,
    gender,
    brightnessSchool,
    leapMonthPolicy,
  };

  if (options?.targetYear !== undefined) {
    params.targetYear = validateTargetYear(options.targetYear);
  }

  return params;
}

/**
 * Generate a canonical deterministic cache key for a ZiweiChart.
 */
export function getChartCacheKey(
  chart: ZiweiChart,
  options?: ChartCacheKeyOptions,
): string {
  const params = getBirthChartKeyParams(chart, options);
  const base = `ziwei:v1:${params.solarDate}:${params.hour}:${params.gender}:${params.brightnessSchool}:${params.leapMonthPolicy}`;
  return params.targetYear !== undefined ? `${base}:y${params.targetYear}` : base;
}

/**
 * Zero-LLM deterministic scan for high-signal risk and trigger zones across Natal,
 * Self-Transformation, DaXian, and optional Annual (LiuNian) layers.
 */
export function extractChartPainPoints(
  chart: ZiweiChart,
  options: ExtractPainPointsOptions = {},
): ChartPainPoint[] {
  const targetYear = options.targetYear !== undefined
    ? validateTargetYear(options.targetYear)
    : undefined;

  const items: ChartPainPoint[] = [];
  const jiHitsByBranch = new Map<number, HuaJiHit[]>();

  const recordJiHit = (hit: HuaJiHit): void => {
    const b = normalizeBranch(hit.palace.branch);
    const list = jiHitsByBranch.get(b) ?? [];
    list.push(hit);
    jiHitsByBranch.set(b, list);
  };

  // 1) Natal HuaJi
  for (const palace of chart.palaces) {
    for (const star of palace.stars) {
      if (star.siHua === '忌') {
        recordJiHit({ layer: 'natal', starName: star.name, palace, star });
      }
    }
  }

  // 2) Active DaXian HuaJi
  const activeDx = resolveActiveDaXian(chart, targetYear);
  if (activeDx?.transforms['忌']) {
    const dxStarName = activeDx.transforms['忌'];
    const dxPalace = findStarPalace(chart, dxStarName);
    if (dxPalace) {
      recordJiHit({
        layer: 'daxian',
        starName: dxStarName,
        palace: dxPalace,
        star: dxPalace.stars.find((s) => s.name === dxStarName),
      });
    }
  }

  // 3) Annual LiuNian HuaJi (optional targetYear)
  const lnInfo = targetYear !== undefined ? getLiuNianSiHua(targetYear) : null;
  if (lnInfo?.transforms['忌']) {
    const lnStarName = lnInfo.transforms['忌'];
    const lnPalace = findStarPalace(chart, lnStarName);
    if (lnPalace) {
      recordJiHit({
        layer: 'liunian',
        starName: lnStarName,
        palace: lnPalace,
        star: lnPalace.stars.find((s) => s.name === lnStarName),
      });
    }
  }

  const selfJiByBranch = new Map<number, SelfSihuaMark[]>();
  for (const palace of chart.palaces) {
    const selfJi = resolvePalaceSelfSihua(palace).filter((m) => m.siHua === '忌');
    if (selfJi.length > 0) {
      selfJiByBranch.set(normalizeBranch(palace.branch), selfJi);
    }
  }

  const pushPalaceLayerPainPoint = (
    hit: HuaJiHit,
    category: 'natal_huaji' | 'daxian_huaji' | 'liunian_huaji',
    extraFacts: string[],
  ): void => {
    const palace = hit.palace;
    const branch = normalizeBranch(palace.branch);
    const opp = getPalaceByBranch(chart, branch + 6);
    const heavyShas = palace.stars.filter((s) => HEAVY_SHA_STARS.has(s.name)).map((s) => s.name);
    const yangTuoClamp = hasYangTuoClamp(chart, branch);
    const dim = hit.star ? isStarDim(hit.star) : false;
    const selfJiList = selfJiByBranch.get(branch) ?? [];
    const branchHits = jiHitsByBranch.get(branch) ?? [];
    const hasLayerOverlap = branchHits.length >= 2;
    const { baseJiScore, isSensitive } = classifyPalaceWeight(palace.name);

    let score = baseJiScore;
    if (category === 'liunian_huaji') score -= 4;
    if (category === 'daxian_huaji') score -= 8;
    if (dim) score += 12;
    if (heavyShas.length > 0) score += 10 + Math.min(2, heavyShas.length - 1) * 4;
    if (yangTuoClamp) score += 14;
    if (selfJiList.length > 0) score += 12;
    if (hasLayerOverlap) score += 12;

    const facts: string[] = [
      ...buildPalaceRoleFacts(palace, opp?.name),
      ...extraFacts,
    ];
    if (dim && hit.star) {
      facts.push(`star_dim:${hit.star.name}`);
      if (hit.star.brightnessRaw) facts.push(`star_brightness:${hit.star.brightnessRaw}`);
    }
    for (const sha of heavyShas) facts.push(`sha_present:${sha}`);
    if (yangTuoClamp) facts.push('clamped_by_yang_tuo');
    if (selfJiList.length > 0) {
      facts.push(category === 'natal_huaji' ? 'natal_plus_self_huaji' : 'triggers_self_huaji');
    }
    if (hasLayerOverlap) facts.push('same_palace_double_ji');
    if (!isSensitive && score >= 80) score = 79;

    const id = category === 'liunian_huaji' && targetYear !== undefined
      ? `${category}:${targetYear}:${palace.name}:${branch}`
      : `${category}:${palace.name}:${branch}`;

    items.push({
      id,
      palaceName: palace.name,
      palaceBranch: branch,
      palaceBranchName: branchNameOf(branch),
      category,
      severity: severityFromScore(score),
      priorityScore: score,
      isLockedPalace: LOCKED_PALACE_NAMES.has(palace.name),
      stars: uniqueStrings([hit.starName, ...heavyShas]),
      siHua: uniqueStrings([
        layerSiHuaTag(hit.layer),
        ...(selfJiList.length > 0 ? ['self:忌'] : []),
      ]),
      facts: uniqueStrings(facts),
    });
  };

  // Emit single-layer HuaJi points
  for (const hits of jiHitsByBranch.values()) {
    for (const hit of hits) {
      if (hit.layer === 'natal') {
        pushPalaceLayerPainPoint(hit, 'natal_huaji', ['natal_huaji']);
      } else if (hit.layer === 'daxian' && activeDx) {
        const dxFacts = ['daxian_huaji', `daxian_stem:${activeDx.stemName}`];
        if (activeDx.ageRange) dxFacts.push(`daxian_age:${activeDx.ageRange}`);
        pushPalaceLayerPainPoint(hit, 'daxian_huaji', dxFacts);
      } else if (hit.layer === 'liunian' && targetYear !== undefined && lnInfo) {
        pushPalaceLayerPainPoint(hit, 'liunian_huaji', [
          'liunian_huaji',
          `target_year:${targetYear}`,
          `liunian_stem:${lnInfo.stemName}`,
        ]);
      }
    }
  }

  // 4) Self-transformations (自化忌)
  for (const palace of chart.palaces) {
    const branch = normalizeBranch(palace.branch);
    const selfJi = selfJiByBranch.get(branch);
    if (!selfJi || selfJi.length === 0) continue;

    const opp = getPalaceByBranch(chart, branch + 6);
    const heavyShas = palace.stars.filter((s) => HEAVY_SHA_STARS.has(s.name)).map((s) => s.name);
    const branchHits = jiHitsByBranch.get(branch) ?? [];
    const hasNatalJi = branchHits.some((h) => h.layer === 'natal');
    const hasCycleJi = branchHits.some((h) => h.layer !== 'natal');
    const { isCoreLocked } = classifyPalaceWeight(palace.name);

    let score = isCoreLocked || palace.name === '命宫'
      ? 62
      : LOCKED_PALACE_NAMES.has(palace.name)
        ? 52
        : 36;
    const starNames: string[] = [];
    const facts: string[] = [
      ...buildPalaceRoleFacts(palace, opp?.name),
      'self_sihua_ji',
      `palace_stem:${stemNameOf(palace.stem)}`,
    ];

    for (const mark of selfJi) {
      starNames.push(mark.starName);
      const st = palace.stars.find((s) => s.name === mark.starName);
      if (st && isStarDim(st)) {
        score += 12;
        facts.push(`star_dim:${st.name}`);
      }
    }
    if (hasNatalJi) {
      score += 18;
      facts.push('natal_plus_self_huaji');
    }
    if (hasCycleJi) {
      score += 12;
      facts.push('cycle_triggers_self_huaji');
    }
    if (heavyShas.length > 0) score += 10;
    for (const sha of heavyShas) facts.push(`sha_present:${sha}`);

    items.push({
      id: `self_huaji:${palace.name}:${branch}`,
      palaceName: palace.name,
      palaceBranch: branch,
      palaceBranchName: branchNameOf(branch),
      category: 'self_huaji',
      severity: severityFromScore(score),
      priorityScore: score,
      isLockedPalace: LOCKED_PALACE_NAMES.has(palace.name),
      stars: uniqueStrings([...starNames, ...heavyShas]),
      siHua: uniqueStrings(['self:忌', ...branchHits.map((h) => layerSiHuaTag(h.layer))]),
      facts: uniqueStrings(facts),
    });
  }

  // 5) Double HuaJi: same palace stack, opposite clash (双忌冲), and adjacent clamp (双忌夹)
  for (const [branch, hits] of jiHitsByBranch.entries()) {
    if (hits.length < 2) continue;
    const palace = hits[0].palace;
    const opp = getPalaceByBranch(chart, branch + 6);
    const heavyShas = palace.stars.filter((s) => HEAVY_SHA_STARS.has(s.name)).map((s) => s.name);
    const isSensitive = SENSITIVE_PALACE_NAMES.has(palace.name);
    const score = 95
      + (isSensitive ? 10 : 0)
      + (hits.length >= 3 ? 8 : 0)
      + (heavyShas.length > 0 ? 5 : 0);

    const facts = [
      ...buildPalaceRoleFacts(palace, opp?.name),
      'same_palace_double_ji',
      'clashes_opposite',
      ...hits.map((h) => layerFactTag(h.layer)),
      ...(targetYear !== undefined && hits.some((h) => h.layer === 'liunian')
        ? [`target_year:${targetYear}`]
        : []),
      ...heavyShas.map((sha) => `sha_present:${sha}`),
    ];

    items.push({
      id: `double_huaji:stack:${palace.name}:${branch}`,
      palaceName: palace.name,
      palaceBranch: branch,
      palaceBranchName: branchNameOf(branch),
      category: 'double_huaji',
      severity: 'high',
      priorityScore: score,
      isLockedPalace: LOCKED_PALACE_NAMES.has(palace.name),
      stars: uniqueStrings([...hits.map((h) => h.starName), ...heavyShas]),
      siHua: uniqueStrings(hits.map((h) => layerSiHuaTag(h.layer))),
      facts: uniqueStrings(facts),
    });
  }

  // Opposite-palace double clash (双忌冲) across axis 0..5
  for (let branchA = 0; branchA < 6; branchA++) {
    const branchB = branchA + 6;
    const hitsA = jiHitsByBranch.get(branchA) ?? [];
    const hitsB = jiHitsByBranch.get(branchB) ?? [];
    if (hitsA.length === 0 || hitsB.length === 0) continue;

    const palaceA = hitsA[0].palace;
    const palaceB = hitsB[0].palace;
    const weightA = classifyPalaceWeight(palaceA.name).baseJiScore;
    const weightB = classifyPalaceWeight(palaceB.name).baseJiScore;
    const primary = weightB > weightA ? palaceB : palaceA;
    const secondary = primary === palaceA ? palaceB : palaceA;
    const combinedHits = [...hitsA, ...hitsB];
    const anySensitive = SENSITIVE_PALACE_NAMES.has(palaceA.name)
      || SENSITIVE_PALACE_NAMES.has(palaceB.name);
    const primaryBranch = normalizeBranch(primary.branch);
    const score = 88
      + (anySensitive ? 8 : 0)
      + (combinedHits.some((h) => h.layer === 'liunian') ? 4 : 0);

    const facts = [
      ...buildPalaceRoleFacts(primary, secondary.name),
      'opposite_palace_double_ji',
      'opposite_clash',
      `axis_palaces:${primary.name}<->${secondary.name}`,
      ...combinedHits.map((h) => layerFactTag(h.layer)),
      ...(targetYear !== undefined && combinedHits.some((h) => h.layer === 'liunian')
        ? [`target_year:${targetYear}`]
        : []),
    ];

    items.push({
      id: `double_huaji:clash:${primary.name}:${primaryBranch}`,
      palaceName: primary.name,
      palaceBranch: primaryBranch,
      palaceBranchName: branchNameOf(primaryBranch),
      category: 'double_huaji',
      severity: anySensitive ? 'high' : 'medium',
      priorityScore: score,
      isLockedPalace: LOCKED_PALACE_NAMES.has(primary.name),
      stars: uniqueStrings(combinedHits.map((h) => h.starName)),
      siHua: uniqueStrings(combinedHits.map((h) => layerSiHuaTag(h.layer))),
      facts: uniqueStrings(facts),
    });
  }

  // Adjacent-palace HuaJi clamp (双忌夹) around sensitive palaces
  for (const palace of chart.palaces) {
    if (!SENSITIVE_PALACE_NAMES.has(palace.name)) continue;
    const branch = normalizeBranch(palace.branch);
    const { prev, next } = getAdjacentPalaces(chart, branch);
    if (!prev || !next) continue;

    const prevHits = jiHitsByBranch.get(normalizeBranch(prev.branch)) ?? [];
    const nextHits = jiHitsByBranch.get(normalizeBranch(next.branch)) ?? [];
    if (prevHits.length === 0 || nextHits.length === 0) continue;

    const opp = getPalaceByBranch(chart, branch + 6);
    const combinedHits = [...prevHits, ...nextHits];
    const score = 90 + (CORE_LOCKED_PALACE_NAMES.has(palace.name) || palace.name === '命宫' ? 6 : 0);
    const facts = [
      ...buildPalaceRoleFacts(palace, opp?.name),
      'clamped_by_huaji',
      `flanking_palaces:${prev.name}+${next.name}`,
      ...combinedHits.map((h) => layerFactTag(h.layer)),
      ...(targetYear !== undefined && combinedHits.some((h) => h.layer === 'liunian')
        ? [`target_year:${targetYear}`]
        : []),
    ];

    items.push({
      id: `double_huaji:clamp:${palace.name}:${branch}`,
      palaceName: palace.name,
      palaceBranch: branch,
      palaceBranchName: branchNameOf(branch),
      category: 'double_huaji',
      severity: 'high',
      priorityScore: score,
      isLockedPalace: LOCKED_PALACE_NAMES.has(palace.name),
      stars: uniqueStrings(combinedHits.map((h) => h.starName)),
      siHua: uniqueStrings(combinedHits.map((h) => layerSiHuaTag(h.layer))),
      facts: uniqueStrings(facts),
    });
  }

  // 6) Heavy Sha clustering with dim major stars or 七杀/破军/贪狼
  for (const palace of chart.palaces) {
    if (!SENSITIVE_PALACE_NAMES.has(palace.name)) continue;
    const heavyShas = palace.stars.filter((s) => HEAVY_SHA_STARS.has(s.name));
    if (heavyShas.length === 0) continue;

    const branch = normalizeBranch(palace.branch);
    const opp = getPalaceByBranch(chart, branch + 6);
    const directMajors = palace.stars.filter((s) => s.type === 'major');
    const isEmptyPalace = palace.isEmpty ?? directMajors.length === 0;
    const evalMajors = directMajors.length > 0
      ? directMajors
      : (opp ? opp.stars.filter((s) => s.type === 'major') : []);

    const dimMajors = evalMajors.filter(isStarDim);
    const volatileMajors = evalMajors.filter((s) => VOLATILE_MAJOR_STARS.has(s.name));
    const isCoreLocked = CORE_LOCKED_PALACE_NAMES.has(palace.name);

    const qualifies = isCoreLocked
      ? heavyShas.length >= 2 || dimMajors.length >= 1 || volatileMajors.length >= 1
      : heavyShas.length >= 2 && (dimMajors.length >= 1 || volatileMajors.length >= 1 || heavyShas.length >= 3);

    if (!qualifies) continue;

    const shaNames = heavyShas.map((s) => s.name);
    const dimNames = dimMajors.map((s) => s.name);
    const volatileNames = volatileMajors.map((s) => s.name);

    const score = 28
      + heavyShas.length * 11
      + dimMajors.length * 10
      + volatileMajors.length * 8
      + (isCoreLocked ? 10 : 0)
      + (heavyShas.length >= 2 && (dimMajors.length >= 1 || volatileMajors.length >= 1)
        ? (isCoreLocked ? 12 : 6)
        : 0)
      + (heavyShas.length >= 3 && isCoreLocked ? 10 : 0)
      - (isEmptyPalace && evalMajors.length > 0 ? 4 : 0);

    const severity = severityFromScore(score);

    const facts: string[] = [
      ...buildPalaceRoleFacts(palace, opp?.name),
      `sha_count:${heavyShas.length}`,
      ...shaNames.map((n) => `sha_present:${n}`),
      ...dimNames.map((n) => `star_dim:${n}`),
      ...volatileNames.map((n) => `volatile_star:${n}`),
    ];
    if (isEmptyPalace && evalMajors.length > 0) {
      facts.push('empty_palace_borrowed');
    }

    const palaceSiHua = palace.stars
      .filter((s): s is Star & { siHua: SiHua } => s.siHua !== undefined)
      .map((s) => `natal:${s.siHua}`);

    items.push({
      id: `sha_cluster:${palace.name}:${branch}`,
      palaceName: palace.name,
      palaceBranch: branch,
      palaceBranchName: branchNameOf(branch),
      category: 'sha_cluster',
      severity,
      priorityScore: score,
      isLockedPalace: LOCKED_PALACE_NAMES.has(palace.name),
      stars: uniqueStrings([...dimNames, ...volatileNames, ...shaNames]),
      siHua: uniqueStrings(palaceSiHua),
      facts: uniqueStrings(facts),
    });
  }

  // Deterministic descending priority sort
  items.sort((a, b) => {
    const sevDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (sevDiff !== 0) return sevDiff;
    const scoreDiff = b.priorityScore - a.priorityScore;
    if (scoreDiff !== 0) return scoreDiff;
    const branchDiff = a.palaceBranch - b.palaceBranch;
    if (branchDiff !== 0) return branchDiff;
    return a.id.localeCompare(b.id);
  });

  if (options.maxPoints !== undefined) {
    const limit = Math.max(0, Math.trunc(options.maxPoints));
    return items.slice(0, limit);
  }
  return items;
}

/**
 * Extract the free Life Palace (`命宫`), Body Palace (`身宫`),
 * SanFangSiZheng (`三方四正`: 命/财/官/迁 with empty-palace borrowing),
 * and favorable `化禄`/`化权`/`化科` highlights.
 */
export function extractFreeMingSummary(chart: ZiweiChart): FreeMingSummary {
  const mingBranch = normalizeBranch(chart.mingGongBranch);
  const shenBranch = normalizeBranch(chart.shenGongBranch);

  const mingRaw =
    getPalaceByBranch(chart, mingBranch)
    ?? chart.palaces.find((p) => p.isMingGong || p.name === '命宫')
    ?? chart.palaces[0];
  const shenRaw =
    getPalaceByBranch(chart, shenBranch)
    ?? chart.palaces.find((p) => p.isShenGong)
    ?? mingRaw;

  const mingPalace = summarizePalace(chart, mingRaw);
  const shenSummary = summarizePalace(chart, shenRaw);

  // 三方四正 order: 命宫 (m), 财帛 (m+8), 官禄 (m+4), 迁移 (m+6)
  const sanFangBranches = [
    mingBranch,
    normalizeBranch(mingBranch + 8),
    normalizeBranch(mingBranch + 4),
    normalizeBranch(mingBranch + 6),
  ];
  const sanFangBranchSet = new Set<number>(sanFangBranches);
  const sanFangSiZheng = sanFangBranches
    .map((b) => getPalaceByBranch(chart, b))
    .filter((p): p is Palace => p !== undefined)
    .map((p) => summarizePalace(chart, p));

  const favorableSiHua: FavorableSiHuaHighlight[] = [];
  for (const palace of chart.palaces) {
    const b = normalizeBranch(palace.branch);
    for (const star of palace.stars) {
      if (star.siHua !== '禄' && star.siHua !== '权' && star.siHua !== '科') continue;
      favorableSiHua.push({
        siHua: star.siHua,
        starName: star.name,
        starType: star.type,
        palaceName: palace.name,
        palaceBranch: b,
        palaceBranchName: branchNameOf(b),
        inSanFang: sanFangBranchSet.has(b),
        inMingOrShen: b === mingBranch || b === shenBranch,
        brightness: star.brightness,
        brightnessRaw: star.brightnessRaw,
      });
    }
  }

  favorableSiHua.sort((a, b) => {
    const orderDiff =
      FAVORABLE_SIHUA_ORDER.indexOf(a.siHua) - FAVORABLE_SIHUA_ORDER.indexOf(b.siHua);
    if (orderDiff !== 0) return orderDiff;
    if (a.inSanFang !== b.inSanFang) return a.inSanFang ? -1 : 1;
    return a.palaceBranch - b.palaceBranch;
  });

  const sanFangFavorableSiHua = favorableSiHua.filter((item) => item.inSanFang);
  const sanFangTypes = new Set(sanFangFavorableSiHua.map((item) => item.siHua));
  const hasSanQiJiaHui = sanFangTypes.has('禄') && sanFangTypes.has('权') && sanFangTypes.has('科');

  return {
    wuxingJu: chart.wuxingJu,
    wuxingJuName: chart.wuxingJuName,
    mingZhu: chart.mingZhu ?? '',
    shenZhu: chart.shenZhu ?? '',
    yinYangGender: chart.yinYangGender ?? '',
    mingPalace,
    shenPalace: {
      ...shenSummary,
      isSameAsMing: normalizeBranch(shenSummary.branch) === mingBranch,
    },
    sanFangSiZheng,
    favorableSiHua,
    sanFangFavorableSiHua,
    hasSanQiJiaHui,
  };
}

/**
 * Combined zero-LLM chart summary composing cache key, free Ming/SanFang summary, and pain points.
 */
export function analyzeChartSummary(
  chart: ZiweiChart,
  options: ChartSummaryOptions = {},
): ChartAnalysisSummary {
  const keyParams = getBirthChartKeyParams(chart, {
    brightnessSchool: options.brightnessSchool,
    leapMonthPolicy: options.leapMonthPolicy,
    targetYear: options.targetYear,
  });
  return {
    cacheKey: getChartCacheKey(chart, {
      brightnessSchool: options.brightnessSchool,
      leapMonthPolicy: options.leapMonthPolicy,
      targetYear: options.targetYear,
    }),
    keyParams,
    mingSummary: extractFreeMingSummary(chart),
    painPoints: extractChartPainPoints(chart, {
      targetYear: options.targetYear,
      maxPoints: options.maxPainPoints,
    }),
  };
}

/**
 * Build a compact (<3 KB UTF-8) structured JSON payload for LLM consumption,
 * stripping UI coordinates, PII/input metadata, and long prose pattern descriptions.
 */
export function buildChartPromptPayload(
  chart: ZiweiChart,
  options: BuildPromptPayloadOptions = {},
): ChartPromptPayload {
  const targetYear = options.targetYear !== undefined
    ? validateTargetYear(options.targetYear)
    : undefined;
  const maxPainPoints = options.maxPainPoints !== undefined
    ? Math.max(0, Math.trunc(options.maxPainPoints))
    : 4;
  const maxPatterns = options.maxPatterns !== undefined
    ? Math.max(0, Math.trunc(options.maxPatterns))
    : 6;

  const shenPalace = getPalaceByBranch(chart, chart.shenGongBranch);
  const activeDx = resolveActiveDaXian(chart, targetYear);
  const allPainPoints = extractChartPainPoints(chart, {
    targetYear,
    maxPoints: maxPainPoints,
  });

  const toPromptPain = (p: ChartPainPoint): PromptPainPointEntry => ({
    palace: p.palaceName,
    category: p.category,
    severity: p.severity,
    stars: p.stars,
    siHua: p.siHua,
    facts: p.facts,
  });

  const toPromptPatterns = (
    list: readonly PatternSummary[] | undefined,
    limit: number,
  ): PromptPatternEntry[] | undefined => {
    if (!list || list.length === 0 || limit <= 0) return undefined;
    return list.slice(0, limit).map((pat) => ({
      name: pat.name,
      level: pat.level,
      palaces: [...pat.palaces],
    }));
  };

  let liuNian: PromptCycleSiHua | undefined;
  if (targetYear !== undefined) {
    const ln = getLiuNianSiHua(targetYear);
    const lnBranch = getYearBranchIndex(targetYear);
    liuNian = {
      year: targetYear,
      stem: ln.stemName,
      branch: branchNameOf(lnBranch),
      hits: buildCycleHits(chart, ln.transforms),
    };
  }

  let daXian: PromptCycleSiHua | undefined;
  if (activeDx) {
    daXian = {
      stem: activeDx.stemName,
      palace: activeDx.palaceName,
      ageRange: activeDx.ageRange,
      hits: buildCycleHits(chart, activeDx.transforms),
    };
  }

  const payload: ChartPromptPayload = {
    gender: chart.birthInfo.gender,
    yinYangGender: chart.yinYangGender ?? '',
    wuxingJuName: chart.wuxingJuName,
    mingZhu: chart.mingZhu ?? '',
    shenZhu: chart.shenZhu ?? '',
    mingBranch: branchNameOf(chart.mingGongBranch),
    shenPalace: `${shenPalace?.name ?? ''}@${branchNameOf(chart.shenGongBranch)}`,
    lunar: {
      year: chart.lunarInfo.lunarYear,
      month: chart.lunarInfo.lunarMonth,
      day: chart.lunarInfo.lunarDay,
      isLeap: chart.lunarInfo.isLeapMonth,
      yearGZ: `${stemNameOf(chart.lunarInfo.yearStem)}${branchNameOf(chart.lunarInfo.yearBranch)}`,
    },
    ...(chart.lunarInfo.fourPillars ? { fourPillars: chart.lunarInfo.fourPillars } : {}),
    ...(chart.lunarInfo.fourPillarsLunar
      ? { fourPillarsLunar: chart.lunarInfo.fourPillarsLunar }
      : {}),
    palaces: formatPromptPalaces(chart, false),
    ...(daXian ? { daXian } : {}),
    ...(liuNian ? { liuNian } : {}),
    painPoints: allPainPoints.map(toPromptPain),
  };

  const condensedPatterns = toPromptPatterns(options.patterns, maxPatterns);
  if (condensedPatterns) {
    payload.patterns = condensedPatterns;
  }

  // Enforce compact < 3 KB payload budget (targeting <= 2.4 KB) even on dense charts/patterns.
  if (utf8ByteLength(payload) > TARGET_PROMPT_PAYLOAD_BYTES) {
    payload.palaces = formatPromptPalaces(chart, true);
  }
  if (
    utf8ByteLength(payload) > TARGET_PROMPT_PAYLOAD_BYTES
    && payload.fourPillars
    && payload.fourPillarsLunar
    && JSON.stringify(payload.fourPillars) === JSON.stringify(payload.fourPillarsLunar)
  ) {
    delete payload.fourPillarsLunar;
  }
  if (utf8ByteLength(payload) > TARGET_PROMPT_PAYLOAD_BYTES) {
    for (const pp of payload.painPoints) {
      pp.facts = pp.facts.slice(0, 3);
    }
  }
  while (utf8ByteLength(payload) >= MAX_PROMPT_PAYLOAD_BYTES && payload.painPoints.length > 2) {
    payload.painPoints.pop();
  }
  while (utf8ByteLength(payload) >= MAX_PROMPT_PAYLOAD_BYTES && payload.patterns && payload.patterns.length > 2) {
    payload.patterns.pop();
  }
  if (utf8ByteLength(payload) >= MAX_PROMPT_PAYLOAD_BYTES) {
    for (const pp of payload.painPoints) {
      pp.facts = pp.facts.slice(0, 1);
    }
  }

  return payload;
}
