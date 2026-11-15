/**
 * lib/ziwei/paywall-teasers.ts
 *
 * Pure deterministic Zero-LLM ($0.00) paywall teaser & free-tier presentation
 * builders for both Natal Charts and Synastry (He Ming) compatibility reports.
 *
 * - Consumes `ZiweiChart`, `ChartAnalysisSummary` (`chart-analyzer.ts`),
 *   `Pattern` (`patterns.ts`), and `SynastryResult` (`heming.ts`).
 * - Localizes all output strictly in `'ru' | 'zh' | 'en'` via `i18n.ts`.
 * - Teases detected risks, clashes, and locked-palace hooks without exposing
 *   paid LLM guidance.
 */

import type {
  ChartAnalysisSummary,
  ChartPainPoint,
  PatternSummary,
} from './chart-analyzer';
import {
  generateFreeLifePalaceReading,
  type FreeLifePalaceReading,
} from './db-analysis';
import type {
  BondType,
  SynastryFrictionPoint,
  SynastryHighlight,
  SynastryResult,
} from './heming';
import {
  BOND_TYPE_LABELS,
  normalizeLang,
  PATTERN_LEVEL_LABELS,
  SYNASTRY_LEVEL_LABELS,
  translatePalace,
  translatePattern,
  translateSiHua,
  translateStar,
  type SupportedLang,
} from './i18n';
import type { Pattern } from './patterns';
import type { ZiweiChart } from './types';

// ────────────────── Public Types ──────────────────

export type HemingResult = SynastryResult;
export type PatternResult = readonly (Pattern | PatternSummary)[];

export interface LocalizedPatternItem {
  name: string;
  label: string;
  level: PatternSummary['level'];
  levelLabel: string;
  palaces: string[];
  summary: string;
}

export interface ChartPatternsSummary {
  count: number;
  headline: string;
  items: LocalizedPatternItem[];
}

export type ChartTeaserCategory = ChartPainPoint['category'] | 'volatile_major';

export interface ChartLockedTeaser {
  id: string;
  palaceKey: string;
  palaceName: string;
  category: ChartTeaserCategory;
  severity: ChartPainPoint['severity'];
  stars: string[];
  rawStars: string[];
  hookHeadline: string;
  teaser: string;
  unlockCta: string;
}

export interface ChartPaywallResult {
  lang: SupportedLang;
  cacheKey: string;
  freeLifePalace: FreeLifePalaceReading;
  patterns: ChartPatternsSummary;
  lockedTeasers: ChartLockedTeaser[];
  unlockCta: string;
}

export type SynastryScoreBand =
  | 'elite'
  | 'harmonious'
  | 'balanced'
  | 'challenging'
  | 'volatile';

export interface SynastryLockedTeaser {
  id: string;
  code: string;
  category: SynastryFrictionPoint['category'];
  severity: SynastryFrictionPoint['severity'];
  palaces: string[];
  rawPalaces: string[];
  stars: string[];
  hookHeadline: string;
  teaser: string;
  unlockCta: string;
}

export interface SynastryPaywallResult {
  lang: SupportedLang;
  score: number;
  stars: 1 | 2 | 3 | 4 | 5;
  scoreBand: SynastryScoreBand;
  scoreBandLabel: string;
  levelLabel: string;
  bondType: BondType;
  bondLabel: string;
  overview: string;
  highlightSummaries: string[];
  lockedTeasers: SynastryLockedTeaser[];
  unlockCta: string;
}

// ────────────────── Constants & Dictionaries ──────────────────

const CORE_LOCKED_PALACE_ORDER = [
  '夫妻',
  '财帛',
  '官禄',
  '疾厄',
  '田宅',
  '福德',
  '迁移',
] as const;

const VOLATILE_LOCKED_STARS = new Set<string>(['七杀', '破军']);

const CHART_UNLOCK_CTA: Record<SupportedLang, string> = {
  ru: 'Открыть полный разбор карты и такт удачи',
  zh: '解锁完整命盘深度解析与大限流年策略',
  en: 'Unlock Full Chart Deep Dive & Cycle Timing',
};

const SYNASTRY_UNLOCK_CTA: Record<SupportedLang, string> = {
  ru: 'Открыть полный разбор совместимости и зон трения',
  zh: '解锁完整合盘深度解析与双方化解建议',
  en: 'Unlock Full Synastry Analysis & Compatibility Roadmap',
};

const SCORE_BAND_LABELS: Record<SynastryScoreBand, Record<SupportedLang, string>> = {
  elite: { ru: 'Исключительный резонанс', zh: '五星上等契合', en: 'Exceptional Resonance' },
  harmonious: { ru: 'Сильная гармония', zh: '四星良缘契合', en: 'Strong Harmony' },
  balanced: { ru: 'Сбалансированный союз', zh: '三星互补磨合', en: 'Balanced Potential' },
  challenging: { ru: 'Повышенное трение', zh: '二星波动承压', en: 'High-Friction Bond' },
  volatile: { ru: 'Сложная кармическая связка', zh: '一星强冲预警', en: 'Intense Friction Risk' },
};

// ────────────────── Shared Formatting Helpers ──────────────────

function joinList(items: readonly string[], lang: SupportedLang): string {
  if (items.length === 0) return '';
  if (lang === 'zh') return items.join('、');
  return items.join(', ');
}

function readFactValue(facts: readonly string[], prefix: string): string | undefined {
  const hit = facts.find((f) => f.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function translateStarList(stars: readonly string[], lang: SupportedLang): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of stars) {
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(translateStar(s, lang));
  }
  return out;
}

function translatePalaceList(palaces: readonly string[], lang: SupportedLang): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of palaces) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(translatePalace(p, lang));
  }
  return out;
}

function isPatternWithDescription(
  p: Pattern | PatternSummary,
): p is Pattern | (PatternSummary & { description: string }) {
  return typeof p.description === 'string' && p.description.length > 0;
}

// ────────────────── Pattern Localization ──────────────────

