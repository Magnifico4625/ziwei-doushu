/**
 * Zi Wei Dou Shu Synastry Engine (Zero-LLM, deterministic)
 *
 * Computes cross-chart Flying SiHua, Life/Spouse/Spirit palace mutual resonance,
 * earthly branch relationships, optional annual overlay, compatibility scoring
 * aligned with HEMING_SCORE_CRITERIA, structured highlights/friction triggers,
 * and compact LLM prompt payloads.
 */

import type { Palace, SiHua, Star, StarBrightness, ZiweiChart } from './types';
import { BRANCHES, STEMS } from './constants';
import {
  HEMING_SCORE_CRITERIA,
  MARRIAGE_STARS_BRIEF,
  SIHUA_IN_FUQI_GU,
  STAR_IN_FUQI_GU,
} from './heming-knowledge';
import {
  detectSelfSihua,
  getDaXianSiHua,
  getLiuNianSiHua,
  getSiHuaByStem,
  getYearBranchIndex,
  type SelfSihua,
} from './sihua';
import {
  CHILDHOOD_DAXIAN_INDEX,
  getDaXianIndexForYear,
  isChildhoodYear,
} from './yunxian-context';

// ─── Public Types ────────────────────────────────────────────────────────────

export type CrossSiHuaSource = 'yearStem' | 'mingStem' | 'fuqiStem';

export interface SynastryOptions {
  /** Optional target calendar/lunar year for annual overlay (`流年`). */
  targetYear?: number;
  /**
   * Optional flying SiHua stem sources to evaluate alongside `yearStem`.
   * Birth year stem (`lunarInfo.yearStem`) is always evaluated as primary.
   */
  crossStemSources?: readonly CrossSiHuaSource[];
}

export type FiveElement = '木' | '火' | '土' | '金' | '水';
export type ElementRelation = 'generating' | 'same' | 'controlling';
export type BranchRelationType = 'same' | 'liuhe' | 'sanhe' | 'liuchong' | 'neutral';
export type SynastryLevel = keyof typeof HEMING_SCORE_CRITERIA;
export type BondType =
  | 'mutual_blessing'
  | 'lu_ke_driven'
  | 'quan_driven'
  | 'mixed_karmic'
  | 'mutual_ji_entanglement';
export type FindingPolarity = 'positive' | 'mixed' | 'negative';
export type FrictionSeverity = 'high' | 'medium' | 'watch';
export type SynastryFindingScope = 'natal' | 'cross' | 'branch' | 'daxian' | 'annual';
export type SynastryFindingCategory =
  | 'mutual_resonance'
  | 'cross_sihua'
  | 'spouse_palace'
  | 'fude_palace'
  | 'branch_relation'
  | 'sun_moon'
  | 'marriage_star'
  | 'annual_overlay';
export type FindingDirection = 'mutual' | 'A_to_B' | 'B_to_A' | 'A' | 'B';

export interface PalaceStarLookup {
  palace: Palace;
  star: Star;
}

export interface NatalSiHuaMark {
  starName: string;
  siHua: SiHua;
}

export interface PersonPalaceBrief {
  palaceName: string;
  branch: number;
  branchName: string;
  stem: number;
  stemName: string;
  isEmpty: boolean;
  majorStars: string[];
  borrowedFromName?: string;
  borrowedFromBranch?: number;
  borrowedStars: string[];
  /** Direct major stars when occupied; borrowed opposite-palace major stars when empty. */
  effectiveMajorStars: string[];
  luckyStars: string[];
  shaStars: string[];
  natalSiHua: NatalSiHuaMark[];
  selfSiHua: SelfSihua[];
}

export interface SunMoonCheck {
  focusStar: '太阳' | '太阴';
  palaceName: string;
  branch: number;
  branchName: string;
  brightness?: 'bright' | 'normal' | 'dim';
  brightnessRaw?: StarBrightness;
  siHua?: SiHua;
  status: 'favorable' | 'neutral' | 'risk';
}

export interface PersonSynastrySummary {
  label: 'A' | 'B';
  chartKey: string;
  gender: 'male' | 'female';
  yinYangGender: string;
  yearStem: number;
  yearStemName: string;
  yearBranch: number;
  yearBranchName: string;
  wuxingJu: number;
  wuxingJuName: string;
  wuxingElement: FiveElement;
  mingZhu: string;
  shenZhu: string;
  mingGong: PersonPalaceBrief;
  fuqiGong: PersonPalaceBrief;
  fudeGong: PersonPalaceBrief;
  shenGongBranch: number;
  shenGongBranchName: string;
  shenGongPalaceName: string;
  currentAge: number;
  currentDaXianIndex: number;
  currentDaXianPalaceName?: string;
  currentDaXianBranch?: number;
  sunMoonCheck: SunMoonCheck | null;
}

export interface CrossSiHuaHit {
  from: 'A' | 'B';
  to: 'A' | 'B';
  stemSource: CrossSiHuaSource;
  stemIndex: number;
  stemName: string;
  siHua: SiHua;
  siHuaLabel: keyof typeof SIHUA_IN_FUQI_GU;
  starName: string;
  palaceName: string;
  branch: number;
  branchName: string;
  starBrightness?: 'bright' | 'normal' | 'dim';
  starBrightnessRaw?: StarBrightness;
  targetNatalSiHua?: SiHua;
  oppositePalaceName?: string;
  clashesPalaceName?: string;
  isKeyRelationalHit: boolean;
  polarity: FindingPolarity;
  relationTag: string;
}

export interface CrossSiHuaDirection {
  stemSource: CrossSiHuaSource;
  stemIndex: number;
  stemName: string;
  transforms: Record<SiHua, string>;
  hits: CrossSiHuaHit[];
  keyHits: CrossSiHuaHit[];
}

export interface CrossSiHuaAnalysis {
  aToB: CrossSiHuaDirection;
  bToA: CrossSiHuaDirection;
  additionalDirections: {
    aToB: Partial<Record<Exclude<CrossSiHuaSource, 'yearStem'>, CrossSiHuaDirection>>;
    bToA: Partial<Record<Exclude<CrossSiHuaSource, 'yearStem'>, CrossSiHuaDirection>>;
  };
  bondType: BondType;
  hasMutualHuaJi: boolean;
  summaryTags: string[];
}

export interface FuqiStarAssessment {
  starName: string;
  isBorrowed: boolean;
  brightness?: 'bright' | 'normal' | 'dim';
  brightnessRaw?: StarBrightness;
  siHua?: SiHua;
  knowledge: (typeof STAR_IN_FUQI_GU)[string];
}

export interface FuqiSiHuaAssessment {
  siHua: SiHua;
  siHuaLabel: keyof typeof SIHUA_IN_FUQI_GU;
  starName: string;
  source: 'direct' | 'borrowed' | 'opposite_clash' | 'self_sihua';
  knowledge: string;
}

export interface MarriageAuxStarNote {
  starName: string;
  palaceName: string;
  category: 'romance' | 'loneliness' | 'late_marriage';
  brief: string;
}

export interface PartnerSpouseAssessment {
  label: 'A' | 'B';
  palaceBranch: number;
  branchName: string;
  isEmpty: boolean;
  borrowedFromName?: string;
  borrowedStars: string[];
  effectiveMajorStars: string[];
  starAssessments: FuqiStarAssessment[];
  siHuaAssessments: FuqiSiHuaAssessment[];
  marriageAuxStars: MarriageAuxStarNote[];
  luckyStarsInFuqi: string[];
  shaStarsInFuqi: string[];
  shaStarsInFude: string[];
  hasSanXiongCombo: boolean;
  hasWuQuShaPoRisk: boolean;
  fuqiStabilityScore: number;
  fudeScore: number;
}

export interface BranchRelationDetail {
  pairLabel: string;
  branchA: number;
  branchB: number;
  branchNameA: string;
  branchNameB: string;
  diff: number;
  relation: BranchRelationType;
  isSixHarm: boolean;
}

export interface ClassicStarPairingMatch {
  code: string;
  starsRating: 1 | 2 | 3 | 4 | 5;
  polarity: FindingPolarity;
  starsA: string[];
  starsB: string[];
}

export interface PalaceResonanceAnalysis {
  aFuqiMatchesBMing: string[];
  bFuqiMatchesAMing: string[];
  aFuqiInBMingSanFang: string[];
  bFuqiInAMingSanFang: string[];
  tianZuoZhiHe: 'mutual' | 'single' | 'sanfang' | 'none';
  branchRelations: {
    mingVsMing: BranchRelationDetail;
    fuqiVsFuqi: BranchRelationDetail;
    aMingVsBFuqi: BranchRelationDetail;
    bMingVsAFuqi: BranchRelationDetail;
    fudeVsFude: BranchRelationDetail;
  };
  elementRelation: ElementRelation;
  classicStarPairings: ClassicStarPairingMatch[];
  assessmentA: PartnerSpouseAssessment;
  assessmentB: PartnerSpouseAssessment;
}

export interface AnnualSiHuaHit {
  siHua: SiHua;
  siHuaLabel: keyof typeof SIHUA_IN_FUQI_GU;
  starName: string;
  palaceName: string;
  branch: number;
  branchName: string;
  oppositePalaceName?: string;
  clashesPalaceName?: string;
  hitsRelationshipZone: boolean;
  doublesNatalHuaJi: boolean;
}

export interface PartnerAnnualOverlay {
  label: 'A' | 'B';
  liuNianMingPalaceName: string;
  daXianIndex: number;
  daXianPalaceName?: string;
  daXianSiHuaHits: AnnualSiHuaHit[];
  liuNianSiHuaHits: AnnualSiHuaHit[];
  hongLuanHitPalace?: string;
  tianXiHitPalace?: string;
  hasBlessing: boolean;
  hasTension: boolean;
  hasDaXianTension: boolean;
  sentimentDelta: number;
}

export type AnnualOutlook =
  | 'shared_blessing'
  | 'blessing'
  | 'mixed'
  | 'tension'
  | 'shared_tension'
  | 'neutral';

export interface AnnualSynastryOverlay {
  targetYear: number;
  yearStem: number;
  yearStemName: string;
  yearBranch: number;
  yearBranchName: string;
  liuNianTransforms: Record<SiHua, string>;
  hongLuanBranch: number;
  tianXiBranch: number;
  partnerA: PartnerAnnualOverlay;
  partnerB: PartnerAnnualOverlay;
  isSharedBlessingYear: boolean;
  isSharedTensionYear: boolean;
  outlook: AnnualOutlook;
  yearScore: number;
}

export interface SynastryDimensions {
  palaceResonance: number;
  crossSiHuaHarmony: number;
  spousePalaceStability: number;
  spiritAndFortune: number;
}

export interface SynastryHighlight {
  id: string;
  code: string;
  scope: SynastryFindingScope;
  category: SynastryFindingCategory;
  direction: FindingDirection;
  polarity: 'positive' | 'mixed';
  priority: number;
  palaces: string[];
  branches: number[];
  stars: string[];
  siHua?: SiHua;
  facts: Record<string, string | number | boolean>;
}

export interface SynastryFrictionPoint {
  id: string;
  code: string;
  scope: SynastryFindingScope;
  category: SynastryFindingCategory;
  direction: FindingDirection;
  severity: FrictionSeverity;
  priority: number;
  palaces: string[];
  branches: number[];
  stars: string[];
  siHua?: SiHua;
  facts: Record<string, string | number | boolean>;
}

export interface SynastryResult {
  personA: PersonSynastrySummary;
  personB: PersonSynastrySummary;
  crossSiHua: CrossSiHuaAnalysis;
  palaceResonance: PalaceResonanceAnalysis;
  annualOverlay?: AnnualSynastryOverlay;
  score: number;
  stars: 1 | 2 | 3 | 4 | 5;
  level: SynastryLevel;
  levelCriteria: string;
  dimensions: SynastryDimensions;
  highlights: SynastryHighlight[];
  frictionPoints: SynastryFrictionPoint[];
}

export interface CompactPromptPalace {
  br: string;
  st?: string;
  from?: string;
  stars: string[];
  sha?: string[];
  lucky?: string[];
  sh?: string[];
  self?: string[];
}

export interface CompactPromptPerson {
  yg: string;
  ju: string;
  mz: string;
  sz: string;
  age: number;
  ming: CompactPromptPalace;
  fuqi: CompactPromptPalace;
  fude: CompactPromptPalace;
  sunMoon?: { star: '太阳' | '太阴'; br?: string; pal: string; sh?: SiHua; status: string };
  dx?: { pal: string; br?: string };
}