function summarizePatterns(
  rawPatterns: PatternResult,
  lang: SupportedLang,
): ChartPatternsSummary {
  const items: LocalizedPatternItem[] = rawPatterns.map((pat) => {
    const fallbackDesc = isPatternWithDescription(pat) ? pat.description : undefined;
    const translated = translatePattern(pat.name, pat.level, fallbackDesc, lang);
    const label = translated.name;
    const summary =
      translated.description || buildPatternFallbackSentence(label, pat.level, lang);

    return {
      name: pat.name,
      label,
      level: pat.level,
      levelLabel: translated.category || PATTERN_LEVEL_LABELS[pat.level][lang],
      palaces: translatePalaceList(pat.palaces, lang),
      summary,
    };
  });

  let headline: string;
  if (items.length === 0) {
    headline =
      lang === 'ru'
        ? 'Классические редкие паттерны не доминируют — силу карты определяют точечные связки и такты.'
        : lang === 'en'
          ? 'No single classical macro-pattern dominates; specific star dynamics and decadal cycles shape your edge.'
          : '本盘未见单一固定大格主导，个人格局张力主要来自星曜组合与大限流年联动。';
  } else {
    const topNames = joinList(
      items.slice(0, 3).map((i) => i.label),
      lang,
    );
    if (lang === 'ru') {
      headline = `Обнаружено конфигураций: ${items.length} (${topNames}).`;
    } else if (lang === 'en') {
      headline = `${items.length} classical pattern(s) detected: ${topNames}.`;
    } else {
      headline = `共识别出 ${items.length} 项古典格局：${topNames}。`;
    }
  }

  return {
    count: items.length,
    headline,
    items,
  };
}

function buildPatternFallbackSentence(
  label: string,
  level: PatternSummary['level'],
  lang: SupportedLang,
): string {
  if (lang === 'ru') {
    return level === 'caution'
      ? `Конфигурация «${label}» указывает на зону повышенной чувствительности, требующую точной стратегии.`
      : `Конфигурация «${label}» формирует характерный структурный вектор этой карты.`;
  }
  if (lang === 'en') {
    return level === 'caution'
      ? `${label} signals a sensitive structural pressure zone that benefits from conscious pacing.`
      : `${label} forms a signature structural dynamic across your core palaces.`;
  }
  return level === 'caution'
    ? `「${label}」提示该宫位轴线存在关键张力，需结合大限流年谨慎疏导。`
    : `「${label}」构成了此命盘的核心结构优势之一。`;
}

// ────────────────── Chart Pain-Point Teaser Builders ──────────────────

function buildPainPointCopy(
  pp: ChartPainPoint,
  lang: SupportedLang,
): { hookHeadline: string; teaser: string } {
  const palaceLabel = translatePalace(pp.palaceName, lang);
  const localizedStars = translateStarList(pp.stars, lang);
  const starText = joinList(localizedStars, lang) || translateStar('化忌', lang);
  const jiLabel = translateSiHua('忌', lang);
  const targetYear = readFactValue(pp.facts, 'target_year:');
  const dxAge = readFactValue(pp.facts, 'daxian_age:');
  const axisRaw = readFactValue(pp.facts, 'axis_palaces:');
  const hasDimStar = pp.facts.some((f) => f.startsWith('star_dim:'));
  const hasSelfMix =
    pp.facts.includes('natal_plus_self_huaji') || pp.facts.includes('triggers_self_huaji');
  const hasYangTuoClamp = pp.facts.includes('clamped_by_yang_tuo');

  if (pp.category === 'double_huaji') {
    if (pp.facts.includes('opposite_palace_double_ji')) {
      const axisText = axisRaw
        ? axisRaw
            .split('<->')
            .map((p) => translatePalace(p, lang))
            .join(' ↔ ')
        : palaceLabel;
      if (lang === 'ru') {
        return {
          hookHeadline: `Двойной узел ${jiLabel} на оси «${axisText}»`,
          teaser: `В вашей карте сразу два цикла ${jiLabel} сталкиваются на противоположных полюсах (${starText}), создавая скрытую точку перегрузки. В полной версии раскрыто, какая сторона оси берет удар на себя и как разрядить этот конфликт в конкретные периоды.`,
        };
      }
      if (lang === 'en') {
        return {
          hookHeadline: `Double ${jiLabel} Clash Along ${axisText}`,
          teaser: `Two overlapping ${jiLabel} currents collide across ${axisText} (${starText}), turning routine decisions into high-stakes inflection points. Unlock the full reading to see which side triggers the tension and when the pressure releases.`,
        };
      }
      return {
        hookHeadline: `${axisText}触发「双忌冲」高压轴线`,
        teaser: `本命与运限两重化忌在「${axisText}」对冲引动（${starText}），最易在关键决策期放大反复与阻力。解锁完整解析可定位具体冲克源头、受影响年份与避险路径。`,
      };
    }

    if (pp.facts.includes('clamped_by_huaji')) {
      if (lang === 'ru') {
        return {
          hookHeadline: `Дворец ${palaceLabel} в тисках двойного ${jiLabel}`,
          teaser: `Соседние дворцы берут ${palaceLabel} в двойное кольцо напряжения (${starText}), незаметно сужая свободу маневра. Полный разбор показывает, откуда приходит давление и какой нестандартный выход остается открытым.`,
        };
      }
      if (lang === 'en') {
        return {
          hookHeadline: `${palaceLabel} Caught in a Double ${jiLabel} Clamp`,
          teaser: `Flanking ${jiLabel} pressures squeeze ${palaceLabel} from both sides (${starText}), creating quiet bottlenecks even when plans look sound. Unlock the deep dive to pinpoint the exact trigger and release valve.`,
        };
      }
      return {
        hookHeadline: `${palaceLabel}形成「双忌夹」隐性承压`,
        teaser: `邻宫两重化忌夹迫${palaceLabel}（涉及${starText}），看似平稳时往往暗藏掣肘与消耗。解锁完整报告查看夹忌结构拆解与破局窗口。`,
      };
    }

    if (lang === 'ru') {
      return {
        hookHeadline: `Двойная концентрация ${jiLabel} в дворце ${palaceLabel}`,
        teaser: `Сразу несколько слоев ${jiLabel} сходятся в ${palaceLabel} через ${starText}, многократно усиливая чувствительность этой сферы. Узнайте в полном отчете, как превратить этот узел из утечки ресурсов в точку роста.`,
      };
    }
    if (lang === 'en') {
      return {
        hookHeadline: `Compounded ${jiLabel} Stack Inside ${palaceLabel}`,
        teaser: `Multiple ${jiLabel} layers converge inside ${palaceLabel} via ${starText}, amplifying attachment and pressure here. Unlock the complete interpretation to see the timing curve and stabilizing strategy.`,
      };
    }
    return {
      hookHeadline: `${palaceLabel}出现「双忌叠」强力引爆点`,
      teaser: `多层化忌同时落入${palaceLabel}并聚焦于${starText}，令该领域成为牵动全局的关键卡点。解锁深度报告即可获知具体诱因与化解时机。`,
    };
  }

  if (pp.category === 'natal_huaji') {
    const dimHintRu = hasDimStar ? ' при ослабленной яркости звезды' : '';
    const clampHintRu = hasYangTuoClamp ? ' и давлении соседних Ша' : '';
    const selfHintRu = hasSelfMix ? ' с цепной реакцией самотрансформации' : '';

    if (lang === 'ru') {
      return {
        hookHeadline: `Натальный ${jiLabel} в дворце ${palaceLabel}: ${starText}`,
        teaser: `Врождённый ${jiLabel} закреплен в ${palaceLabel} на ${starText}${dimHintRu}${clampHintRu}${selfHintRu} — именно здесь формируется главный кармический сценарий и скрытый сценарий потерь. Откройте полный разбор, чтобы понять истинный корень этого узла и способ его трансформации.`,
      };
    }
    if (lang === 'en') {
      const modifiers = [
        hasDimStar ? 'at dimmed dignity' : '',
        hasYangTuoClamp ? 'flanked by Sha friction' : '',
        hasSelfMix ? 'linked to a self-transformation loop' : '',
      ].filter(Boolean);
      const modSuffix = modifiers.length > 0 ? ` (${modifiers.join(', ')})` : '';
      return {
        hookHeadline: `Natal ${jiLabel} Anchored in ${palaceLabel}: ${starText}`,
        teaser: `Your natal ${jiLabel} locks onto ${starText} inside ${palaceLabel}${modSuffix}, marking an enduring magnet for over-investment and recurring tests. Unlock the deep dive to trace how this knot links to your other palaces.`,
      };
    }
    const zhFlags = [
      hasDimStar ? '星曜偏弱' : '',
      hasYangTuoClamp ? '邻宫煞曜夹制' : '',
      hasSelfMix ? '叠加自化忌引动' : '',
    ].filter(Boolean);
    const zhSuffix = zhFlags.length > 0 ? `（且伴随${zhFlags.join('、')}）` : '';
    return {
      hookHeadline: `生年化忌落${palaceLabel}：${starText}成关键执念点`,
      teaser: `你的生年化忌落入${palaceLabel}的${starText}${zhSuffix}，往往表现为越在意越容易在此反复投入却难轻松收口。解锁完整解析可看清其来因去向与转机法则。`,
    };
  }

  if (pp.category === 'self_huaji') {
    if (lang === 'ru') {
      return {
        hookHeadline: `Самотрансформация ${jiLabel} в дворце ${palaceLabel}`,
        teaser: `Внутренний небесный ствол дворца ${palaceLabel} запускает скрытый «сброс энергии» через ${starText}: внешне все складывается, но в решающий момент результат утекает. Полный отчет раскрывает механику этого цикла и способ удержать плоды усилий.`,
      };
    }
    if (lang === 'en') {
      return {
        hookHeadline: `Self-Transformation ${jiLabel} Leak in ${palaceLabel}`,
        teaser: `${palaceLabel} generates a self-transformation ${jiLabel} on ${starText}, creating subtle self-sabotage or sudden reversal right as gains materialize. Unlock the full reading to see what triggers the leak and how to seal it.`,
      };
    }
    return {
      hookHeadline: `${palaceLabel}现「自化忌」暗耗信号（${starText}）`,
      teaser: `${palaceLabel}宫干引发${starText}自化忌，常见表象为付出甚多却在临门一脚时发生折损或自我推翻。解锁深度报告定位触发周期与守成关键。`,
    };
  }

  if (pp.category === 'daxian_huaji') {
    const ageRu = dxAge ? ` (возраст ${dxAge})` : '';
    const ageEn = dxAge ? ` (Ages ${dxAge})` : '';
    const ageZh = dxAge ? `（${dxAge}岁）` : '';
    if (lang === 'ru') {
      return {
        hookHeadline: `Десятилетний такт удачи активирует ${palaceLabel}${ageRu}`,
        teaser: `В текущем десятилетии энергия ${jiLabel} смещается в ${palaceLabel} через ${starText}, меняя приоритеты и проверяя прежние договоренности на прочность. Полный анализ покажет, где сбавить риск и куда направить главный фокус.`,
      };
    }
    if (lang === 'en') {
      return {
        hookHeadline: `10-Year DaXian ${jiLabel} Hits ${palaceLabel}${ageEn}`,
        teaser: `This decadal cycle routes ${jiLabel} onto ${starText} in ${palaceLabel}, shifting stress tests onto this pillar for the decade. Unlock the full forecast to map turning years and strategic adjustments.`,
      };
    }
    return {
      hookHeadline: `当前大限化忌牵动${palaceLabel}${ageZh}`,
      teaser: `本步大限四化将化忌引向${palaceLabel}的${starText}，使未来数年的核心考验与转折集中于此。解锁完整运限推演以掌握进退节奏。`,
    };
  }

  if (pp.category === 'liunian_huaji') {
    const yearRu = targetYear ? ` в ${targetYear} году` : '';
    const yearEn = targetYear ? ` (${targetYear})` : '';
    const yearZh = targetYear ? `（${targetYear}年）` : '';
    if (lang === 'ru') {
      return {
        hookHeadline: `Годовой триггер ${jiLabel} в дворце ${palaceLabel}${yearRu}`,
        teaser: `Годовая динамика выводит ${starText} в ${palaceLabel} в зону повышенного внимания, где поспешный шаг обходится дороже обычного. Откройте полный разбор, чтобы увидеть узкие места года и окна возможностей.`,
      };
    }
    if (lang === 'en') {
      return {
        hookHeadline: `Annual ${jiLabel} Watchpoint in ${palaceLabel}${yearEn}`,
        teaser: `Annual flying transformations activate ${starText} in ${palaceLabel}, raising the stakes around timing and commitments this year. Unlock the full reading to see what to avoid and how to pivot.`,
      };
    }
    return {
      hookHeadline: `流年化忌入${palaceLabel}${yearZh}：年度重点防范区`,
      teaser: `流年四化直接点亮${palaceLabel}的${starText}，提示本年度该领域容易出现临时变量或决策考验。解锁完整流年分析查看具体避坑指南。`,
    };
  }

  // sha_cluster
  if (lang === 'ru') {
    return {
      hookHeadline: `Концентрация острых звезд (Ша) в дворце ${palaceLabel}`,
      teaser: `В ${palaceLabel} сходится напряженная связка (${starText}), дающая резкие перемены, сильный характер и высокую цену компромиссов. Узнайте в полной версии, как направить эту мощь в прорыв вместо конфликта.`,
    };
  }
  if (lang === 'en') {
    return {
      hookHeadline: `Sharp Sha & Volatile Star Cluster in ${palaceLabel}`,
      teaser: `${palaceLabel} concentrates high-voltage tension around ${starText}, fueling sudden shifts and tough trade-offs. Unlock the full reading to learn how to convert this volatility into disciplined leverage.`,
    };
  }
  return {
    hookHeadline: `${palaceLabel}见重煞与变动星交会（${starText}）`,
    teaser: `${palaceLabel}聚集${starText}等高张力星曜组合，常带来果断突破与剧烈波动并存的局面。解锁深度分析看清攻守分寸与转化契机。`,
  };
}