export interface CompactPromptFinding {
  code: string;
  dir: FindingDirection;
  sev?: FrictionSeverity;
  pal: string[];
  stars: string[];
  sh?: SiHua;
}

export interface SynastryPromptPayload {
  version: 1;
  score: {
    total: number;
    stars: 1 | 2 | 3 | 4 | 5;
    level: SynastryLevel;
    dims: SynastryDimensions;
  };
  personA: CompactPromptPerson;
  personB: CompactPromptPerson;
  crossSiHua: {
    bond: BondType;
    mutualJi: boolean;
    aToB: string[];
    bToA: string[];
  };
  resonance: {
    tianZuo: PalaceResonanceAnalysis['tianZuoZhiHe'];
    element: ElementRelation;
    branches: {
      mm: BranchRelationType;
      ff: BranchRelationType;
      afbm: BranchRelationType;
      bfma: BranchRelationType;
      fd: BranchRelationType;
    };
    pairs: string[];
  };
  fuqiInsights: Record<string, string>;
  annual?: {
    year: number;
    gz: string;
    outlook: AnnualOutlook;
    score: number;
    aLnPal: string;
    bLnPal: string;
    aHits: string[];
    bHits: string[];
  };
  highlights: CompactPromptFinding[];
  frictionPoints: CompactPromptFinding[];
}

// ─── Domain Constants ────────────────────────────────────────────────────────

const PALACE_CODE_MAP: Record<string, string> = {
  命: 'MING',
  兄弟: 'XIONGDI',
  夫妻: 'FUQI',
  子女: 'ZINV',
  财帛: 'CAIBO',
  疾厄: 'JIE',
  迁移: 'QIANYI',
  仆役: 'PUYI',
  官禄: 'GUANLU',
  田宅: 'TIANZHAI',
  福德: 'FUDE',
  父母: 'FUMU',
};

function palaceCode(name: string): string {
  const key = normalizePalaceKey(name);
  return PALACE_CODE_MAP[key] ?? key.toUpperCase();
}

const KEY_RELATIONAL_PALACES = new Set(['命宫', '夫妻', '福德', '田宅', '财帛', '仆役']);
const CORE_RELATIONSHIP_PALACES = new Set(['命宫', '夫妻', '福德']);
const ANNUAL_RELATIONSHIP_PALACES = new Set(['命宫', '夫妻', '福德', '田宅', '财帛', '子女']);
const SANFANG_MINGSIZHENG = ['命宫', '财帛', '官禄', '迁移'] as const;

const SIHUA_ORDER: readonly SiHua[] = ['禄', '权', '科', '忌'];
const SIHUA_LABEL_MAP: Record<SiHua, keyof typeof SIHUA_IN_FUQI_GU> = {
  禄: '化禄',
  权: '化权',
  科: '化科',
  忌: '化忌',
};

const MAJOR_SHA_STARS = new Set(['擎羊', '陀罗', '火星', '铃星', '地空', '地劫']);
const LUCKY_ASSIST_STARS = new Set(['左辅', '右弼', '文昌', '文曲', '天魁', '天钺', '禄存', '天马']);
const SHA_PO_LANG_STARS = new Set(['七杀', '破军', '贪狼']);
const JI_YUE_TONG_LIANG_STARS = new Set(['天机', '太阴', '天同', '天梁']);
const SAN_XIONG_PARTNERS = new Set(['贪狼', '破军', '七杀']);

const MARRIAGE_AUX_CATEGORY: Record<string, 'romance' | 'loneliness' | 'late_marriage'> = {
  红鸾: 'romance',
  天喜: 'romance',
  天姚: 'romance',
  咸池: 'romance',
  孤辰: 'loneliness',
  寡宿: 'loneliness',
  天哭: 'loneliness',
  天虚: 'loneliness',
  天巫: 'late_marriage',
};

const WUXING_JU_TO_ELEMENT: Record<number, FiveElement> = {
  2: '水',
  3: '木',
  4: '金',
  5: '土',
  6: '火',
};

const ELEMENT_GENERATES: Record<FiveElement, FiveElement> = {
  木: '火',
  火: '土',
  土: '金',
  金: '水',
  水: '木',
};

const FUQI_STAR_BASE_SCORE: Record<string, number> = {
  天府: 8,
  天相: 7,
  天同: 6,
  天梁: 5,
  太阴: 5,
  太阳: 4,
  紫微: 2,
  天机: 1,
  巨门: -2,
  贪狼: -4,
  武曲: -6,
  七杀: -8,
  廉贞: -8,
  破军: -9,
};

// ─── Utility Helpers ─────────────────────────────────────────────────────────

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeBranch(branch: number): number {
  return ((Math.trunc(branch) % 12) + 12) % 12;
}

function normalizePalaceKey(name: string): string {
  return name.replace(/宫$/, '');
}

function findPalaceByName(chart: ZiweiChart, targetName: string): Palace | undefined {
  const exact = chart.palaces.find((p) => p.name === targetName);
  if (exact) return exact;
  const key = normalizePalaceKey(targetName);
  return chart.palaces.find((p) => normalizePalaceKey(p.name) === key);
}

function findPalaceByBranch(chart: ZiweiChart, branch: number): Palace | undefined {
  const norm = normalizeBranch(branch);
  return chart.palaces.find((p) => normalizeBranch(p.branch) === norm);
}

/**
 * Locate a star anywhere across a chart's 12 palaces.
 */
export function findStarInPalaces(chart: ZiweiChart, starName: string): PalaceStarLookup | null {
  for (const palace of chart.palaces) {
    const star = palace.stars.find((s) => s.name === starName);
    if (star) return { palace, star };
  }
  return null;
}

function resolveElement(chart: ZiweiChart): FiveElement {
  const fromJu = WUXING_JU_TO_ELEMENT[chart.wuxingJu];
  if (fromJu) return fromJu;
  const firstChar = chart.wuxingJuName?.[0] as FiveElement | undefined;
  if (firstChar && firstChar in ELEMENT_GENERATES) return firstChar;
  return '木';
}

function getElementRelation(a: FiveElement, b: FiveElement): ElementRelation {
  if (a === b) return 'same';
  if (ELEMENT_GENERATES[a] === b || ELEMENT_GENERATES[b] === a) return 'generating';
  return 'controlling';
}

interface EffectivePalaceStars {
  isEmpty: boolean;
  majorStars: string[];
  borrowedFromBranch?: number;
  borrowedFromName?: string;
  borrowedStars: string[];
  effectiveMajorStars: string[];
  effectiveStarObjects: Array<{ star: Star; isBorrowed: boolean }>;
}

function resolveEffectivePalaceStars(chart: ZiweiChart, palace: Palace): EffectivePalaceStars {
  const directMajor = palace.stars.filter((s) => s.type === 'major');
  const majorStars = directMajor.map((s) => s.name);
  const isEmpty = palace.isEmpty ?? majorStars.length === 0;

  if (!isEmpty) {
    return {
      isEmpty: false,
      majorStars,
      borrowedStars: [],
      effectiveMajorStars: majorStars,
      effectiveStarObjects: directMajor.map((star) => ({ star, isBorrowed: false })),
    };
  }

  const oppBranch = palace.oppositeBranch ?? normalizeBranch(palace.branch + 6);
  const oppPalace = findPalaceByBranch(chart, oppBranch);
  const oppMajor = oppPalace ? oppPalace.stars.filter((s) => s.type === 'major') : [];
  const borrowedStars =
    palace.borrowedStars && palace.borrowedStars.length > 0
      ? [...palace.borrowedStars]
      : oppMajor.map((s) => s.name);

  const effectiveStarObjects = borrowedStars.map((starName) => {
    const found = oppMajor.find((s) => s.name === starName);
    return {
      star: found ?? { name: starName, type: 'major' as const },
      isBorrowed: true,
    };
  });

  return {
    isEmpty: true,
    majorStars,
    borrowedFromBranch: palace.borrowedFromBranch ?? oppPalace?.branch ?? oppBranch,
    borrowedFromName: palace.borrowedFromName ?? oppPalace?.name,
    borrowedStars,
    effectiveMajorStars: borrowedStars,
    effectiveStarObjects,
  };
}

function getPalaceSelfSiHua(palace: Palace): SelfSihua[] {
  const computed = detectSelfSihua(palace);
  if (computed.length > 0) return computed;
  return palace.selfSihua ? [...palace.selfSihua] : [];
}

function summarizePalace(chart: ZiweiChart, palace: Palace | undefined, fallbackName: string): PersonPalaceBrief {
  if (!palace) {
    return {
      palaceName: fallbackName,
      branch: 0,
      branchName: BRANCHES[0] ?? '子',
      stem: 0,
      stemName: STEMS[0] ?? '甲',
      isEmpty: true,
      majorStars: [],
      borrowedStars: [],
      effectiveMajorStars: [],
      luckyStars: [],
      shaStars: [],
      natalSiHua: [],
      selfSiHua: [],
    };
  }

  const effective = resolveEffectivePalaceStars(chart, palace);
  const branch = normalizeBranch(palace.branch);
  const stem = ((Math.trunc(palace.stem) % 10) + 10) % 10;

  return {
    palaceName: palace.name,
    branch,
    branchName: BRANCHES[branch] ?? '',
    stem,
    stemName: STEMS[stem] ?? '',
    isEmpty: effective.isEmpty,
    majorStars: effective.majorStars,
    borrowedFromName: effective.borrowedFromName,
    borrowedFromBranch: effective.borrowedFromBranch,
    borrowedStars: effective.borrowedStars,
    effectiveMajorStars: effective.effectiveMajorStars,
    luckyStars: palace.stars.filter((s) => LUCKY_ASSIST_STARS.has(s.name)).map((s) => s.name),
    shaStars: palace.stars.filter((s) => MAJOR_SHA_STARS.has(s.name)).map((s) => s.name),
    natalSiHua: palace.stars
      .filter((s): s is Star & { siHua: SiHua } => Boolean(s.siHua))
      .map((s) => ({ starName: s.name, siHua: s.siHua })),
    selfSiHua: getPalaceSelfSiHua(palace),
  };
}