function buildVolatileMajorTeaser(
  palaceKey: string,
  starName: string,
  lang: SupportedLang,
): ChartLockedTeaser {
  const palaceName = translatePalace(palaceKey, lang);
  const starLabel = translateStar(starName, lang);
  const severity: ChartPainPoint['severity'] =
    palaceKey === '夫妻' || palaceKey === '财帛' || palaceKey === '官禄' ? 'medium' : 'watch';

  if (lang === 'ru') {
    return {
      id: `volatile_major:${palaceKey}:${starName}`,
      palaceKey,
      palaceName,
      category: 'volatile_major',
      severity,
      stars: [starLabel],
      rawStars: [starName],
      hookHeadline: `Энергия перемен ${starLabel} в закрытом дворце ${palaceName}`,
      teaser: `Присутствие ${starLabel} в ${palaceName} указывает на резкие повороты, нестандартные решения и отказ от полумер в этой сфере жизни. В полной версии раскрыто, какие циклы усиливают прорыв, а где важно удержать стабильность.`,
      unlockCta: CHART_UNLOCK_CTA[lang],
    };
  }
  if (lang === 'en') {
    return {
      id: `volatile_major:${palaceKey}:${starName}`,
      palaceKey,
      palaceName,
      category: 'volatile_major',
      severity,
      stars: [starLabel],
      rawStars: [starName],
      hookHeadline: `High-Momentum ${starLabel} Inside Locked ${palaceName}`,
      teaser: `${starLabel} sitting in ${palaceName} signals decisive shake-ups, fierce independence, and sharp turning points in this domain. Unlock the full reading to see how its timing cycles play out.`,
      unlockCta: CHART_UNLOCK_CTA[lang],
    };
  }
  return {
    id: `volatile_major:${palaceKey}:${starName}`,
    palaceKey,
    palaceName,
    category: 'volatile_major',
    severity,
    stars: [starLabel],
    rawStars: [starName],
    hookHeadline: `${palaceName}坐守${starLabel}：破局变动之机`,
    teaser: `${starLabel}入驻${palaceName}，主此领域蕴含强烈的重塑与决断张力，往往不甘平淡守旧。解锁完整报告即可掌握顺势破局的关键年份与守成要诀。`,
    unlockCta: CHART_UNLOCK_CTA[lang],
  };
}

function buildFallbackLockedTeaser(lang: SupportedLang): ChartLockedTeaser {
  const palaceKey = '财帛';
  const palaceName = translatePalace(palaceKey, lang);
  if (lang === 'ru') {
    return {
      id: 'locked:caibo:sanfang',
      palaceKey,
      palaceName,
      category: 'natal_huaji',
      severity: 'watch',
      stars: [],
      rawStars: [],
      hookHeadline: `Скрытые рычаги финансов, карьеры и партнерства`,
      teaser: `В бесплатном обзоре показан только Дворец Жизни, тогда как реальный денежный поток и отношения управляются связкой ${palaceName} и кармических трансформаций. Откройте полный разбор, чтобы увидеть ключевые триггеры на ближайшие годы.`,
      unlockCta: CHART_UNLOCK_CTA[lang],
    };
  }
  if (lang === 'en') {
    return {
      id: 'locked:caibo:sanfang',
      palaceKey,
      palaceName,
      category: 'natal_huaji',
      severity: 'watch',
      stars: [],
      rawStars: [],
      hookHeadline: `Hidden Wealth, Career & Relationship Triggers`,
      teaser: `While the Life Palace reveals your core temperament, your actual financial timing and relationship dynamics depend on ${palaceName} and flying transformations. Unlock the complete chart report to map every cycle.`,
      unlockCta: CHART_UNLOCK_CTA[lang],
    };
  }
  return {
    id: 'locked:caibo:sanfang',
    palaceKey,
    palaceName,
    category: 'natal_huaji',
    severity: 'watch',
    stars: [],
    rawStars: [],
    hookHeadline: `解锁${palaceName}、事业与感情宫的完整联动`,
    teaser: `免费版仅展示命宫根基，而真正决定财富流向、婚恋磨合与十年大限转折的关键线索隐藏在其余十一宫与四化飞星之中。解锁完整报告获取全景推演。`,
    unlockCta: CHART_UNLOCK_CTA[lang],
  };
}

// ────────────────── Public Chart Teaser Generator ──────────────────

export function generateChartTeasers(
  chart: ZiweiChart,
  analysis: ChartAnalysisSummary,
  patterns: PatternResult,
  rawLang: SupportedLang = 'ru',
): ChartPaywallResult {
  const lang = normalizeLang(rawLang, 'ru');
  const freeLifePalace = generateFreeLifePalaceReading(chart, lang);
  const patternSummary = summarizePatterns(patterns, lang);
  const unlockCta = CHART_UNLOCK_CTA[lang];

  // Prioritize locked-palace pain points first while preserving severity order
  const orderedPainPoints = [...analysis.painPoints].sort((a, b) => {
    if (a.isLockedPalace !== b.isLockedPalace) return a.isLockedPalace ? -1 : 1;
    return b.priorityScore - a.priorityScore;
  });

  const lockedTeasers: ChartLockedTeaser[] = [];
  const coveredPalaces = new Set<string>();

  for (const pp of orderedPainPoints.slice(0, 6)) {
    const copy = buildPainPointCopy(pp, lang);
    coveredPalaces.add(pp.palaceName);
    lockedTeasers.push({
      id: pp.id,
      palaceKey: pp.palaceName,
      palaceName: translatePalace(pp.palaceName, lang),
      category: pp.category,
      severity: pp.severity,
      stars: translateStarList(pp.stars, lang),
      rawStars: [...pp.stars],
      hookHeadline: copy.hookHeadline,
      teaser: copy.teaser,
      unlockCta,
    });
  }

  // Also surface Qi Sha / Po Jun inside core locked palaces if not already teased
  if (lockedTeasers.length < 6) {
    for (const palaceKey of CORE_LOCKED_PALACE_ORDER) {
      if (lockedTeasers.length >= 6) break;
      if (coveredPalaces.has(palaceKey)) continue;
      const palace = chart.palaces.find((p) => p.name === palaceKey);
      if (!palace) continue;
      const volatileStar = palace.stars.find(
        (s) => s.type === 'major' && VOLATILE_LOCKED_STARS.has(s.name),
      );
      if (!volatileStar) continue;
      coveredPalaces.add(palaceKey);
      lockedTeasers.push(buildVolatileMajorTeaser(palaceKey, volatileStar.name, lang));
    }
  }

  if (lockedTeasers.length === 0) {
    lockedTeasers.push(buildFallbackLockedTeaser(lang));
  }

  return {
    lang,
    cacheKey: analysis.cacheKey,
    freeLifePalace,
    patterns: patternSummary,
    lockedTeasers,
    unlockCta,
  };
}

// ────────────────── Synastry Overview & Friction Teaser Builders ──────────────────

function resolveScoreBand(score: number): SynastryScoreBand {
  if (score >= 85) return 'elite';
  if (score >= 70) return 'harmonious';
  if (score >= 55) return 'balanced';
  if (score >= 40) return 'challenging';
  return 'volatile';
}

function formatSynastryHighlight(h: SynastryHighlight, lang: SupportedLang): string {
  const starText = joinList(translateStarList(h.stars, lang), lang);
  const palaceText = joinList(translatePalaceList(h.palaces, lang), lang);

  if (h.code === 'MUTUAL_MING_FUQI_MATCH' || h.code === 'SINGLE_MING_FUQI_MATCH') {
    if (lang === 'ru') {
      return `Резонанс Дворца Жизни и Дворца Брака (${starText}): редкое попадание в идеальный образ партнера.`;
    }
    if (lang === 'en') {
      return `Life-Spouse Palace Mirror (${starText}): rare mutual alignment with each partner’s core ideal.`;
    }
    return `命宫与夫妻宫主星互映（${starText}），呈现天然「天作之合」级契合信号。`;
  }

  if (h.code === 'MING_SANFANG_FUQI_MATCH') {
    if (lang === 'ru') {
      return `Созвучие по тригону Сань-Фан (${starText}): общие жизненные ценности и поддержка целей.`;
    }
    if (lang === 'en') {
      return `SanFang Resonance (${starText}): shared life direction and complementary rhythm.`;
    }
    return `夫妻宫主星落入对方命宫三方（${starText}），志趣与步调具备良好协同。`;
  }

  if (h.code.startsWith('CROSS_LU_INTO_')) {
    if (lang === 'ru') {
      return `Межкарточная Хуа Лу (${starText}) входит в ${palaceText} — источник тепла, щедрости и взаимной удачи.`;
    }
    if (lang === 'en') {
      return `Cross-Chart Hua Lu (${starText}) enters ${palaceText}, bringing natural warmth and mutual uplift.`;
    }
    return `跨盘${starText}化禄飞入${palaceText}，双方互动自带善意、滋养与现实助力。`;
  }

  if (h.code.startsWith('CROSS_KE_INTO_')) {
    if (lang === 'ru') {
      return `Межкарточная Хуа Кэ (${starText}) освещает ${palaceText}: уважение, диалог и мягкая дипломатия.`;
    }
    if (lang === 'en') {
      return `Cross-Chart Hua Ke (${starText}) activates ${palaceText}, supporting mutual respect and understanding.`;
    }
    return `跨盘${starText}化科入${palaceText}，彼此沟通重情理体面，遇分歧易以共识化解。`;
  }

  if (h.code === 'BRANCH_LIUHE' || h.code === 'BRANCH_SANHE' || h.code === 'BRANCH_SAME') {
    if (lang === 'ru') {
      return `Гармония земных ветвей в зоне ${palaceText}: естественное притяжение без лишнего напряжения.`;
    }
    if (lang === 'en') {
      return `Earthly Branch Harmony across ${palaceText}: effortless magnetic pull and shared rhythm.`;
    }
    return `${palaceText}地支构成相合或共振格局，相处节奏容易同频。`;
  }

  if (h.code === 'WUXING_GENERATING' || h.code === 'WUXING_SAME') {
    if (lang === 'ru') {
      return `Порождающий баланс Пяти Элементов (У-Син) между картами укрепляет долгосрочную совместимость.`;
    }
    if (lang === 'en') {
      return `Supportive Five-Element Bureau balance reinforces long-term endurance together.`;
    }
    return `双方五行局相生或同气相求，长期相处具备稳定根基。`;
  }

  if (lang === 'ru') {
    return `Позитивный фактор в зоне ${palaceText}${starText ? ` (${starText})` : ''}.`;
  }
  if (lang === 'en') {
    return `Supportive resonance detected in ${palaceText}${starText ? ` (${starText})` : ''}.`;
  }
  return `${palaceText}呈现正向助力${starText ? `（${starText}）` : ''}。`;
}