function buildChartIdentityKey(chart: ZiweiChart): string {
  const { year, month, day, hour, gender } = chart.birthInfo;
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}-h${hour}-${gender}-m${normalizeBranch(chart.mingGongBranch)}-j${chart.wuxingJu}`;
}

function evaluateSunMoon(chart: ZiweiChart): SunMoonCheck | null {
  const focusStar: '太阳' | '太阴' = chart.birthInfo.gender === 'female' ? '太阳' : '太阴';
  const lookup = findStarInPalaces(chart, focusStar);
  if (!lookup) return null;

  const { palace, star } = lookup;
  const branch = normalizeBranch(palace.branch);
  let status: SunMoonCheck['status'] = 'neutral';

  if (focusStar === '太阳') {
    if (star.siHua === '忌' && star.brightness === 'dim') status = 'risk';
    else if (star.siHua === '忌') status = 'risk';
    else if (star.brightness === 'bright') status = 'favorable';
    else if (star.brightness === 'dim') status = 'risk';
  } else {
    if (star.siHua === '忌') status = 'risk';
    else if (star.brightness === 'bright') status = 'favorable';
    else if (star.brightness === 'dim') status = 'risk';
  }

  return {
    focusStar,
    palaceName: palace.name,
    branch,
    branchName: BRANCHES[branch] ?? '',
    brightness: star.brightness,
    brightnessRaw: star.brightnessRaw,
    siHua: star.siHua,
    status,
  };
}

function buildPersonSummary(chart: ZiweiChart, label: 'A' | 'B'): PersonSynastrySummary {
  const mingPalace = findPalaceByName(chart, '命宫');
  const fuqiPalace = findPalaceByName(chart, '夫妻');
  const fudePalace = findPalaceByName(chart, '福德');
  const shenBranch = normalizeBranch(chart.shenGongBranch);
  const shenPalace = findPalaceByBranch(chart, shenBranch);
  const dx =
    chart.currentDaXianIndex >= 0 && chart.currentDaXianIndex < chart.daXians.length
      ? chart.daXians[chart.currentDaXianIndex]
      : undefined;

  const yearStem = ((Math.trunc(chart.lunarInfo.yearStem) % 10) + 10) % 10;
  const yearBranch = normalizeBranch(chart.lunarInfo.yearBranch);

  return {
    label,
    chartKey: buildChartIdentityKey(chart),
    gender: chart.birthInfo.gender,
    yinYangGender:
      chart.yinYangGender ??
      `${yearStem % 2 === 0 ? '阳' : '阴'}${chart.birthInfo.gender === 'male' ? '男' : '女'}`,
    yearStem,
    yearStemName: STEMS[yearStem] ?? '',
    yearBranch,
    yearBranchName: BRANCHES[yearBranch] ?? '',
    wuxingJu: chart.wuxingJu,
    wuxingJuName: chart.wuxingJuName,
    wuxingElement: resolveElement(chart),
    mingZhu: chart.mingZhu ?? '',
    shenZhu: chart.shenZhu ?? '',
    mingGong: summarizePalace(chart, mingPalace, '命宫'),
    fuqiGong: summarizePalace(chart, fuqiPalace, '夫妻'),
    fudeGong: summarizePalace(chart, fudePalace, '福德'),
    shenGongBranch: shenBranch,
    shenGongBranchName: BRANCHES[shenBranch] ?? '',
    shenGongPalaceName: shenPalace?.name ?? '',
    currentAge: chart.currentAge,
    currentDaXianIndex: chart.currentDaXianIndex,
    currentDaXianPalaceName: dx?.palaceName,
    currentDaXianBranch: dx?.palaceBranch,
    sunMoonCheck: evaluateSunMoon(chart),
  };
}

// ─── Branch Relationship Helper ──────────────────────────────────────────────

export function analyzePalaceBranchRelation(
  branchA: number,
  branchB: number,
  pairLabel = '',
): BranchRelationDetail {
  const a = normalizeBranch(branchA);
  const b = normalizeBranch(branchB);
  const diff = (b - a + 12) % 12;

  let relation: BranchRelationType = 'neutral';
  if (a === b) relation = 'same';
  else if (diff === 6) relation = 'liuchong';
  else if ((a + b) % 12 === 1) relation = 'liuhe';
  else if (diff === 4 || diff === 8) relation = 'sanhe';

  return {
    pairLabel,
    branchA: a,
    branchB: b,
    branchNameA: BRANCHES[a] ?? '',
    branchNameB: BRANCHES[b] ?? '',
    diff,
    relation,
    isSixHarm: (a + b) % 12 === 7,
  };
}

// ─── Cross-Chart Flying SiHua ────────────────────────────────────────────────

function resolveStemBySource(chart: ZiweiChart, source: CrossSiHuaSource): number {
  if (source === 'mingStem') {
    const ming = findPalaceByName(chart, '命宫');
    if (ming) return ((Math.trunc(ming.stem) % 10) + 10) % 10;
  } else if (source === 'fuqiStem') {
    const fuqi = findPalaceByName(chart, '夫妻');
    if (fuqi) return ((Math.trunc(fuqi.stem) % 10) + 10) % 10;
  }
  return ((Math.trunc(chart.lunarInfo.yearStem) % 10) + 10) % 10;
}

function classifyCrossHitPolarity(siHua: SiHua, palaceName: string, clashesPalaceName?: string): FindingPolarity {
  if (siHua === '禄' || siHua === '科') return 'positive';
  if (siHua === '权') return 'mixed';
  // 化忌
  if (KEY_RELATIONAL_PALACES.has(palaceName) || clashesPalaceName) return 'negative';
  return 'mixed';
}

function buildCrossHitTag(siHua: SiHua, palaceName: string, clashesPalaceName?: string): string {
  const key = normalizePalaceKey(palaceName);
  const sihuaKey = siHua === '禄' ? 'lu' : siHua === '权' ? 'quan' : siHua === '科' ? 'ke' : 'ji';
  if (siHua === '忌' && clashesPalaceName) {
    return `${sihuaKey}_into_${key}_clash_${normalizePalaceKey(clashesPalaceName)}`;
  }
  return `${sihuaKey}_into_${key}`;
}

function computeCrossSiHuaDirection(
  sourceChart: ZiweiChart,
  targetChart: ZiweiChart,
  from: 'A' | 'B',
  to: 'A' | 'B',
  stemSource: CrossSiHuaSource,
): CrossSiHuaDirection {
  const stemIndex = resolveStemBySource(sourceChart, stemSource);
  const stemName = STEMS[stemIndex] ?? '';
  const transforms = getSiHuaByStem(stemIndex);
  const hits: CrossSiHuaHit[] = [];

  for (const siHua of SIHUA_ORDER) {
    const starName = transforms[siHua];
    if (!starName) continue;
    const lookup = findStarInPalaces(targetChart, starName);
    if (!lookup) continue;

    const { palace, star } = lookup;
    const branch = normalizeBranch(palace.branch);
    const oppPalace = findPalaceByBranch(targetChart, (branch + 6) % 12);
    const oppositePalaceName = oppPalace?.name;
    const clashesPalaceName =
      siHua === '忌' && oppositePalaceName && CORE_RELATIONSHIP_PALACES.has(oppositePalaceName)
        ? oppositePalaceName
        : undefined;
    const isKeyRelationalHit = KEY_RELATIONAL_PALACES.has(palace.name) || Boolean(clashesPalaceName);

    hits.push({
      from,
      to,
      stemSource,
      stemIndex,
      stemName,
      siHua,
      siHuaLabel: SIHUA_LABEL_MAP[siHua],
      starName,
      palaceName: palace.name,
      branch,
      branchName: BRANCHES[branch] ?? '',
      starBrightness: star.brightness,
      starBrightnessRaw: star.brightnessRaw,
      targetNatalSiHua: star.siHua,
      oppositePalaceName,
      clashesPalaceName,
      isKeyRelationalHit,
      polarity: classifyCrossHitPolarity(siHua, palace.name, clashesPalaceName),
      relationTag: buildCrossHitTag(siHua, palace.name, clashesPalaceName),
    });
  }

  return {
    stemSource,
    stemIndex,
    stemName,
    transforms,
    hits,
    keyHits: hits.filter((h) => h.isKeyRelationalHit),
  };
}

function isSevereCoreHuaJi(hit: CrossSiHuaHit): boolean {
  if (hit.siHua !== '忌') return false;
  return CORE_RELATIONSHIP_PALACES.has(hit.palaceName) || Boolean(hit.clashesPalaceName);
}

function determineBondType(aToB: CrossSiHuaDirection, bToA: CrossSiHuaDirection): {
  bondType: BondType;
  hasMutualHuaJi: boolean;
  summaryTags: string[];
} {
  const aCoreJi = aToB.hits.some(isSevereCoreHuaJi);
  const bCoreJi = bToA.hits.some(isSevereCoreHuaJi);
  const hasMutualHuaJi = aCoreJi && bCoreJi;

  const allHits = [...aToB.hits, ...bToA.hits];
  const coreLuKeCount = allHits.filter(
    (h) => (h.siHua === '禄' || h.siHua === '科') && CORE_RELATIONSHIP_PALACES.has(h.palaceName),
  ).length;
  const keyLuKeCount = allHits.filter(
    (h) => (h.siHua === '禄' || h.siHua === '科') && h.isKeyRelationalHit,
  ).length;
  const coreQuanCount = allHits.filter(
    (h) => h.siHua === '权' && CORE_RELATIONSHIP_PALACES.has(h.palaceName),
  ).length;
  const anyKeyJi = aCoreJi || bCoreJi || allHits.some((h) => h.siHua === '忌' && h.isKeyRelationalHit);

  let bondType: BondType = 'lu_ke_driven';
  if (hasMutualHuaJi) {
    bondType = 'mutual_ji_entanglement';
  } else if (coreLuKeCount >= 2 && !aCoreJi && !bCoreJi) {
    bondType = 'mutual_blessing';
  } else if (anyKeyJi) {
    bondType = 'mixed_karmic';
  } else if (coreQuanCount >= 2 && keyLuKeCount < 2) {
    bondType = 'quan_driven';
  }

  const summaryTags: string[] = [];
  if (hasMutualHuaJi) summaryTags.push('mutual_huaji');
  if (coreLuKeCount >= 2) summaryTags.push('strong_lu_ke_resonance');
  if (coreQuanCount >= 1) summaryTags.push('quan_pull');
  if (aToB.hits.some((h) => h.siHua === '忌' && h.targetNatalSiHua === '忌')) summaryTags.push('double_ji_a_to_b');
  if (bToA.hits.some((h) => h.siHua === '忌' && h.targetNatalSiHua === '忌')) summaryTags.push('double_ji_b_to_a');

  return { bondType, hasMutualHuaJi, summaryTags };
}

function analyzeCrossSiHua(
  chartA: ZiweiChart,
  chartB: ZiweiChart,
  sources: readonly CrossSiHuaSource[],
): CrossSiHuaAnalysis {
  const aToB = computeCrossSiHuaDirection(chartA, chartB, 'A', 'B', 'yearStem');
  const bToA = computeCrossSiHuaDirection(chartB, chartA, 'B', 'A', 'yearStem');

  const additionalAToB: CrossSiHuaAnalysis['additionalDirections']['aToB'] = {};
  const additionalBToA: CrossSiHuaAnalysis['additionalDirections']['bToA'] = {};

  for (const src of Array.from(new Set(sources))) {
    if (src === 'yearStem') continue;
    additionalAToB[src] = computeCrossSiHuaDirection(chartA, chartB, 'A', 'B', src);
    additionalBToA[src] = computeCrossSiHuaDirection(chartB, chartA, 'B', 'A', src);
  }

  const { bondType, hasMutualHuaJi, summaryTags } = determineBondType(aToB, bToA);
  return {
    aToB,
    bToA,
    additionalDirections: { aToB: additionalAToB, bToA: additionalBToA },
    bondType,
    hasMutualHuaJi,
    summaryTags,
  };
}

// ─── Spouse & Spirit Palace Assessment ───────────────────────────────────────

function collectSanFangMingStars(chart: ZiweiChart): Set<string> {
  const stars = new Set<string>();
  for (const name of SANFANG_MINGSIZHENG) {
    const p = findPalaceByName(chart, name);
    if (!p) continue;
    const eff = resolveEffectivePalaceStars(chart, p);
    for (const s of eff.effectiveMajorStars) stars.add(s);
  }
  return stars;
}

function assessPartnerSpousePalace(chart: ZiweiChart, summary: PersonSynastrySummary): PartnerSpouseAssessment {
  const fuqiPalace = findPalaceByName(chart, '夫妻');
  const fudePalace = findPalaceByName(chart, '福德');
  const mingPalace = findPalaceByName(chart, '命宫');

  const effFuqi = fuqiPalace
    ? resolveEffectivePalaceStars(chart, fuqiPalace)
    : {
        isEmpty: true,
        majorStars: [],
        borrowedStars: [],
        effectiveMajorStars: [],
        effectiveStarObjects: [],
      };

  const starAssessments: FuqiStarAssessment[] = [];
  for (const { star, isBorrowed } of effFuqi.effectiveStarObjects) {
    const knowledge = STAR_IN_FUQI_GU[star.name];
    if (!knowledge) continue;
    starAssessments.push({
      starName: star.name,
      isBorrowed,
      brightness: star.brightness,
      brightnessRaw: star.brightnessRaw,
      siHua: star.siHua,
      knowledge,
    });
  }

  const siHuaAssessments: FuqiSiHuaAssessment[] = [];
  if (fuqiPalace) {
    for (const star of fuqiPalace.stars) {
      if (!star.siHua) continue;
      const label = SIHUA_LABEL_MAP[star.siHua];
      siHuaAssessments.push({
        siHua: star.siHua,
        siHuaLabel: label,
        starName: star.name,
        source: 'direct',
        knowledge: SIHUA_IN_FUQI_GU[label],
      });
    }
    if (effFuqi.isEmpty) {
      for (const { star } of effFuqi.effectiveStarObjects) {
        if (!star.siHua) continue;
        const label = SIHUA_LABEL_MAP[star.siHua];
        siHuaAssessments.push({
          siHua: star.siHua,
          siHuaLabel: label,
          starName: star.name,
          source: 'borrowed',
          knowledge: SIHUA_IN_FUQI_GU[label],
        });
      }
    }
    const oppBranch = fuqiPalace.oppositeBranch ?? normalizeBranch(fuqiPalace.branch + 6);
    const oppPalace = findPalaceByBranch(chart, oppBranch);
    if (oppPalace) {
      for (const star of oppPalace.stars) {
        if (star.siHua === '忌') {
          siHuaAssessments.push({
            siHua: '忌',
            siHuaLabel: '化忌',
            starName: star.name,
            source: 'opposite_clash',
            knowledge: SIHUA_IN_FUQI_GU['化忌'],
          });
        }
      }
    }
    for (const selfSh of getPalaceSelfSiHua(fuqiPalace)) {
      const label = SIHUA_LABEL_MAP[selfSh.siHua];
      siHuaAssessments.push({
        siHua: selfSh.siHua,
        siHuaLabel: label,
        starName: selfSh.starName,
        source: 'self_sihua',
        knowledge: SIHUA_IN_FUQI_GU[label],
      });
    }
  }

  const marriageAuxStars: MarriageAuxStarNote[] = [];
  for (const p of [fuqiPalace, mingPalace]) {
    if (!p) continue;
    for (const s of p.stars) {
      const brief = MARRIAGE_STARS_BRIEF[s.name];
      if (!brief) continue;
      marriageAuxStars.push({
        starName: s.name,
        palaceName: p.name,
        category: MARRIAGE_AUX_CATEGORY[s.name] ?? 'romance',
        brief,
      });
    }
  }

  const luckyStarsInFuqi = summary.fuqiGong.luckyStars;
  const shaStarsInFuqi = summary.fuqiGong.shaStars;
  const shaStarsInFude = summary.fudeGong.shaStars;

  const effSet = new Set(effFuqi.effectiveMajorStars);
  const hasSanXiongCombo =
    effSet.has('廉贞') && Array.from(SAN_XIONG_PARTNERS).some((name) => effSet.has(name));
  const hasWuQuShaPoRisk =
    effSet.has('武曲') && (effSet.has('七杀') || effSet.has('破军')) && shaStarsInFuqi.length > 0;

  // Deterministic partner Fuqi stability score (0..100)
  let fuqiScore = 68;
  let majorBaseSum = 0;
  for (const sa of starAssessments) {
    majorBaseSum += FUQI_STAR_BASE_SCORE[sa.starName] ?? 0;
    if (sa.brightness === 'bright') fuqiScore += 4;
    else if (sa.brightness === 'dim') fuqiScore -= 6;
  }
  fuqiScore += starAssessments.length > 1 ? Math.round(majorBaseSum / 1.5) : majorBaseSum;
  if (effFuqi.isEmpty) fuqiScore -= 3;
  if (hasSanXiongCombo) fuqiScore -= 22;
  if (hasWuQuShaPoRisk) fuqiScore -= 14;

  fuqiScore += Math.min(12, luckyStarsInFuqi.length * 3);
  if (luckyStarsInFuqi.includes('左辅') && luckyStarsInFuqi.includes('右弼')) fuqiScore += 4;
  if (marriageAuxStars.some((m) => m.starName === '红鸾' || m.starName === '天喜')) fuqiScore += 3;
  if (marriageAuxStars.some((m) => m.palaceName === '夫妻' && m.category === 'loneliness')) fuqiScore -= 4;

  fuqiScore -= shaStarsInFuqi.length * 7;

  for (const sh of siHuaAssessments) {
    if (sh.source === 'direct') {
      if (sh.siHua === '禄') fuqiScore += 8;
      else if (sh.siHua === '科') fuqiScore += 5;
      else if (sh.siHua === '权') fuqiScore += 1;
      else if (sh.siHua === '忌') fuqiScore -= 15;
    } else if (sh.source === 'borrowed') {
      if (sh.siHua === '禄') fuqiScore += 5;
      else if (sh.siHua === '科') fuqiScore += 3;
      else if (sh.siHua === '忌') fuqiScore -= 10;
    } else if (sh.source === 'opposite_clash') {
      fuqiScore -= 10;
    } else if (sh.source === 'self_sihua') {
      if (sh.siHua === '忌') fuqiScore -= 8;
      else if (sh.siHua === '禄') fuqiScore -= 3;
    }
  }

  if (summary.sunMoonCheck) {
    if (summary.sunMoonCheck.status === 'favorable') fuqiScore += 4;
    else if (summary.sunMoonCheck.status === 'risk') {
      fuqiScore -= summary.sunMoonCheck.siHua === '忌' ? 10 : 4;
    }
  }

  // Deterministic partner Fude (Spirit/Happiness) score (0..100)
  let fudeScore = 66;
  if (fudePalace) {
    const effFude = resolveEffectivePalaceStars(chart, fudePalace);
    fudeScore += Math.min(10, summary.fudeGong.luckyStars.length * 3);
    fudeScore -= shaStarsInFude.length * 5;
    for (const sh of summary.fudeGong.natalSiHua) {
      if (sh.siHua === '禄') fudeScore += 8;
      else if (sh.siHua === '科') fudeScore += 5;
      else if (sh.siHua === '忌') fudeScore -= 12;
    }
    const fudeOpp = findPalaceByBranch(chart, fudePalace.oppositeBranch ?? normalizeBranch(fudePalace.branch + 6));
    if (fudeOpp?.stars.some((s) => s.siHua === '忌')) fudeScore -= 7;

    const pojunObj = effFude.effectiveStarObjects.find((o) => o.star.name === '破军');
    const lianzhenObj = effFude.effectiveStarObjects.find((o) => o.star.name === '廉贞');
    if (pojunObj && lianzhenObj && pojunObj.star.brightness === 'dim') {
      fudeScore -= 14;
    }
    if (effFude.effectiveStarObjects.some((o) => o.star.brightness === 'bright')) fudeScore += 3;
  }

  return {
    label: summary.label,
    palaceBranch: summary.fuqiGong.branch,
    branchName: summary.fuqiGong.branchName,
    isEmpty: effFuqi.isEmpty,
    borrowedFromName: effFuqi.borrowedFromName,
    borrowedStars: effFuqi.borrowedStars,
    effectiveMajorStars: effFuqi.effectiveMajorStars,
    starAssessments,
    siHuaAssessments,
    marriageAuxStars,
    luckyStarsInFuqi,
    shaStarsInFuqi,
    shaStarsInFude,
    hasSanXiongCombo,
    hasWuQuShaPoRisk,
    fuqiStabilityScore: clampScore(fuqiScore),
    fudeScore: clampScore(fudeScore),
  };
}

function detectClassicStarPairings(
  starsA: readonly string[],
  starsB: readonly string[],
): ClassicStarPairingMatch[] {
  const setA = new Set(starsA);
  const setB = new Set(starsB);
  const matches: ClassicStarPairingMatch[] = [];
  const hasBothWays = (a: string, b: string) => (setA.has(a) && setB.has(b)) || (setA.has(b) && setB.has(a));
  const hasGroupCross = (g1: Set<string>, g2: Set<string>) =>
    (starsA.some((s) => g1.has(s)) && starsB.some((s) => g2.has(s))) ||
    (starsB.some((s) => g1.has(s)) && starsA.some((s) => g2.has(s)));

  if (hasBothWays('紫微', '天府')) {
    matches.push({ code: 'ZIWEI_TIANFU', starsRating: 5, polarity: 'positive', starsA: [...starsA], starsB: [...starsB] });
  }
  if (setA.has('天相') || setB.has('天相')) {
    matches.push({ code: 'TIANXIANG_ADAPTABLE', starsRating: 4, polarity: 'positive', starsA: [...starsA], starsB: [...starsB] });
  }
  if (hasBothWays('天梁', '天同')) {
    matches.push({ code: 'TIANLIANG_TIANTONG', starsRating: 4, polarity: 'positive', starsA: [...starsA], starsB: [...starsB] });
  }
  if (hasBothWays('太阳', '太阴')) {
    matches.push({ code: 'TAIYANG_TAIYIN', starsRating: 4, polarity: 'positive', starsA: [...starsA], starsB: [...starsB] });
  }
  if (
    (setA.has('紫微') && setA.has('破军') && setB.has('廉贞') && setB.has('天府')) ||
    (setB.has('紫微') && setB.has('破军') && setA.has('廉贞') && setA.has('天府'))
  ) {
    matches.push({ code: 'ZIPO_LIANFU', starsRating: 4, polarity: 'positive', starsA: [...starsA], starsB: [...starsB] });
  }
  if (hasBothWays('武曲', '天同')) {
    matches.push({ code: 'WUQU_TIANTONG', starsRating: 3, polarity: 'mixed', starsA: [...starsA], starsB: [...starsB] });
  }
  if (hasGroupCross(SHA_PO_LANG_STARS, JI_YUE_TONG_LIANG_STARS)) {
    matches.push({ code: 'SHAPOLANG_JIYUETONGLIANG', starsRating: 3, polarity: 'mixed', starsA: [...starsA], starsB: [...starsB] });
  }
  if (setA.has('七杀') && setB.has('七杀')) {
    matches.push({ code: 'QISHA_QISHA', starsRating: 2, polarity: 'negative', starsA: [...starsA], starsB: [...starsB] });
  }
  if (setA.has('破军') && setB.has('破军')) {
    matches.push({ code: 'POJUN_POJUN', starsRating: 2, polarity: 'negative', starsA: [...starsA], starsB: [...starsB] });
  }
  if (
    starsA.some((s) => SHA_PO_LANG_STARS.has(s)) &&
    starsB.some((s) => SHA_PO_LANG_STARS.has(s)) &&
    !(setA.has('七杀') && setB.has('七杀')) &&
    !(setA.has('破军') && setB.has('破军'))
  ) {
    matches.push({ code: 'DUAL_SHAPOLANG', starsRating: 2, polarity: 'negative', starsA: [...starsA], starsB: [...starsB] });
  }
  if (
    (setA.has('廉贞') && (setB.has('七杀') || setB.has('破军'))) ||
    (setB.has('廉贞') && (setA.has('七杀') || setA.has('破军')))
  ) {
    matches.push({ code: 'LIANZHEN_SHAPO', starsRating: 1, polarity: 'negative', starsA: [...starsA], starsB: [...starsB] });
  }

  return matches;
}

function analyzePalaceResonance(
  chartA: ZiweiChart,
  chartB: ZiweiChart,
  personA: PersonSynastrySummary,
  personB: PersonSynastrySummary,
): PalaceResonanceAnalysis {
  const mingA = new Set(personA.mingGong.effectiveMajorStars);
  const mingB = new Set(personB.mingGong.effectiveMajorStars);
  const sanFangA = collectSanFangMingStars(chartA);
  const sanFangB = collectSanFangMingStars(chartB);

  const aFuqiMatchesBMing = personA.fuqiGong.effectiveMajorStars.filter((s) => mingB.has(s));
  const bFuqiMatchesAMing = personB.fuqiGong.effectiveMajorStars.filter((s) => mingA.has(s));
  const aFuqiInBMingSanFang = personA.fuqiGong.effectiveMajorStars.filter((s) => sanFangB.has(s));
  const bFuqiInAMingSanFang = personB.fuqiGong.effectiveMajorStars.filter((s) => sanFangA.has(s));

  let tianZuoZhiHe: PalaceResonanceAnalysis['tianZuoZhiHe'] = 'none';
  if (aFuqiMatchesBMing.length > 0 && bFuqiMatchesAMing.length > 0) {
    tianZuoZhiHe = 'mutual';
  } else if (aFuqiMatchesBMing.length > 0 || bFuqiMatchesAMing.length > 0) {
    tianZuoZhiHe = 'single';
  } else if (aFuqiInBMingSanFang.length > 0 || bFuqiInAMingSanFang.length > 0) {
    tianZuoZhiHe = 'sanfang';
  }

  const branchRelations = {
    mingVsMing: analyzePalaceBranchRelation(personA.mingGong.branch, personB.mingGong.branch, 'A.命宫 vs B.命宫'),
    fuqiVsFuqi: analyzePalaceBranchRelation(personA.fuqiGong.branch, personB.fuqiGong.branch, 'A.夫妻 vs B.夫妻'),
    aMingVsBFuqi: analyzePalaceBranchRelation(personA.mingGong.branch, personB.fuqiGong.branch, 'A.命宫 vs B.夫妻'),
    bMingVsAFuqi: analyzePalaceBranchRelation(personB.mingGong.branch, personA.fuqiGong.branch, 'B.命宫 vs A.夫妻'),
    fudeVsFude: analyzePalaceBranchRelation(personA.fudeGong.branch, personB.fudeGong.branch, 'A.福德 vs B.福德'),
  };

  return {
    aFuqiMatchesBMing,
    bFuqiMatchesAMing,
    aFuqiInBMingSanFang,
    bFuqiInAMingSanFang,
    tianZuoZhiHe,
    branchRelations,
    elementRelation: getElementRelation(personA.wuxingElement, personB.wuxingElement),
    classicStarPairings: detectClassicStarPairings(
      personA.mingGong.effectiveMajorStars,
      personB.mingGong.effectiveMajorStars,
    ),
    assessmentA: assessPartnerSpousePalace(chartA, personA),
    assessmentB: assessPartnerSpousePalace(chartB, personB),
  };
}

// ─── Annual Overlay (流年 / 大限) ────────────────────────────────────────────

function resolveDaXianSiHuaForYear(
  chart: ZiweiChart,
  year: number,
): { dxIndex: number; palaceName?: string; transforms?: Record<SiHua, string> } {
  const rawIdx = getDaXianIndexForYear(chart, year);
  const dxIndex = rawIdx === -1 && isChildhoodYear(chart, year) ? CHILDHOOD_DAXIAN_INDEX : rawIdx;
  const dxSiHua = dxIndex !== -1 ? getDaXianSiHua(chart, dxIndex, year) : null;
  const dxPalaceName =
    dxIndex >= 0 && dxIndex < chart.daXians.length
      ? chart.daXians[dxIndex].palaceName
      : undefined;

  return {
    dxIndex: rawIdx,
    palaceName: dxPalaceName,
    transforms: dxSiHua?.transforms,
  };
}

function collectAnnualHitsForChart(
  chart: ZiweiChart,
  transforms: Record<SiHua, string>,
): AnnualSiHuaHit[] {
  const hits: AnnualSiHuaHit[] = [];
  for (const siHua of SIHUA_ORDER) {
    const starName = transforms[siHua];
    if (!starName) continue;
    const lookup = findStarInPalaces(chart, starName);
    if (!lookup) continue;

    const { palace, star } = lookup;
    const branch = normalizeBranch(palace.branch);
    const opp = findPalaceByBranch(chart, (branch + 6) % 12);
    const clashesPalaceName =
      siHua === '忌' && opp && CORE_RELATIONSHIP_PALACES.has(opp.name) ? opp.name : undefined;

    hits.push({
      siHua,
      siHuaLabel: SIHUA_LABEL_MAP[siHua],
      starName,
      palaceName: palace.name,
      branch,
      branchName: BRANCHES[branch] ?? '',
      oppositePalaceName: opp?.name,
      clashesPalaceName,
      hitsRelationshipZone: ANNUAL_RELATIONSHIP_PALACES.has(palace.name) || Boolean(clashesPalaceName),
      doublesNatalHuaJi: siHua === '忌' && star.siHua === '忌',
    });
  }
  return hits;
}

function assessPartnerAnnualOverlay(
  chart: ZiweiChart,
  label: 'A' | 'B',
  year: number,
  yearBranch: number,
  liuNianTransforms: Record<SiHua, string>,
  hongLuanBranch: number,
  tianXiBranch: number,
): PartnerAnnualOverlay {
  const lnPalace = findPalaceByBranch(chart, yearBranch);
  const dx = resolveDaXianSiHuaForYear(chart, year);
  const liuNianSiHuaHits = collectAnnualHitsForChart(chart, liuNianTransforms);
  const daXianSiHuaHits = dx.transforms ? collectAnnualHitsForChart(chart, dx.transforms) : [];

  const hongLuanPalace = findPalaceByBranch(chart, hongLuanBranch);
  const tianXiPalace = findPalaceByBranch(chart, tianXiBranch);
  const hongLuanHitPalace =
    hongLuanPalace && CORE_RELATIONSHIP_PALACES.has(hongLuanPalace.name)
      ? hongLuanPalace.name
      : undefined;
  const tianXiHitPalace =
    tianXiPalace && CORE_RELATIONSHIP_PALACES.has(tianXiPalace.name) ? tianXiPalace.name : undefined;

  let sentimentDelta = 0;
  let hasBlessing = false;
  let hasTension = false;
  let hasDaXianTension = false;

  for (const hit of liuNianSiHuaHits) {
    const inCore = CORE_RELATIONSHIP_PALACES.has(hit.palaceName);
    if (hit.siHua === '禄') {
      if (inCore) {
        sentimentDelta += 14;
        hasBlessing = true;
      } else if (hit.oppositePalaceName === '夫妻' || hit.oppositePalaceName === '命宫') {
        sentimentDelta += 8;
        hasBlessing = true;
      } else if (hit.hitsRelationshipZone) {
        sentimentDelta += 6;
      }
    } else if (hit.siHua === '科') {
      if (inCore) {
        sentimentDelta += 8;
        hasBlessing = true;
      }
    } else if (hit.siHua === '忌') {
      if (hit.palaceName === '夫妻' || hit.clashesPalaceName === '夫妻') {
        sentimentDelta -= hit.doublesNatalHuaJi ? 22 : 16;
        hasTension = true;
      } else if (hit.palaceName === '命宫' || hit.clashesPalaceName === '命宫') {
        sentimentDelta -= hit.doublesNatalHuaJi ? 18 : 13;
        hasTension = true;
      } else if (hit.palaceName === '福德' || hit.clashesPalaceName === '福德') {
        sentimentDelta -= 11;
        hasTension = true;
      } else if (hit.hitsRelationshipZone) {
        sentimentDelta -= 6;
      }
    }
  }

  for (const hit of daXianSiHuaHits) {
    if (hit.siHua === '禄' && CORE_RELATIONSHIP_PALACES.has(hit.palaceName)) sentimentDelta += 5;
    if (hit.siHua === '忌' && (CORE_RELATIONSHIP_PALACES.has(hit.palaceName) || hit.clashesPalaceName)) {
      sentimentDelta -= 6;
      hasDaXianTension = true;
    }
  }

  if (lnPalace?.name === '夫妻' || lnPalace?.name === '命宫') {
    sentimentDelta += 4;
    if (!hasTension) hasBlessing = true;
  }
  if (hongLuanHitPalace || tianXiHitPalace) {
    sentimentDelta += 6;
    if (!hasTension) hasBlessing = true;
  }

  return {
    label,
    liuNianMingPalaceName: lnPalace?.name ?? '',
    daXianIndex: dx.dxIndex,
    daXianPalaceName: dx.palaceName,
    daXianSiHuaHits,
    liuNianSiHuaHits,
    hongLuanHitPalace,
    tianXiHitPalace,
    hasBlessing,
    hasTension,
    hasDaXianTension,
    sentimentDelta,
  };
}

function evaluateAnnualOverlay(
  chartA: ZiweiChart,
  chartB: ZiweiChart,
  targetYear: number,
): AnnualSynastryOverlay {
  if (!Number.isFinite(targetYear)) {
    throw new RangeError(`targetYear must be a finite integer; received ${targetYear}`);
  }
  const year = Math.trunc(targetYear);
  const liuNian = getLiuNianSiHua(year);
  const yearBranch = getYearBranchIndex(year);
  const hongLuanBranch = (3 - yearBranch + 12) % 12;
  const tianXiBranch = (hongLuanBranch + 6) % 12;

  const partnerA = assessPartnerAnnualOverlay(
    chartA,
    'A',
    year,
    yearBranch,
    liuNian.transforms,
    hongLuanBranch,
    tianXiBranch,
  );
  const partnerB = assessPartnerAnnualOverlay(
    chartB,
    'B',
    year,
    yearBranch,
    liuNian.transforms,
    hongLuanBranch,
    tianXiBranch,
  );

  const isSharedBlessingYear = partnerA.hasBlessing && partnerB.hasBlessing && !partnerA.hasTension && !partnerB.hasTension;
  const isSharedTensionYear = partnerA.hasTension && partnerB.hasTension;

  let outlook: AnnualOutlook = 'neutral';
  if (isSharedTensionYear) outlook = 'shared_tension';
  else if (isSharedBlessingYear) outlook = 'shared_blessing';
  else if ((partnerA.hasBlessing || partnerB.hasBlessing) && (partnerA.hasTension || partnerB.hasTension)) {
    outlook = 'mixed';
  } else if (partnerA.hasTension || partnerB.hasTension) {
    outlook = 'tension';
  } else if (partnerA.hasBlessing || partnerB.hasBlessing) {
    outlook = 'blessing';
  }

  const yearScore = clampScore(65 + Math.round((partnerA.sentimentDelta + partnerB.sentimentDelta) * 0.8));

  return {
    targetYear: year,
    yearStem: liuNian.stemIndex,
    yearStemName: liuNian.stemName,
    yearBranch,
    yearBranchName: BRANCHES[yearBranch] ?? '',
    liuNianTransforms: liuNian.transforms,
    hongLuanBranch,
    tianXiBranch,
    partnerA,
    partnerB,
    isSharedBlessingYear,
    isSharedTensionYear,
    outlook,
    yearScore,
  };
}

// ─── Symmetric Scoring Engine ────────────────────────────────────────────────

function scoreBranchPair(rel: BranchRelationDetail, harmonyBonus: number, sameBonus: number, clashPenalty: number): number {
  if (rel.relation === 'liuhe' || rel.relation === 'sanhe') return harmonyBonus;
  if (rel.relation === 'same') return sameBonus;
  if (rel.relation === 'liuchong') return -clashPenalty;
  if (rel.isSixHarm) return -Math.round(clashPenalty * 0.4);
  return 0;
}

function scoreDirectionalCrossSiHua(direction: CrossSiHuaDirection): number {
  let delta = 0;
  for (const hit of direction.hits) {
    const pal = hit.palaceName;
    if (hit.siHua === '禄') {
      if (CORE_RELATIONSHIP_PALACES.has(pal)) delta += 10;
      else if (KEY_RELATIONAL_PALACES.has(pal) || pal === '官禄') delta += 6;
      if (hit.targetNatalSiHua === '禄') delta += 4;
    } else if (hit.siHua === '科') {
      if (CORE_RELATIONSHIP_PALACES.has(pal)) delta += 7;
      else if (KEY_RELATIONAL_PALACES.has(pal) || pal === '官禄') delta += 4;
    } else if (hit.siHua === '权') {
      if (pal === '命宫' || pal === '夫妻') delta += 2;
      else if (pal === '财帛' || pal === '官禄') delta += 3;
    } else if (hit.siHua === '忌') {
      if (pal === '夫妻') delta -= 14;
      else if (pal === '命宫') delta -= 12;
      else if (pal === '福德') delta -= 10;
      else if (hit.clashesPalaceName === '夫妻') delta -= 10;
      else if (hit.clashesPalaceName === '命宫') delta -= 9;
      else if (hit.clashesPalaceName === '福德') delta -= 7;
      else if (KEY_RELATIONAL_PALACES.has(pal)) delta -= 7;

      if (hit.targetNatalSiHua === '忌') delta -= 8;
    }
  }
  return delta;
}

function evaluateDaXianFavorability(chart: ZiweiChart): number {
  if (chart.currentDaXianIndex < 0 || chart.currentDaXianIndex >= chart.daXians.length) return 0;
  const dxSiHua = getDaXianSiHua(chart, chart.currentDaXianIndex);
  if (!dxSiHua) return 0;

  let delta = 0;
  const luHit = findStarInPalaces(chart, dxSiHua.transforms['禄']);
  if (luHit && CORE_RELATIONSHIP_PALACES.has(luHit.palace.name)) delta += 5;

  const keHit = findStarInPalaces(chart, dxSiHua.transforms['科']);
  if (keHit && CORE_RELATIONSHIP_PALACES.has(keHit.palace.name)) delta += 3;

  const jiHit = findStarInPalaces(chart, dxSiHua.transforms['忌']);
  if (jiHit) {
    const opp = findPalaceByBranch(chart, jiHit.palace.branch + 6);
    if (CORE_RELATIONSHIP_PALACES.has(jiHit.palace.name) || (opp && CORE_RELATIONSHIP_PALACES.has(opp.name))) {
      delta -= 6;
    }
  }
  return delta;
}

function mapScoreToLevel(score: number): { stars: 1 | 2 | 3 | 4 | 5; level: SynastryLevel } {
  if (score >= 85) return { stars: 5, level: '五星' };
  if (score >= 70) return { stars: 4, level: '四星' };
  if (score >= 55) return { stars: 3, level: '三星' };
  if (score >= 40) return { stars: 2, level: '二星' };
  return { stars: 1, level: '一星' };
}

function computeSynastryScore(
  chartA: ZiweiChart,
  chartB: ZiweiChart,
  resonance: PalaceResonanceAnalysis,
  crossSiHua: CrossSiHuaAnalysis,
): {
  score: number;
  stars: 1 | 2 | 3 | 4 | 5;
  level: SynastryLevel;
  levelCriteria: string;
  dimensions: SynastryDimensions;
} {
  // 1. Palace Resonance (0..100) — strictly symmetric in A/B
  let resScore = 55;
  if (resonance.tianZuoZhiHe === 'mutual') resScore += 24;
  else if (resonance.tianZuoZhiHe === 'single') resScore += 13;
  else if (resonance.tianZuoZhiHe === 'sanfang') resScore += 7;

  if (resonance.aFuqiInBMingSanFang.length > 0 && resonance.bFuqiInAMingSanFang.length > 0) {
    resScore += 5;
  }

  const { mingVsMing, fuqiVsFuqi, aMingVsBFuqi, bMingVsAFuqi, fudeVsFude } = resonance.branchRelations;
  resScore += scoreBranchPair(mingVsMing, 6, 4, 8);
  resScore += scoreBranchPair(fuqiVsFuqi, 6, 4, 8);
  resScore += scoreBranchPair(aMingVsBFuqi, 6, 6, 7);
  resScore += scoreBranchPair(bMingVsAFuqi, 6, 6, 7);
  resScore += scoreBranchPair(fudeVsFude, 4, 2, 5);

  if (resonance.elementRelation === 'generating') resScore += 6;
  else if (resonance.elementRelation === 'same') resScore += 4;
  else resScore -= 4;

  for (const pairing of resonance.classicStarPairings) {
    if (pairing.starsRating === 5) resScore += 12;
    else if (pairing.starsRating === 4) resScore += 7;
    else if (pairing.starsRating === 3) resScore += 3;
    else if (pairing.starsRating === 2) resScore -= 7;
    else resScore -= 13;
  }
  const palaceResonance = clampScore(resScore);

  // 2. Cross SiHua Harmony (0..100) — strictly symmetric in A/B
  let sihuaScore =
    60 +
    scoreDirectionalCrossSiHua(crossSiHua.aToB) +
    scoreDirectionalCrossSiHua(crossSiHua.bToA);
  if (crossSiHua.bondType === 'mutual_blessing') sihuaScore += 6;
  if (crossSiHua.hasMutualHuaJi) sihuaScore -= 10;
  const crossSiHuaHarmony = clampScore(sihuaScore);

  // 3. Spouse Palace Stability (0..100) — symmetric average
  const spousePalaceStability = clampScore(
    (resonance.assessmentA.fuqiStabilityScore + resonance.assessmentB.fuqiStabilityScore) / 2,
  );

  // 4. Spirit & DaXian Fortune (0..100) — strictly symmetric
  const baseFudeAvg = (resonance.assessmentA.fudeScore + resonance.assessmentB.fudeScore) / 2;
  const fudeBranchDelta = scoreBranchPair(fudeVsFude, 5, 3, 6);
  const dxSyncDelta = evaluateDaXianFavorability(chartA) + evaluateDaXianFavorability(chartB);
  const spiritAndFortune = clampScore(baseFudeAvg + fudeBranchDelta + dxSyncDelta);

  let total = clampScore(
    palaceResonance * 0.25 +
      crossSiHuaHarmony * 0.30 +
      spousePalaceStability * 0.25 +
      spiritAndFortune * 0.20,
  );

  // Safety guards aligned with HEMING_SCORE_CRITERIA
  const hasSanXiong = resonance.assessmentA.hasSanXiongCombo || resonance.assessmentB.hasSanXiongCombo;
  if (hasSanXiong && crossSiHua.hasMutualHuaJi) {
    total = Math.min(total, 52);
  } else if (crossSiHua.hasMutualHuaJi) {
    total = Math.min(total, 69);
  }
  if (spousePalaceStability < 42 && crossSiHuaHarmony < 35) {
    total = Math.min(total, 39);
  }

  const { stars, level } = mapScoreToLevel(total);
  return {
    score: total,
    stars,
    level,
    levelCriteria: HEMING_SCORE_CRITERIA[level],
    dimensions: {
      palaceResonance,
      crossSiHuaHarmony,
      spousePalaceStability,
      spiritAndFortune,
    },
  };
}

// ─── Structured Highlights & Paywall Friction Points ─────────────────────────

function appendResonanceFindings(
  personA: PersonSynastrySummary,
  personB: PersonSynastrySummary,
  resonance: PalaceResonanceAnalysis,
  highlights: SynastryHighlight[],
  frictionPoints: SynastryFrictionPoint[],
): void {
  if (resonance.tianZuoZhiHe === 'mutual') {
    const stars = Array.from(new Set([...resonance.aFuqiMatchesBMing, ...resonance.bFuqiMatchesAMing]));
    highlights.push({
      id: 'res-mutual-ming-fuqi',
      code: 'MUTUAL_MING_FUQI_MATCH',
      scope: 'natal',
      category: 'mutual_resonance',
      direction: 'mutual',
      polarity: 'positive',
      priority: 100,
      palaces: ['命宫', '夫妻'],
      branches: [personA.mingGong.branch, personB.mingGong.branch],
      stars,
      facts: {
        tier: 'mutual',
        aFuqiStars: resonance.aFuqiMatchesBMing.join(','),
        bFuqiStars: resonance.bFuqiMatchesAMing.join(','),
      },
    });
  } else if (resonance.tianZuoZhiHe === 'single') {
    const dir: FindingDirection = resonance.aFuqiMatchesBMing.length > 0 ? 'A_to_B' : 'B_to_A';
    const stars = dir === 'A_to_B' ? resonance.aFuqiMatchesBMing : resonance.bFuqiMatchesAMing;
    highlights.push({
      id: `res-single-ming-fuqi-${dir}`,
      code: 'SINGLE_MING_FUQI_MATCH',
      scope: 'natal',
      category: 'mutual_resonance',
      direction: dir,
      polarity: 'positive',
      priority: 88,
      palaces: ['命宫', '夫妻'],
      branches: [personA.fuqiGong.branch, personB.fuqiGong.branch],
      stars,
      facts: { tier: 'single', matchedStars: stars.join(',') },
    });
  } else if (resonance.tianZuoZhiHe === 'sanfang') {
    const stars = Array.from(new Set([...resonance.aFuqiInBMingSanFang, ...resonance.bFuqiInAMingSanFang]));
    highlights.push({
      id: 'res-sanfang-ming-fuqi',
      code: 'MING_SANFANG_FUQI_MATCH',
      scope: 'natal',
      category: 'mutual_resonance',
      direction: 'mutual',
      polarity: 'positive',
      priority: 72,
      palaces: ['命宫', '夫妻', '迁移', '财帛', '官禄'],
      branches: [personA.mingGong.branch, personB.mingGong.branch],
      stars,
      facts: { tier: 'sanfang' },
    });
  }

  for (const pairing of resonance.classicStarPairings) {
    const combinedStars = Array.from(new Set([...pairing.starsA, ...pairing.starsB]));
    if (pairing.polarity !== 'negative') {
      highlights.push({
        id: `pair-${pairing.code}`,
        code: `STAR_PAIRING_${pairing.code}`,
        scope: 'natal',
        category: 'mutual_resonance',
        direction: 'mutual',
        polarity: pairing.polarity,
        priority: 70 + pairing.starsRating * 3,
        palaces: ['命宫'],
        branches: [personA.mingGong.branch, personB.mingGong.branch],
        stars: combinedStars,
        facts: { rating: pairing.starsRating, code: pairing.code },
      });
    } else {
      frictionPoints.push({
        id: `pair-risk-${pairing.code}`,
        code: `STAR_PAIRING_${pairing.code}`,
        scope: 'natal',
        category: 'mutual_resonance',
        direction: 'mutual',
        severity: pairing.starsRating === 1 ? 'high' : 'medium',
        priority: pairing.starsRating === 1 ? 86 : 74,
        palaces: ['命宫'],
        branches: [personA.mingGong.branch, personB.mingGong.branch],
        stars: combinedStars,
        facts: { rating: pairing.starsRating, code: pairing.code },
      });
    }
  }

  if (resonance.elementRelation === 'generating' || resonance.elementRelation === 'same') {
    highlights.push({
      id: `elem-${resonance.elementRelation}`,
      code: resonance.elementRelation === 'generating' ? 'WUXING_GENERATING' : 'WUXING_SAME',
      scope: 'natal',
      category: 'mutual_resonance',
      direction: 'mutual',
      polarity: 'positive',
      priority: 62,
      palaces: ['命宫'],
      branches: [personA.mingGong.branch, personB.mingGong.branch],
      stars: [],
      facts: {
        elementA: personA.wuxingElement,
        elementB: personB.wuxingElement,
        relation: resonance.elementRelation,
      },
    });
  }
}

function appendBranchFindings(
  resonance: PalaceResonanceAnalysis,
  highlights: SynastryHighlight[],
  frictionPoints: SynastryFrictionPoint[],
): void {
  const branchEntries: Array<{
    key: string;
    rel: BranchRelationDetail;
    palaces: string[];
    direction: FindingDirection;
    severityIfClash: FrictionSeverity;
  }> = [
    {
      key: 'aMing_bFuqi',
      rel: resonance.branchRelations.aMingVsBFuqi,
      palaces: ['命宫', '夫妻'],
      direction: 'A_to_B',
      severityIfClash: 'high',
    },
    {
      key: 'bMing_aFuqi',
      rel: resonance.branchRelations.bMingVsAFuqi,
      palaces: ['命宫', '夫妻'],
      direction: 'B_to_A',
      severityIfClash: 'high',
    },
    {
      key: 'ming_ming',
      rel: resonance.branchRelations.mingVsMing,
      palaces: ['命宫'],
      direction: 'mutual',
      severityIfClash: 'medium',
    },
    {
      key: 'fuqi_fuqi',
      rel: resonance.branchRelations.fuqiVsFuqi,
      palaces: ['夫妻'],
      direction: 'mutual',
      severityIfClash: 'high',
    },
    {
      key: 'fude_fude',
      rel: resonance.branchRelations.fudeVsFude,
      palaces: ['福德'],
      direction: 'mutual',
      severityIfClash: 'medium',
    },
  ];

  for (const entry of branchEntries) {
    const { rel } = entry;
    if (rel.relation === 'liuhe' || rel.relation === 'sanhe' || rel.relation === 'same') {
      highlights.push({
        id: `branch-${entry.key}-${rel.relation}`,
        code: `BRANCH_${rel.relation.toUpperCase()}`,
        scope: 'branch',
        category: 'branch_relation',
        direction: entry.direction,
        polarity: 'positive',
        priority: rel.relation === 'liuhe' ? 78 : 73,
        palaces: entry.palaces,
        branches: [rel.branchA, rel.branchB],
        stars: [],
        facts: {
          pair: entry.key,
          relation: rel.relation,
          branchA: rel.branchNameA,
          branchB: rel.branchNameB,
        },
      });
    } else if (rel.relation === 'liuchong') {
      frictionPoints.push({
        id: `branch-${entry.key}-liuchong`,
        code: 'BRANCH_LIUCHONG',
        scope: 'branch',
        category: 'branch_relation',
        direction: entry.direction,
        severity: entry.severityIfClash,
        priority: entry.severityIfClash === 'high' ? 84 : 70,
        palaces: entry.palaces,
        branches: [rel.branchA, rel.branchB],
        stars: [],
        facts: {
          pair: entry.key,
          diff: rel.diff,
          branchA: rel.branchNameA,
          branchB: rel.branchNameB,
        },
      });
    }
  }
}

function appendCrossSiHuaFindings(
  personA: PersonSynastrySummary,
  personB: PersonSynastrySummary,
  crossSiHua: CrossSiHuaAnalysis,
  highlights: SynastryHighlight[],
  frictionPoints: SynastryFrictionPoint[],
): void {
  const additionalList: CrossSiHuaHit[] = [
    ...Object.values(crossSiHua.additionalDirections.aToB).flatMap((d) => d?.hits ?? []),
    ...Object.values(crossSiHua.additionalDirections.bToA).flatMap((d) => d?.hits ?? []),
  ];
  const allDirectionalHits = [...crossSiHua.aToB.hits, ...crossSiHua.bToA.hits, ...additionalList];

  for (const hit of allDirectionalHits) {
    const dir: FindingDirection = hit.from === 'A' ? 'A_to_B' : 'B_to_A';
    const isExtraStem = hit.stemSource !== 'yearStem';
    const idPrefix = isExtraStem ? `cross-${dir}-${hit.stemSource}` : `cross-${dir}`;
    const priorityOffset = isExtraStem ? -10 : 0;

    if (hit.siHua === '禄' && hit.isKeyRelationalHit) {
      highlights.push({
        id: `${idPrefix}-lu-${hit.palaceName}`,
        code: `CROSS_LU_INTO_${palaceCode(hit.palaceName)}`,
        scope: 'cross',
        category: 'cross_sihua',
        direction: dir,
        polarity: 'positive',
        priority: (CORE_RELATIONSHIP_PALACES.has(hit.palaceName) ? 94 : 80) + priorityOffset,
        palaces: [hit.palaceName],
        branches: [hit.branch],
        stars: [hit.starName],
        siHua: '禄',
        facts: {
          stem: hit.stemName,
          stemSource: hit.stemSource,
          targetPalace: hit.palaceName,
          targetNatalSiHua: hit.targetNatalSiHua ?? 'none',
        },
      });
    } else if (hit.siHua === '科' && hit.isKeyRelationalHit) {
      highlights.push({
        id: `${idPrefix}-ke-${hit.palaceName}`,
        code: `CROSS_KE_INTO_${palaceCode(hit.palaceName)}`,
        scope: 'cross',
        category: 'cross_sihua',
        direction: dir,
        polarity: 'positive',
        priority: (CORE_RELATIONSHIP_PALACES.has(hit.palaceName) ? 82 : 68) + priorityOffset,
        palaces: [hit.palaceName],
        branches: [hit.branch],
        stars: [hit.starName],
        siHua: '科',
        facts: { stem: hit.stemName, stemSource: hit.stemSource, targetPalace: hit.palaceName },
      });
    } else if (hit.siHua === '权' && (hit.palaceName === '夫妻' || hit.palaceName === '命宫')) {
      frictionPoints.push({
        id: `${idPrefix}-quan-${hit.palaceName}`,
        code: 'CROSS_QUAN_DOMINANCE',
        scope: 'cross',
        category: 'cross_sihua',
        direction: dir,
        severity: 'watch',
        priority: 58 + priorityOffset,
        palaces: [hit.palaceName],
        branches: [hit.branch],
        stars: [hit.starName],
        siHua: '权',
        facts: { stem: hit.stemName, stemSource: hit.stemSource, targetPalace: hit.palaceName },
      });
    } else if (hit.siHua === '忌' && hit.isKeyRelationalHit) {
      const isCore = CORE_RELATIONSHIP_PALACES.has(hit.palaceName);
      const isClashCore = Boolean(hit.clashesPalaceName);
      const severity: FrictionSeverity =
        hit.palaceName === '夫妻' ||
        hit.palaceName === '命宫' ||
        isClashCore ||
        hit.targetNatalSiHua === '忌'
          ? 'high'
          : 'medium';

      frictionPoints.push({
        id: `${idPrefix}-ji-${hit.palaceName}`,
        code: isClashCore ? 'CROSS_JI_CLASH_CORE_PALACE' : 'CROSS_JI_INTO_KEY_PALACE',
        scope: 'cross',
        category: 'cross_sihua',
        direction: dir,
        severity,
        priority: (isCore || isClashCore ? (hit.targetNatalSiHua === '忌' ? 98 : 92) : 76) + priorityOffset,
        palaces: hit.clashesPalaceName ? [hit.palaceName, hit.clashesPalaceName] : [hit.palaceName],
        branches: [hit.branch],
        stars: [hit.starName],
        siHua: '忌',
        facts: {
          stem: hit.stemName,
          stemSource: hit.stemSource,
          targetPalace: hit.palaceName,
          clashesPalace: hit.clashesPalaceName ?? '',
          doubleHuaJi: hit.targetNatalSiHua === '忌',
        },
      });
    }
  }

  if (crossSiHua.hasMutualHuaJi) {
    frictionPoints.push({
      id: 'cross-mutual-huaji',
      code: 'MUTUAL_HUAJI_ENTANGLEMENT',
      scope: 'cross',
      category: 'cross_sihua',
      direction: 'mutual',
      severity: 'high',
      priority: 99,
      palaces: ['命宫', '夫妻', '福德'],
      branches: [personA.fuqiGong.branch, personB.fuqiGong.branch],
      stars: [
        crossSiHua.aToB.transforms['忌'],
        crossSiHua.bToA.transforms['忌'],
      ].filter(Boolean),
      siHua: '忌',
      facts: {
        aJiStar: crossSiHua.aToB.transforms['忌'],
        bJiStar: crossSiHua.bToA.transforms['忌'],
      },
    });
  }
}

function appendPartnerNatalFindings(
  summary: PersonSynastrySummary,
  assess: PartnerSpouseAssessment,
  highlights: SynastryHighlight[],
  frictionPoints: SynastryFrictionPoint[],
): void {
  const dir: FindingDirection = summary.label;
  if (assess.isEmpty) {
    frictionPoints.push({
      id: `natal-${dir}-fuqi-empty`,
      code: 'FUQI_EMPTY_BORROWED',
      scope: 'natal',
      category: 'spouse_palace',
      direction: dir,
      severity: 'watch',
      priority: 60,
      palaces: assess.borrowedFromName ? ['夫妻', assess.borrowedFromName] : ['夫妻'],
      branches: [assess.palaceBranch],
      stars: [...assess.borrowedStars],
      facts: {
        person: dir,
        borrowedFrom: assess.borrowedFromName ?? '',
        borrowedStars: assess.borrowedStars.join(','),
      },
    });
  }

  if (assess.hasSanXiongCombo) {
    frictionPoints.push({
      id: `natal-${dir}-fuqi-sanxiong`,
      code: 'FUQI_SANXIONG_COMBO',
      scope: 'natal',
      category: 'spouse_palace',
      direction: dir,
      severity: 'high',
      priority: 95,
      palaces: ['夫妻'],
      branches: [assess.palaceBranch],
      stars: [...assess.effectiveMajorStars],
      facts: { person: dir, isBorrowed: assess.isEmpty },
    });
  }

  if (assess.hasWuQuShaPoRisk) {
    frictionPoints.push({
      id: `natal-${dir}-fuqi-wuqu-shapo`,
      code: 'FUQI_WUQU_SHAPO_SHA',
      scope: 'natal',
      category: 'spouse_palace',
      direction: dir,
      severity: 'high',
      priority: 87,
      palaces: ['夫妻'],
      branches: [assess.palaceBranch],
      stars: [...assess.effectiveMajorStars, ...assess.shaStarsInFuqi],
      facts: { person: dir },
    });
  }

  for (const sh of assess.siHuaAssessments) {
    if (sh.siHua === '禄' && (sh.source === 'direct' || sh.source === 'borrowed')) {
      highlights.push({
        id: `natal-${dir}-fuqi-lu-${sh.starName}`,
        code: 'FUQI_NATAL_HUALU',
        scope: 'natal',
        category: 'spouse_palace',
        direction: dir,
        polarity: 'positive',
        priority: 75,
        palaces: ['夫妻'],
        branches: [assess.palaceBranch],
        stars: [sh.starName],
        siHua: '禄',
        facts: { person: dir, source: sh.source },
      });
    } else if (sh.siHua === '忌' && sh.source !== 'self_sihua') {
      frictionPoints.push({
        id: `natal-${dir}-fuqi-ji-${sh.source}-${sh.starName}`,
        code: sh.source === 'opposite_clash' ? 'FUQI_OPPOSITE_HUAJI_CLASH' : 'FUQI_NATAL_HUAJI',
        scope: 'natal',
        category: 'spouse_palace',
        direction: dir,
        severity: 'high',
        priority: 90,
        palaces: sh.source === 'opposite_clash' ? ['夫妻', '官禄'] : ['夫妻'],
        branches: [assess.palaceBranch],
        stars: [sh.starName],
        siHua: '忌',
        facts: { person: dir, source: sh.source },
      });
    } else if (sh.source === 'self_sihua' && (sh.siHua === '忌' || sh.siHua === '禄')) {
      frictionPoints.push({
        id: `natal-${dir}-fuqi-self-${sh.siHua}-${sh.starName}`,
        code: sh.siHua === '忌' ? 'FUQI_SELF_HUAJI' : 'FUQI_SELF_HUALU',
        scope: 'natal',
        category: 'spouse_palace',
        direction: dir,
        severity: sh.siHua === '忌' ? 'high' : 'watch',
        priority: sh.siHua === '忌' ? 83 : 56,
        palaces: ['夫妻'],
        branches: [assess.palaceBranch],
        stars: [sh.starName],
        siHua: sh.siHua,
        facts: { person: dir },
      });
    }
  }

  if (assess.shaStarsInFuqi.length >= 2) {
    frictionPoints.push({
      id: `natal-${dir}-fuqi-sha-cluster`,
      code: 'FUQI_SHA_CONCENTRATION',
      scope: 'natal',
      category: 'spouse_palace',
      direction: dir,
      severity: assess.shaStarsInFuqi.length >= 3 ? 'high' : 'medium',
      priority: 79,
      palaces: ['夫妻'],
      branches: [assess.palaceBranch],
      stars: [...assess.shaStarsInFuqi],
      facts: { person: dir, shaCount: assess.shaStarsInFuqi.length },
    });
  }

  if (summary.sunMoonCheck?.status === 'risk') {
    frictionPoints.push({
      id: `natal-${dir}-sunmoon-${summary.sunMoonCheck.focusStar}`,
      code: summary.sunMoonCheck.focusStar === '太阳' ? 'FEMALE_SUN_RISK' : 'MALE_MOON_RISK',
      scope: 'natal',
      category: 'sun_moon',
      direction: dir,
      severity: summary.sunMoonCheck.siHua === '忌' ? 'high' : 'medium',
      priority: summary.sunMoonCheck.siHua === '忌' ? 89 : 66,
      palaces: [summary.sunMoonCheck.palaceName],
      branches: [summary.sunMoonCheck.branch],
      stars: [summary.sunMoonCheck.focusStar],
      siHua: summary.sunMoonCheck.siHua,
      facts: {
        person: dir,
        brightness: summary.sunMoonCheck.brightnessRaw ?? summary.sunMoonCheck.brightness ?? '',
        hasHuaJi: summary.sunMoonCheck.siHua === '忌',
      },
    });
  }

  const romanceAux = assess.marriageAuxStars.filter((m) => m.category === 'romance');
  if (romanceAux.length > 0 && romanceAux.some((m) => m.starName === '红鸾' || m.starName === '天喜')) {
    highlights.push({
      id: `natal-${dir}-marriage-lucky`,
      code: 'NATAL_HONGLUAN_TIANXI',
      scope: 'natal',
      category: 'marriage_star',
      direction: dir,
      polarity: 'positive',
      priority: 65,
      palaces: Array.from(new Set(romanceAux.map((m) => m.palaceName))),
      branches: [assess.palaceBranch],
      stars: Array.from(new Set(romanceAux.map((m) => m.starName))),
      facts: { person: dir },
    });
  }

  const lonelyAux = assess.marriageAuxStars.filter((m) => m.palaceName === '夫妻' && m.category === 'loneliness');
  if (lonelyAux.length > 0) {
    frictionPoints.push({
      id: `natal-${dir}-fuqi-lonely-aux`,
      code: 'FUQI_LONELY_AUX_STARS',
      scope: 'natal',
      category: 'marriage_star',
      direction: dir,
      severity: 'medium',
      priority: 67,
      palaces: ['夫妻'],
      branches: [assess.palaceBranch],
      stars: lonelyAux.map((m) => m.starName),
      facts: { person: dir },
    });
  }
}

function appendAnnualFindings(
  annualOverlay: AnnualSynastryOverlay,
  highlights: SynastryHighlight[],
  frictionPoints: SynastryFrictionPoint[],
): void {
  if (annualOverlay.isSharedBlessingYear) {
    highlights.push({
      id: `annual-${annualOverlay.targetYear}-shared-blessing`,
      code: 'ANNUAL_SHARED_BLESSING',
      scope: 'annual',
      category: 'annual_overlay',
      direction: 'mutual',
      polarity: 'positive',
      priority: 91,
      palaces: ['命宫', '夫妻', '福德'],
      branches: [annualOverlay.yearBranch],
      stars: [annualOverlay.liuNianTransforms['禄']],
      siHua: '禄',
      facts: { year: annualOverlay.targetYear },
    });
  }
  if (annualOverlay.isSharedTensionYear) {
    frictionPoints.push({
      id: `annual-${annualOverlay.targetYear}-shared-tension`,
      code: 'ANNUAL_SHARED_TENSION',
      scope: 'annual',
      category: 'annual_overlay',
      direction: 'mutual',
      severity: 'high',
      priority: 96,
      palaces: ['命宫', '夫妻', '福德'],
      branches: [annualOverlay.yearBranch],
      stars: [annualOverlay.liuNianTransforms['忌']],
      siHua: '忌',
      facts: { year: annualOverlay.targetYear },
    });
  }

  for (const partner of [annualOverlay.partnerA, annualOverlay.partnerB]) {
    for (const hit of partner.liuNianSiHuaHits) {
      if (!hit.hitsRelationshipZone) continue;
      if (hit.siHua === '禄' && CORE_RELATIONSHIP_PALACES.has(hit.palaceName)) {
        highlights.push({
          id: `annual-${annualOverlay.targetYear}-${partner.label}-lu-${hit.palaceName}`,
          code: 'ANNUAL_HUALU_RELATIONSHIP',
          scope: 'annual',
          category: 'annual_overlay',
          direction: partner.label,
          polarity: 'positive',
          priority: 81,
          palaces: [hit.palaceName],
          branches: [hit.branch],
          stars: [hit.starName],
          siHua: '禄',
          facts: { year: annualOverlay.targetYear, person: partner.label },
        });
      } else if (hit.siHua === '忌') {
        const severity: FrictionSeverity =
          hit.palaceName === '夫妻' ||
          hit.palaceName === '命宫' ||
          Boolean(hit.clashesPalaceName) ||
          hit.doublesNatalHuaJi
            ? 'high'
            : 'medium';
        frictionPoints.push({
          id: `annual-${annualOverlay.targetYear}-${partner.label}-ji-${hit.palaceName}`,
          code: hit.clashesPalaceName ? 'ANNUAL_HUAJI_CLASH' : 'ANNUAL_HUAJI_HIT',
          scope: 'annual',
          category: 'annual_overlay',
          direction: partner.label,
          severity,
          priority: severity === 'high' ? 91 : 72,
          palaces: hit.clashesPalaceName ? [hit.palaceName, hit.clashesPalaceName] : [hit.palaceName],
          branches: [hit.branch],
          stars: [hit.starName],
          siHua: '忌',
          facts: {
            year: annualOverlay.targetYear,
            person: partner.label,
            doublesNatalHuaJi: hit.doublesNatalHuaJi,
            clashesPalace: hit.clashesPalaceName ?? '',
          },
        });
      }
    }

    if (partner.hongLuanHitPalace || partner.tianXiHitPalace) {
      highlights.push({
        id: `annual-${annualOverlay.targetYear}-${partner.label}-hongluan-tianxi`,
        code: 'ANNUAL_HONGLUAN_TIANXI',
        scope: 'annual',
        category: 'annual_overlay',
        direction: partner.label,
        polarity: 'positive',
        priority: 77,
        palaces: [partner.hongLuanHitPalace, partner.tianXiHitPalace].filter(
          (v): v is string => Boolean(v),
        ),
        branches: [annualOverlay.hongLuanBranch, annualOverlay.tianXiBranch],
        stars: ['红鸾', '天喜'],
        facts: { year: annualOverlay.targetYear, person: partner.label },
      });
    }
  }
}

function buildFindings(
  personA: PersonSynastrySummary,
  personB: PersonSynastrySummary,
  crossSiHua: CrossSiHuaAnalysis,
  resonance: PalaceResonanceAnalysis,
  annualOverlay?: AnnualSynastryOverlay,
): {
  highlights: SynastryHighlight[];
  frictionPoints: SynastryFrictionPoint[];
} {
  const highlights: SynastryHighlight[] = [];
  const frictionPoints: SynastryFrictionPoint[] = [];

  appendResonanceFindings(personA, personB, resonance, highlights, frictionPoints);
  appendBranchFindings(resonance, highlights, frictionPoints);
  appendCrossSiHuaFindings(personA, personB, crossSiHua, highlights, frictionPoints);
  appendPartnerNatalFindings(personA, resonance.assessmentA, highlights, frictionPoints);
  appendPartnerNatalFindings(personB, resonance.assessmentB, highlights, frictionPoints);
  if (annualOverlay) appendAnnualFindings(annualOverlay, highlights, frictionPoints);

  highlights.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  frictionPoints.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

  return { highlights, frictionPoints };
}

// ─── Public Entry Points ─────────────────────────────────────────────────────

/**
 * Deterministic Zero-LLM Zi Wei Dou Shu synastry analyzer.
 */
export function analyzeSynastry(
  chartA: ZiweiChart,
  chartB: ZiweiChart,
  options: SynastryOptions = {},
): SynastryResult {
  const personA = buildPersonSummary(chartA, 'A');
  const personB = buildPersonSummary(chartB, 'B');
  const crossSources = options.crossStemSources ?? ['yearStem'];
  const crossSiHua = analyzeCrossSiHua(chartA, chartB, crossSources);
  const palaceResonance = analyzePalaceResonance(chartA, chartB, personA, personB);
  const annualOverlay =
    options.targetYear !== undefined ? evaluateAnnualOverlay(chartA, chartB, options.targetYear) : undefined;

  const scoring = computeSynastryScore(chartA, chartB, palaceResonance, crossSiHua);
  const { highlights, frictionPoints } = buildFindings(
    personA,
    personB,
    crossSiHua,
    palaceResonance,
    annualOverlay,
  );

  return {
    personA,
    personB,
    crossSiHua,
    palaceResonance,
    annualOverlay,
    score: scoring.score,
    stars: scoring.stars,
    level: scoring.level,
    levelCriteria: scoring.levelCriteria,
    dimensions: scoring.dimensions,
    highlights,
    frictionPoints,
  };
}

function compactPalaceForPayload(pal: PersonPalaceBrief, includeStem: boolean): CompactPromptPalace {
  const sh = pal.natalSiHua.map((x) => `${x.starName}:${x.siHua}`);
  const self = pal.selfSiHua.map((x) => `${x.starName}:${x.siHua}`);
  return {
    br: pal.branchName,
    ...(includeStem ? { st: pal.stemName } : {}),
    ...(pal.isEmpty && pal.borrowedFromName ? { from: pal.borrowedFromName } : {}),
    stars: pal.effectiveMajorStars,
    ...(pal.shaStars.length > 0 ? { sha: pal.shaStars } : {}),
    ...(pal.luckyStars.length > 0 ? { lucky: pal.luckyStars } : {}),
    ...(sh.length > 0 ? { sh } : {}),
    ...(self.length > 0 ? { self } : {}),
  };
}

function compactPersonForPayload(p: PersonSynastrySummary): CompactPromptPerson {
  return {
    yg: p.yinYangGender,
    ju: p.wuxingJuName,
    mz: p.mingZhu,
    sz: p.shenZhu,
    age: p.currentAge,
    ming: compactPalaceForPayload(p.mingGong, true),
    fuqi: compactPalaceForPayload(p.fuqiGong, true),
    fude: compactPalaceForPayload(p.fudeGong, false),
    ...(p.sunMoonCheck
      ? {
          sunMoon: {
            star: p.sunMoonCheck.focusStar,
            br: p.sunMoonCheck.brightnessRaw ?? p.sunMoonCheck.brightness,
            pal: p.sunMoonCheck.palaceName,
            ...(p.sunMoonCheck.siHua ? { sh: p.sunMoonCheck.siHua } : {}),
            status: p.sunMoonCheck.status,
          },
        }
      : {}),
    ...(p.currentDaXianPalaceName
      ? {
          dx: {
            pal: p.currentDaXianPalaceName,
            ...(p.currentDaXianBranch !== undefined
              ? { br: BRANCHES[normalizeBranch(p.currentDaXianBranch)] }
              : {}),
          },
        }
      : {}),
  };
}

function compactCrossHits(hits: readonly CrossSiHuaHit[]): string[] {
  return hits.map((h) => {
    const clashPart = h.clashesPalaceName ? `(冲${h.clashesPalaceName})` : '';
    const natalPart = h.targetNatalSiHua ? `[本命${h.targetNatalSiHua}]` : '';
    return `${h.siHua}:${h.starName}->${h.palaceName}${clashPart}${natalPart}`;
  });
}

function formatAnnualHits(hits: readonly AnnualSiHuaHit[]): string[] {
  return hits
    .filter((h) => h.hitsRelationshipZone)
    .map((h) => `${h.siHua}:${h.starName}@${h.palaceName}${h.clashesPalaceName ? `->冲${h.clashesPalaceName}` : ''}`);
}

/**
 * Build a compact JSON-serializable payload (< ~3 KB) for LLM backend consumption.
 */
export function buildSynastryPromptPayload(
  chartA: ZiweiChart,
  chartB: ZiweiChart,
  analysis?: SynastryResult,
): SynastryPromptPayload {
  const result = analysis ?? analyzeSynastry(chartA, chartB);
  const { personA, personB, crossSiHua, palaceResonance, annualOverlay } = result;

  const fuqiInsights: Record<string, string> = {};
  for (const sa of [...palaceResonance.assessmentA.starAssessments, ...palaceResonance.assessmentB.starAssessments]) {
    if (!(sa.starName in fuqiInsights)) {
      fuqiInsights[sa.starName] = sa.knowledge.summary;
    }
  }

  return {
    version: 1,
    score: {
      total: result.score,
      stars: result.stars,
      level: result.level,
      dims: result.dimensions,
    },
    personA: compactPersonForPayload(personA),
    personB: compactPersonForPayload(personB),
    crossSiHua: {
      bond: crossSiHua.bondType,
      mutualJi: crossSiHua.hasMutualHuaJi,
      aToB: compactCrossHits(crossSiHua.aToB.hits),
      bToA: compactCrossHits(crossSiHua.bToA.hits),
    },
    resonance: {
      tianZuo: palaceResonance.tianZuoZhiHe,
      element: palaceResonance.elementRelation,
      branches: {
        mm: palaceResonance.branchRelations.mingVsMing.relation,
        ff: palaceResonance.branchRelations.fuqiVsFuqi.relation,
        afbm: palaceResonance.branchRelations.aMingVsBFuqi.relation,
        bfma: palaceResonance.branchRelations.bMingVsAFuqi.relation,
        fd: palaceResonance.branchRelations.fudeVsFude.relation,
      },
      pairs: palaceResonance.classicStarPairings.map((p) => p.code),
    },
    fuqiInsights,
    ...(annualOverlay
      ? {
          annual: {
            year: annualOverlay.targetYear,
            gz: `${annualOverlay.yearStemName}${annualOverlay.yearBranchName}`,
            outlook: annualOverlay.outlook,
            score: annualOverlay.yearScore,
            aLnPal: annualOverlay.partnerA.liuNianMingPalaceName,
            bLnPal: annualOverlay.partnerB.liuNianMingPalaceName,
            aHits: formatAnnualHits(annualOverlay.partnerA.liuNianSiHuaHits),
            bHits: formatAnnualHits(annualOverlay.partnerB.liuNianSiHuaHits),
          },
        }
      : {}),
    highlights: result.highlights.slice(0, 3).map((h) => ({
      code: h.code,
      dir: h.direction,
      pal: h.palaces,
      stars: h.stars,
      ...(h.siHua ? { sh: h.siHua } : {}),
    })),
    frictionPoints: result.frictionPoints.slice(0, 4).map((f) => ({
      code: f.code,
      dir: f.direction,
      sev: f.severity,
      pal: f.palaces,
      stars: f.stars,
      ...(f.siHua ? { sh: f.siHua } : {}),
    })),
  };
}