function buildSynastryOverview(
  result: SynastryResult,
  band: SynastryScoreBand,
  lang: SupportedLang,
): string {
  const bandLabel = SCORE_BAND_LABELS[band][lang];
  const bondLabel = BOND_TYPE_LABELS[result.crossSiHua.bondType][lang];
  const { palaceResonance, crossSiHuaHarmony, spousePalaceStability, spiritAndFortune } =
    result.dimensions;

  const tianZuoNote =
    result.palaceResonance.tianZuoZhiHe === 'mutual'
      ? lang === 'ru'
        ? 'Между Дворцом Жизни и Дворцом Брака зафиксировано редкое двустороннее зеркало.'
        : lang === 'en'
          ? 'Both charts display a rare mutual Life-to-Spouse Palace mirror.'
          : '双方命宫与夫妻宫形成少见的双向互映格局。'
      : result.palaceResonance.tianZuoZhiHe === 'single'
        ? lang === 'ru'
          ? 'Прослеживается направленный резонанс между Дворцом Брака и Дворцом Жизни партнера.'
          : lang === 'en'
            ? 'One partner’s Spouse Palace directly mirrors the other’s Life Palace.'
            : '一方夫妻宫主星直接对应另一方命宫，存在明确的吸引力锚点。'
        : lang === 'ru'
          ? 'Основная связь строится через перекрестные трансформации Сы-Хуа и баланс стихий.'
          : lang === 'en'
            ? 'Your primary bond runs through cross-chart Flying SiHua and Five-Element interplay.'
            : '双方缘分重心落在跨盘飞星四化与生活节奏的互动配合上。';

  if (lang === 'ru') {
    return `Индекс совместимости: ${result.score}/100 (${bandLabel}). Ведущий тип связи — «${bondLabel}». ${tianZuoNote} Опорные индексы: резонанс дворцов ${palaceResonance}, гармония Сы-Хуа ${crossSiHuaHarmony}, устойчивость брака ${spousePalaceStability}, духовная близость ${spiritAndFortune}.`;
  }
  if (lang === 'en') {
    return `Overall compatibility scores ${result.score}/100 (${bandLabel}), shaped by a ${bondLabel} dynamic. ${tianZuoNote} Sub-scores: Palace Resonance ${palaceResonance}, Cross-SiHua Harmony ${crossSiHuaHarmony}, Spouse Stability ${spousePalaceStability}, and Spirit & Timing ${spiritAndFortune}.`;
  }
  return `双方合盘综合评分为 ${result.score}/100（${bandLabel}），核心互动呈现「${bondLabel}」特征。${tianZuoNote} 四维参考：宫位共振 ${palaceResonance}、四化调和 ${crossSiHuaHarmony}、夫妻稳定 ${spousePalaceStability}、福德运势 ${spiritAndFortune}。`;
}

function buildSynastryFrictionCopy(
  fp: SynastryFrictionPoint,
  lang: SupportedLang,
): { hookHeadline: string; teaser: string } {
  const palaceText = joinList(translatePalaceList(fp.palaces, lang), lang);
  const starText = joinList(translateStarList(fp.stars, lang), lang);
  const jiLabel = translateSiHua('忌', lang);

  switch (fp.code) {
    case 'MUTUAL_HUAJI_ENTANGLEMENT': {
      if (lang === 'ru') {
        return {
          hookHeadline: `Взаимный узел ${jiLabel}: сильное притяжение с риском истощения`,
          teaser: `Обе карты перекрестно активируют ${jiLabel} (${starText}), создавая глубокую эмоциональную привязку и повторяющиеся споры по кругу. В полном разборе показана точка выхода из взаимных упреков.`,
        };
      }
      if (lang === 'en') {
        return {
          hookHeadline: `Mutual ${jiLabel} Entanglement (${starText})`,
          teaser: `Both charts fire ${jiLabel} across key relational axes (${starText}), generating intense pull alongside recurring emotional friction. Unlock the full report to see who triggers whom and how to break the loop.`,
        };
      }
      return {
        hookHeadline: `双向互化忌纠缠（${starText}）：牵绊极深且易反复拉扯`,
        teaser: `双方生年四化彼此引动化忌，既带来强烈的放不下，也容易在误解与压力中互相消耗。解锁完整合盘解析看清触发点与相处边界。`,
      };
    }

    case 'BRANCH_LIUCHONG': {
      if (lang === 'ru') {
        return {
          hookHeadline: `Прямое столкновение ветвей Лю-Чун в зоне «${palaceText}»`,
          teaser: `Противостояние земных ветвей по оси ${palaceText} рождает разные бытовые темпы и резкие расхождения в ожиданиях. Полная версия объясняет, в каких ситуациях конфликт вспыхивает и как выстроить буфер.`,
        };
      }
      if (lang === 'en') {
        return {
          hookHeadline: `Direct Six-Clash (Liu Chong) Across ${palaceText}`,
          teaser: `Opposing Earthly Branches along ${palaceText} spark clashing habits, sudden pivots, and mismatched pacing under stress. Unlock the deep dive for targeted buffering strategies.`,
        };
      }
      return {
        hookHeadline: `${palaceText}呈现「地支六冲」：节奏错位与隐性摩擦`,
        teaser: `双方在${palaceText}轴线形成六冲张力，平时默契尚可时仍易在压力事件下产生习惯冲突。解锁完整分析获取针对性磨合方案。`,
      };
    }

    case 'CROSS_JI_CLASH_CORE_PALACE':
    case 'CROSS_JI_INTO_KEY_PALACE': {
      if (lang === 'ru') {
        return {
          hookHeadline: `Перекрестная ${jiLabel} бьет по ключевой зоне «${palaceText}»`,
          teaser: `Летящая ${jiLabel} партнера (${starText}) затрагивает ${palaceText}, превращая эту область отношений в главный триггер обид или финансово-бытового давления. Откройте полный отчет, чтобы узнать направление потока и защитные шаги.`,
        };
      }
      if (lang === 'en') {
        return {
          hookHeadline: `Cross-Chart ${jiLabel} Strikes ${palaceText} (${starText})`,
          teaser: `Incoming Flying ${jiLabel} on ${starText} directly pressures ${palaceText}, turning unspoken expectations into recurring friction. Unlock the full analysis to decode directional impact and remedies.`,
        };
      }
      return {
        hookHeadline: `跨盘${starText}化忌直入或冲动${palaceText}`,
        teaser: `一方飞星化忌切入对方${palaceText}核心地带，容易在日常细节与期待落差上引发敏感摩擦。解锁深度报告查看双向因果与化解之道。`,
      };
    }

    case 'FUQI_SANXIONG_COMBO':
    case 'FUQI_WUQU_SHAPO_SHA': {
      if (lang === 'ru') {
        return {
          hookHeadline: `Высокое напряжение в Дворце Брака (${starText})`,
          teaser: `Натальная конфигурация Дворца Брака (${starText}) несет повышенную импульсивность и склонность к резким разрывам при слабой дипломатии. Полный разбор раскрывает зрелый сценарий сохранения союза.`,
        };
      }
      if (lang === 'en') {
        return {
          hookHeadline: `High-Volatility Marriage Palace Signature (${starText})`,
          teaser: `This natal Spouse Palace combination (${starText}) heightens independence and abrupt emotional shifts if left unmanaged. Unlock the full reading to see timing milestones and stabilizing rules.`,
        };
      }
      return {
        hookHeadline: `夫妻宫高波动星组预警（${starText}）`,
        teaser: `一方夫妻宫见${starText}组合，感情张力强且对相处自由度与沟通方式要求极高，稍失分寸易起大波澜。解锁完整报告查看长久相处法则。`,
      };
    }

    case 'FUQI_NATAL_HUAJI':
    case 'FUQI_OPPOSITE_HUAJI_CLASH':
    case 'FUQI_SELF_HUAJI': {
      if (lang === 'ru') {
        return {
          hookHeadline: `Узел ${jiLabel} в Дворце Брака (${starText})`,
          teaser: `Энергия ${jiLabel} в зоне ${palaceText} указывает на завышенные ожидания, страх потери или скрытое недоверие в паре. Узнайте в полном отчете, как переключить этот импульс в заботу и устойчивость.`,
        };
      }
      if (lang === 'en') {
        return {
          hookHeadline: `${jiLabel} Sensitivity in ${palaceText} (${starText})`,
          teaser: `${jiLabel} inside or clashing ${palaceText} creates perfectionism, guardedness, or push-pull tension in love. Unlock the full synastry guide to identify the exact trigger periods.`,
        };
      }
      return {
        hookHeadline: `${palaceText}受${starText}化忌牵动：感情执念与磨合课题`,
        teaser: `${palaceText}现化忌或自化忌信号，常带来过度在意、口是心非或责任压力感。解锁完整分析看清彼此心理盲区与破冰节奏。`,
      };
    }

    case 'FEMALE_SUN_RISK':
    case 'MALE_MOON_RISK': {
      if (lang === 'ru') {
        return {
          hookHeadline: `Чувствительный баланс Солнца и Луны (${starText})`,
          teaser: `Положение ${starText} в ${palaceText} указывает на скрытую диспропорцию в ролях, заботе или бытовой нагрузке между партнерами. Полная версия помогает вовремя выровнять ожидания.`,
        };
      }
      if (lang === 'en') {
        return {
          hookHeadline: `Sun–Moon Polarity Strain (${starText} in ${palaceText})`,
          teaser: `${starText} at dimmed dignity or under ${jiLabel} signals imbalance in mutual support and domestic roles. Unlock the deep dive to restore equilibrium.`,
        };
      }
      return {
        hookHeadline: `日月星象失衡提示（${starText} · ${palaceText}）`,
        teaser: `命盘中反映伴侣助力与家庭角色的${starText}状态承压，容易出现付出不对等或沟通误判。解锁完整报告了解调和之道。`,
      };
    }

    case 'ANNUAL_SHARED_TENSION':
    case 'ANNUAL_HUAJI_CLASH':
    case 'ANNUAL_HUAJI_HIT': {
      const yr = typeof fp.facts.year === 'number' ? String(fp.facts.year) : '';
      if (lang === 'ru') {
        return {
          hookHeadline: `Годовой стресс-тест пары${yr ? ` (${yr})` : ''}: ${palaceText}`,
          teaser: `Годовые транзиты концентрируют ${jiLabel} на ${starText} в зоне ${palaceText}, проверяя гибкость союза в конкретные месяцы. Полный прогноз выделяет опасные окна и спокойные периоды.`,
        };
      }
      if (lang === 'en') {
        return {
          hookHeadline: `${yr ? `${yr} ` : ''}Annual Stress Point Across ${palaceText}`,
          teaser: `Annual flying ${jiLabel} targets ${starText} in ${palaceText}, testing patience and joint decisions this year. Unlock the full annual overlay to plan ahead.`,
        };
      }
      return {
        hookHeadline: `${yr ? `${yr} ` : ''}流年双盘压力提示（${palaceText}）`,
        teaser: `流年化忌引动${palaceText}的${starText}，提示该年度双方在情绪、财务或家庭议题上更需同舟共济。解锁完整报告查看分月节奏建议。`,
      };
    }

    default: {
      if (lang === 'ru') {
        return {
          hookHeadline: `Зона скрытого трения: ${palaceText}${starText ? ` (${starText})` : ''}`,
          teaser: `Детерминированный разбор фиксирует точку расхождения в ${palaceText}, способную накапливать усталость без ясных договоренностей. Откройте полный разбор совместимости, чтобы увидеть детали и рекомендации.`,
        };
      }
      if (lang === 'en') {
        return {
          hookHeadline: `Relational Watchpoint in ${palaceText}${starText ? ` (${starText})` : ''}`,
          teaser: `A structural friction trigger appears across ${palaceText}, highlighting where unspoken expectations can build pressure over time. Unlock the full synastry deep dive to navigate it cleanly.`,
        };
      }
      return {
        hookHeadline: `${palaceText}存在合盘磨合关注点${starText ? `（${starText}）` : ''}`,
        teaser: `双方在${palaceText}维度存在需要主动磨合的结构张力，若忽略节奏差异易渐生隔阂。解锁完整合盘解析查看详细拆解。`,
      };
    }
  }
}

function buildSynastryFallbackTeaser(lang: SupportedLang): SynastryLockedTeaser {
  const fuqi = translatePalace('夫妻', lang);
  const fude = translatePalace('福德', lang);
  if (lang === 'ru') {
    return {
      id: 'synastry:fallback:cycle',
      code: 'SYNASTRY_TIMING_DEEP_DIVE',
      category: 'annual_overlay',
      severity: 'watch',
      palaces: [fuqi, fude],
      rawPalaces: ['夫妻', '福德'],
      stars: [],
      hookHeadline: `Скрытая динамика десятилетних циклов и Дворца Духа (${fude})`,
      teaser: `Даже при ровной натальной совместимости долгосрочная устойчивость пары зависит от синхронности тактов удачи и глубины ${fude}. Откройте полный разбор для прогноза по циклам и точкам сближения.`,
      unlockCta: SYNASTRY_UNLOCK_CTA[lang],
    };
  }
  if (lang === 'en') {
    return {
      id: 'synastry:fallback:cycle',
      code: 'SYNASTRY_TIMING_DEEP_DIVE',
      category: 'annual_overlay',
      severity: 'watch',
      palaces: [fuqi, fude],
      rawPalaces: ['夫妻', '福德'],
      stars: [],
      hookHeadline: `Long-Term Cycle Sync & ${fude} Compatibility`,
      teaser: `Even strong natal harmony shifts across 10-year DaXian chapters and deep ${fude} needs. Unlock the complete synastry report to see your multi-year alignment roadmap.`,
      unlockCta: SYNASTRY_UNLOCK_CTA[lang],
    };
  }
  return {
    id: 'synastry:fallback:cycle',
    code: 'SYNASTRY_TIMING_DEEP_DIVE',
    category: 'annual_overlay',
    severity: 'watch',
    palaces: [fuqi, fude],
    rawPalaces: ['夫妻', '福德'],
    stars: [],
    hookHeadline: `${fuqi}与${fude}的深层长远磨合推演`,
    teaser: `即使基础契合度良好，伴侣关系仍会随各自大限与流年切换出现节奏差异。解锁完整合盘报告查看长期相处策略与关键节点。`,
    unlockCta: SYNASTRY_UNLOCK_CTA[lang],
  };
}

// ────────────────── Public Synastry Teaser Generator ──────────────────

export function generateSynastryTeasers(
  result: SynastryResult,
  rawLang: SupportedLang = 'ru',
): SynastryPaywallResult {
  const lang = normalizeLang(rawLang, 'ru');
  const scoreBand = resolveScoreBand(result.score);
  const unlockCta = SYNASTRY_UNLOCK_CTA[lang];

  const highlightSummaries = result.highlights
    .slice(0, 3)
    .map((h) => formatSynastryHighlight(h, lang));

  const lockedTeasers: SynastryLockedTeaser[] = result.frictionPoints
    .slice(0, 6)
    .map((fp) => {
      const copy = buildSynastryFrictionCopy(fp, lang);
      return {
        id: fp.id,
        code: fp.code,
        category: fp.category,
        severity: fp.severity,
        palaces: translatePalaceList(fp.palaces, lang),
        rawPalaces: [...fp.palaces],
        stars: translateStarList(fp.stars, lang),
        hookHeadline: copy.hookHeadline,
        teaser: copy.teaser,
        unlockCta,
      };
    });

  if (lockedTeasers.length === 0) {
    lockedTeasers.push(buildSynastryFallbackTeaser(lang));
  }

  return {
    lang,
    score: result.score,
    stars: result.stars,
    scoreBand,
    scoreBandLabel: SCORE_BAND_LABELS[scoreBand][lang],
    levelLabel: SYNASTRY_LEVEL_LABELS[result.level]?.[lang] ?? result.level,
    bondType: result.crossSiHua.bondType,
    bondLabel: BOND_TYPE_LABELS[result.crossSiHua.bondType]?.[lang] ?? result.crossSiHua.bondType,
    overview: buildSynastryOverview(result, scoreBand, lang),
    highlightSummaries,
    lockedTeasers,
    unlockCta,
  };
}
