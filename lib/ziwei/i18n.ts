/**
 * Zi Wei Dou Shu domain internationalization (`'ru' | 'zh' | 'en'`).
 *
 * Pure data dictionaries and stateless translation helpers covering palaces,
 * stars (major, lucky, sha, auxiliary, 12-spirit rings, and transit stars),
 * SiHua transformations, brightness levels, 5-element bureaus, stems/branches,
 * classical patterns, synastry terms, and deterministic chart summaries.
 *
 * Safe for both server and client bundles (zero `server-only`, zero `any`).
 */

import type {
  ChartAnalysisSummary,
  ChartPainPoint,
  FavorableSiHuaHighlight,
  FreeStarSummary,
  PainPointCategory,
  PainPointSeverity,
  PatternSummary,
  SanFangPalaceSummary,
} from './chart-analyzer';
import { BRANCHES, STEMS } from './constants';
import type { SiHua, Star, StarBrightness, ZiweiChart } from './types';

export type SupportedLang = 'ru' | 'zh' | 'en';

export interface LocalizedText {
  ru: string;
  zh: string;
  en: string;
}

export interface PatternLabelEntry {
  name: LocalizedText;
  description: LocalizedText;
}

export interface TranslatedPatternText {
  name: string;
  category?: string;
  description: string;
}

export interface TranslatedStarSummary {
  name: string;
  originalName: string;
  type: Star['type'];
  brightness?: string;
  brightnessRaw?: string;
  siHua?: string;
  siHuaCode?: SiHua;
  borrowed: boolean;
}

export interface TranslatedPalaceSummary {
  palaceName: string;
  originalPalaceName: string;
  branch: string;
  branchIndex: number;
  stem: string;
  stemIndex: number;
  isEmpty: boolean;
  majorStars: TranslatedStarSummary[];
  borrowedFromName?: string;
  borrowedFromBranch?: string;
  borrowedStars: string[];
  effectiveMajorStars: TranslatedStarSummary[];
  luckyStars: string[];
  shaStars: string[];
  favorableSiHua: Array<{ starName: string; siHua: string; siHuaCode: Exclude<SiHua, '忌'> }>;
}

export interface TranslatedFavorableSiHua {
  siHua: string;
  siHuaCode: Exclude<SiHua, '忌'>;
  starName: string;
  originalStarName: string;
  starType: Star['type'];
  palaceName: string;
  palaceBranch: string;
  inSanFang: boolean;
  inMingOrShen: boolean;
  brightness?: string;
  brightnessRaw?: string;
}

export interface TranslatedPainPoint {
  id: string;
  palaceName: string;
  originalPalaceName: string;
  palaceBranch: string;
  category: PainPointCategory;
  categoryLabel: string;
  severity: PainPointSeverity;
  severityLabel: string;
  priorityScore: number;
  isLockedPalace: boolean;
  stars: string[];
  siHua: string[];
  facts: string[];
}

export interface TranslatedPatternSummary {
  name: string;
  originalName: string;
  level: PatternSummary['level'];
  levelLabel: string;
  palaces: string[];
  description: string;
  source?: string;
}

export interface TranslatedChartSummary {
  lang: SupportedLang;
  basic: {
    wuxingJu: string;
    wuxingJuNumber: number;
    mingZhu: string;
    shenZhu: string;
    gender: string;
    yinYangGender: string;
    mingPalaceName: string;
    mingPalaceBranch: string;
    mingPalaceStem: string;
    shenPalaceName: string;
    shenPalaceBranch: string;
    shenPalaceStem: string;
    isShenSameAsMing: boolean;
    lunarYear: number;
    lunarMonth: number;
    lunarDay: number;
    isLeapMonth: boolean;
    yearStem: string;
    yearBranch: string;
    city?: string;
  };
  mingPalace: TranslatedPalaceSummary;
  shenPalace: TranslatedPalaceSummary & { isSameAsMing: boolean };
  sanFangSiZheng: TranslatedPalaceSummary[];
  favorableSiHua: TranslatedFavorableSiHua[];
  sanFangFavorableSiHua: TranslatedFavorableSiHua[];
  hasSanQiJiaHui: boolean;
  painPoints: TranslatedPainPoint[];
  patterns: TranslatedPatternSummary[];
}

// ────────────────── Locale Normalization ──────────────────

/**
 * Normalize an arbitrary language input into `'ru' | 'zh' | 'en'`.
 */
export function normalizeLang(
  input?: unknown,
  fallback: SupportedLang = 'ru',
): SupportedLang {
  if (typeof input !== 'string') return fallback;
  const cleaned = input.trim().toLowerCase();
  if (!cleaned) return fallback;

  if (
    cleaned === 'ru'
    || cleaned.startsWith('ru-')
    || cleaned.startsWith('ru_')
    || cleaned === 'rus'
    || cleaned === 'russian'
    || cleaned === 'русский'
    || cleaned === '俄语'
  ) {
    return 'ru';
  }
  if (
    cleaned === 'zh'
    || cleaned.startsWith('zh-')
    || cleaned.startsWith('zh_')
    || cleaned === 'cn'
    || cleaned === 'zho'
    || cleaned === 'chinese'
    || cleaned === '中文'
  ) {
    return 'zh';
  }
  if (
    cleaned === 'en'
    || cleaned.startsWith('en-')
    || cleaned.startsWith('en_')
    || cleaned === 'eng'
    || cleaned === 'english'
    || cleaned === '英语'
    || cleaned === '英文'
  ) {
    return 'en';
  }

  return fallback;
}

function pick(text: LocalizedText, lang: SupportedLang): string {
  return text[lang];
}

// ────────────────── Palaces ──────────────────

export const PALACE_LABELS: Readonly<Record<string, LocalizedText>> = {
  命宫: { ru: 'Дворец Судьбы', zh: '命宫', en: 'Life Palace' },
  身宫: { ru: 'Дворец Тела', zh: '身宫', en: 'Body Palace' },
  兄弟: { ru: 'Дворец Братьев', zh: '兄弟', en: 'Siblings Palace' },
  兄弟宫: { ru: 'Дворец Братьев', zh: '兄弟宫', en: 'Siblings Palace' },
  夫妻: { ru: 'Дворец Брака', zh: '夫妻', en: 'Spouse Palace' },
  夫妻宫: { ru: 'Дворец Брака', zh: '夫妻宫', en: 'Spouse Palace' },
  子女: { ru: 'Дворец Детей', zh: '子女', en: 'Children Palace' },
  子女宫: { ru: 'Дворец Детей', zh: '子女宫', en: 'Children Palace' },
  财帛: { ru: 'Дворец Богатства', zh: '财帛', en: 'Wealth Palace' },
  财帛宫: { ru: 'Дворец Богатства', zh: '财帛宫', en: 'Wealth Palace' },
  疾厄: { ru: 'Дворец Здоровья', zh: '疾厄', en: 'Health Palace' },
  疾厄宫: { ru: 'Дворец Здоровья', zh: '疾厄宫', en: 'Health Palace' },
  迁移: { ru: 'Дворец Перемещений', zh: '迁移', en: 'Travel Palace' },
  迁移宫: { ru: 'Дворец Перемещений', zh: '迁移宫', en: 'Travel Palace' },
  仆役: { ru: 'Дворец Друзей', zh: '仆役', en: 'Friends Palace' },
  仆役宫: { ru: 'Дворец Друзей', zh: '仆役宫', en: 'Friends Palace' },
  交友: { ru: 'Дворец Друзей', zh: '交友', en: 'Friends Palace' },
  交友宫: { ru: 'Дворец Друзей', zh: '交友宫', en: 'Friends Palace' },
  官禄: { ru: 'Дворец Карьеры', zh: '官禄', en: 'Career Palace' },
  官禄宫: { ru: 'Дворец Карьеры', zh: '官禄宫', en: 'Career Palace' },
  事业宫: { ru: 'Дворец Карьеры', zh: '事业宫', en: 'Career Palace' },
  田宅: { ru: 'Дворец Имущества', zh: '田宅', en: 'Property Palace' },
  田宅宫: { ru: 'Дворец Имущества', zh: '田宅宫', en: 'Property Palace' },
  福德: { ru: 'Дворец Счастья', zh: '福德', en: 'Fortune & Spirit Palace' },
  福德宫: { ru: 'Дворец Счастья', zh: '福德宫', en: 'Fortune & Spirit Palace' },
  父母: { ru: 'Дворец Родителей', zh: '父母', en: 'Parents Palace' },
  父母宫: { ru: 'Дворец Родителей', zh: '父母宫', en: 'Parents Palace' },
  来因: { ru: 'Дворец Первопричины', zh: '来因', en: 'Origin Palace' },
  来因宫: { ru: 'Дворец Первопричины', zh: '来因宫', en: 'Origin Palace' },
};

// Short palace aliases used in patterns (`命`, `迁`, `财`, `官`, `身`)
const SHORT_PALACE_ALIAS_TO_FULL: Readonly<Record<string, string>> = {
  命: '命宫',
  身: '身宫',
  兄: '兄弟宫',
  夫: '夫妻宫',
  子: '子女宫',
  财: '财帛宫',
  疾: '疾厄宫',
  迁: '迁移宫',
  仆: '仆役宫',
  友: '交友宫',
  官: '官禄宫',
  田: '田宅宫',
  福: '福德宫',
  父: '父母宫',
};

// ────────────────── Stars ──────────────────

const BASE_STAR_LABELS: Record<string, LocalizedText> = {
  // 14 Major Stars
  紫微: { ru: 'Цзы Вэй (Император)', zh: '紫微', en: 'Zi Wei (Emperor)' },
  天机: { ru: 'Тянь Цзи (Советник)', zh: '天机', en: 'Tian Ji (Advisor)' },
  太阳: { ru: 'Тай Ян (Солнце)', zh: '太阳', en: 'Tai Yang (Sun)' },
  武曲: { ru: 'У Цюй (Финансист-Воин)', zh: '武曲', en: 'Wu Qu (Finance Star)' },
  天同: { ru: 'Тянь Тун (Благодать)', zh: '天同', en: 'Tian Tong (Harmony)' },
  廉贞: { ru: 'Лянь Чжэнь (Праведность)', zh: '廉贞', en: 'Lian Zhen (Judge)' },
  天府: { ru: 'Тянь Фу (Сокровищница)', zh: '天府', en: 'Tian Fu (Treasury)' },
  太阴: { ru: 'Тай Инь (Луна)', zh: '太阴', en: 'Tai Yin (Moon)' },
  贪狼: { ru: 'Тань Лан (Волк Желаний)', zh: '贪狼', en: 'Tan Lang (Greedy Wolf)' },
  巨门: { ru: 'Цзюй Мэнь (Великие Врата)', zh: '巨门', en: 'Ju Men (Great Gate)' },
  天相: { ru: 'Тянь Сян (Министр)', zh: '天相', en: 'Tian Xiang (Minister)' },
  天梁: { ru: 'Тянь Лян (Мудрец)', zh: '天梁', en: 'Tian Liang (Sage)' },
  七杀: { ru: 'Ци Ша (Полководец)', zh: '七杀', en: 'Qi Sha (Seven Killings)' },
  破军: { ru: 'По Цзюнь (Первопроходец)', zh: '破军', en: 'Po Jun (Army Breaker)' },

  // 6 Lucky Stars (六吉)
  文昌: { ru: 'Вэнь Чан (Учёность)', zh: '文昌', en: 'Wen Chang (Literature)' },
  文曲: { ru: 'Вэнь Цюй (Талант)', zh: '文曲', en: 'Wen Qu (Arts)' },
  左辅: { ru: 'Цзо Фу (Левый Помощник)', zh: '左辅', en: 'Zuo Fu (Left Support)' },
  右弼: { ru: 'Ю Би (Правый Помощник)', zh: '右弼', en: 'You Bi (Right Support)' },
  天魁: { ru: 'Тянь Куй (Дневной Покровитель)', zh: '天魁', en: 'Tian Kui (Day Noble)' },
  天钺: { ru: 'Тянь Юэ (Ночной Покровитель)', zh: '天钺', en: 'Tian Yue (Night Noble)' },

  // Lu Cun & Tian Ma (禄马)
  禄存: { ru: 'Лу Цунь (Хранитель Благ)', zh: '禄存', en: 'Lu Cun (Wealth Store)' },
  天马: { ru: 'Тянь Ма (Небесный Конь)', zh: '天马', en: 'Tian Ma (Sky Horse)' },

  // 6 Sha Stars (六煞)
  擎羊: { ru: 'Цин Ян (Клинок)', zh: '擎羊', en: 'Qing Yang (Blade)' },
  陀罗: { ru: 'То Ло (Вихрь Задержек)', zh: '陀罗', en: 'Tuo Luo (Hurdle)' },
  火星: { ru: 'Хо Син (Огонь)', zh: '火星', en: 'Huo Xing (Fire Star)' },
  铃星: { ru: 'Лин Син (Тревожный Колокол)', zh: '铃星', en: 'Ling Xing (Bell Star)' },
  地空: { ru: 'Ди Кун (Земная Пустота)', zh: '地空', en: 'Di Kong (Earth Void)' },
  地劫: { ru: 'Ди Цзе (Испытание Потерей)', zh: '地劫', en: 'Di Jie (Earth Loss)' },

  // Romance & Peach Blossom Stars
  红鸾: { ru: 'Хун Луань (Красный Феникс)', zh: '红鸾', en: 'Hong Luan (Red Phoenix)' },
  天喜: { ru: 'Тянь Си (Небесная Радость)', zh: '天喜', en: 'Tian Xi (Sky Joy)' },
  天姚: { ru: 'Тянь Яо (Очарование)', zh: '天姚', en: 'Tian Yao (Allure)' },
  咸池: { ru: 'Сянь Чи (Цветок Персика)', zh: '咸池', en: 'Xian Chi (Peach Blossom)' },

  // Helper, Noble, Longevity & Auxiliary Stars
  天官: { ru: 'Тянь Гуань (Чиновничья Удача)', zh: '天官', en: 'Tian Guan (Official Blessing)' },
  天福: { ru: 'Тянь Фу (Небесная Благодать)', zh: '天福', en: 'Tian Fu (Heavenly Fortune)' },
  天才: { ru: 'Тянь Цай (Природный Дар)', zh: '天才', en: 'Tian Cai (Talent)' },
  天寿: { ru: 'Тянь Шоу (Долголетие)', zh: '天寿', en: 'Tian Shou (Longevity)' },
  三台: { ru: 'Сань Тай (Три Ступени)', zh: '三台', en: 'San Tai (Three Platforms)' },
  八座: { ru: 'Ба Цзо (Восемь Престолов)', zh: '八座', en: 'Ba Zuo (Eight Seats)' },
  恩光: { ru: 'Энь Гуан (Свет Милости)', zh: '恩光', en: 'En Guang (Grace Light)' },
  天贵: { ru: 'Тянь Гуй (Благородство)', zh: '天贵', en: 'Tian Gui (Heavenly Honor)' },
  台辅: { ru: 'Тай Фу (Опора Двора)', zh: '台辅', en: 'Tai Fu (Court Aid)' },
  封诰: { ru: 'Фэн Гао (Почётный Указ)', zh: '封诰', en: 'Feng Gao (Imperial Decree)' },
  龙池: { ru: 'Лун Чи (Пруд Дракона)', zh: '龙池', en: 'Long Chi (Dragon Pool)' },
  凤阁: { ru: 'Фэн Гэ (Терем Феникса)', zh: '凤阁', en: 'Feng Ge (Phoenix Pavilion)' },
  解神: { ru: 'Цзе Шэнь (Разрешение Тревог)', zh: '解神', en: 'Jie Shen (Relief)' },
  天德: { ru: 'Тянь Дэ (Небесная Добродетель)', zh: '天德', en: 'Tian De (Heavenly Virtue)' },
  月德: { ru: 'Юэ Дэ (Лунная Добродетель)', zh: '月德', en: 'Yue De (Lunar Virtue)' },
  年解: { ru: 'Нянь Цзе (Годовое Облегчение)', zh: '年解', en: 'Nian Jie (Annual Relief)' },
  天巫: { ru: 'Тянь У (Интуиция и Наследие)', zh: '天巫', en: 'Tian Wu (Psychic Wisdom)' },
  华盖: { ru: 'Хуа Гай (Балдахин Мудрости)', zh: '华盖', en: 'Hua Gai (Canopy of Solitude)' },
  破碎: { ru: 'По Суй (Разброс Сил)', zh: '破碎', en: 'Po Sui (Fragmentation)' },
  天厨: { ru: 'Тянь Чу (Небесная Трапеза)', zh: '天厨', en: 'Tian Chu (Heavenly Kitchen)' },

  // Empty, Obstruction & Caution Auxiliary Stars
  天空: { ru: 'Тянь Кун (Небесная Пустота)', zh: '天空', en: 'Tian Kong (Sky Void)' },
  旬空: { ru: 'Сюнь Кун (Декадная Пустота)', zh: '旬空', en: 'Xun Kong (Decade Void)' },
  副旬: { ru: 'Фу Сюнь (Вторичная Пустота)', zh: '副旬', en: 'Fu Xun (Secondary Decade Void)' },
  旬中: { ru: 'Сюнь Чжун (Середина Декады)', zh: '旬中', en: 'Xun Zhong (Mid-Decade Void)' },
  截路: { ru: 'Цзе Лу (Преграда на Пути)', zh: '截路', en: 'Jie Lu (Roadblock)' },
  截空: { ru: 'Цзе Кун (Прерванный Поток)', zh: '截空', en: 'Jie Kong (Intercepted Void)' },
  副截: { ru: 'Фу Цзе (Вторичная Преграда)', zh: '副截', en: 'Fu Jie (Secondary Intercept)' },
  空亡: { ru: 'Кун Ван (Утрата Опоры)', zh: '空亡', en: 'Kong Wang (Emptiness)' },
  大耗: { ru: 'Да Хао (Большие Траты)', zh: '大耗', en: 'Da Hao (Major Drain)' },
  天使: { ru: 'Тянь Ши (Небесный Посланец)', zh: '天使', en: 'Tian Shi (Heavenly Envoy)' },
  天伤: { ru: 'Тянь Шан (Уязвимость)', zh: '天伤', en: 'Tian Shang (Injury Star)' },
  天刑: { ru: 'Тянь Син (Строгий Порядок)', zh: '天刑', en: 'Tian Xing (Discipline)' },
  天哭: { ru: 'Тянь Ку (Слёзы Неба)', zh: '天哭', en: 'Tian Ku (Sky Lament)' },
  天虚: { ru: 'Тянь Сюй (Иллюзорность)', zh: '天虚', en: 'Tian Xu (Sky Frailty)' },
  天月: { ru: 'Тянь Юэ (Здоровье Луны)', zh: '天月', en: 'Tian Yue (Monthly Illness)' },
  阴煞: { ru: 'Инь Ша (Скрытая Тень)', zh: '阴煞', en: 'Yin Sha (Hidden Shadow)' },
  蜚廉: { ru: 'Фэй Лянь (Молва и Ветер)', zh: '蜚廉', en: 'Fei Lian (Gossip)' },
  孤辰: { ru: 'Гу Чэнь (Одинокая Звезда)', zh: '孤辰', en: 'Gu Chen (Solitude)' },
  寡宿: { ru: 'Гуа Су (Уединение)', zh: '寡宿', en: 'Gua Su (Seclusion)' },
  劫杀: { ru: 'Цзе Ша (Внешнее Препятствие)', zh: '劫杀', en: 'Jie Sha (External Obstacle)' },

  // 12 Life Stages (长生十二神)
  长生: { ru: 'Чан Шэн (Рождение)', zh: '长生', en: 'Chang Sheng (Birth)' },
  沐浴: { ru: 'Му Юй (Омовение)', zh: '沐浴', en: 'Mu Yu (Bath)' },
  冠带: { ru: 'Гуань Дай (Становление)', zh: '冠带', en: 'Guan Dai (Capping)' },
  临官: { ru: 'Линь Гуань (Восхождение)', zh: '临官', en: 'Lin Guan (Career Prime)' },
  帝旺: { ru: 'Ди Ван (Расцвет Силы)', zh: '帝旺', en: 'Di Wang (Emperor Peak)' },
  衰: { ru: 'Шуай (Спад)', zh: '衰', en: 'Shuai (Decline)' },
  病: { ru: 'Бин (Усталость)', zh: '病', en: 'Bing (Weakness)' },
  死: { ru: 'Сы (Замирание)', zh: '死', en: 'Si (Stillness)' },
  墓: { ru: 'Му (Хранилище)', zh: '墓', en: 'Mu (Vault)' },
  绝: { ru: 'Цзюэ (Обнуление)', zh: '绝', en: 'Jue (Extinction)' },
  胎: { ru: 'Тай (Зачатие)', zh: '胎', en: 'Tai (Conception)' },
  养: { ru: 'Ян (Вскармливание)', zh: '养', en: 'Yang (Nurturing)' },

  // 12 Bo Shi Spirits (博士十二神)
  博士: { ru: 'Бо Ши (Эрудит)', zh: '博士', en: 'Bo Shi (Scholar)' },
  力士: { ru: 'Ли Ши (Богатырь)', zh: '力士', en: 'Li Shi (Strongman)' },
  青龙: { ru: 'Цин Лун (Лазурный Дракон)', zh: '青龙', en: 'Qing Long (Azure Dragon)' },
  小耗: { ru: 'Сяо Хао (Малые Траты)', zh: '小耗', en: 'Xiao Hao (Minor Drain)' },
  将军: { ru: 'Цзян Цзюнь (Воевода)', zh: '将军', en: 'Jiang Jun (General)' },
  奏书: { ru: 'Цзоу Шу (Докладная Грамота)', zh: '奏书', en: 'Zou Shu (Memorial)' },
  飞廉: { ru: 'Фэй Лянь (Быстрый Вестник)', zh: '飞廉', en: 'Fei Lian (Messenger)' },
  喜神: { ru: 'Си Шэнь (Дух Радости)', zh: '喜神', en: 'Xi Shen (Joy Spirit)' },
  病符: { ru: 'Бин Фу (Печать Недуга)', zh: '病符', en: 'Bing Fu (Illness Talisman)' },
  伏兵: { ru: 'Фу Бин (Скрытая Засада)', zh: '伏兵', en: 'Fu Bing (Ambush)' },
  官府: { ru: 'Гуань Фу (Управа)', zh: '官府', en: 'Guan Fu (Magistrate)' },

  // 12 Sui Qian Spirits (岁前十二神)
  岁建: { ru: 'Суй Цзянь (Основа Года)', zh: '岁建', en: 'Sui Jian (Year Pillar)' },
  晦气: { ru: 'Хуэй Ци (Туман)', zh: '晦气', en: 'Hui Qi (Gloom)' },
  丧门: { ru: 'Сан Мэнь (Врата Скорби)', zh: '丧门', en: 'Sang Men (Mourning Gate)' },
  贯索: { ru: 'Гуань Со (Связующая Нить)', zh: '贯索', en: 'Guan Suo (Shackle)' },
  官符: { ru: 'Гуань Фу (Казённая Бумага)', zh: '官符', en: 'Guan Fu (Official Seal)' },
  岁破: { ru: 'Суй По (Разлом Года)', zh: '岁破', en: 'Sui Po (Year Breaker)' },
  龙德: { ru: 'Лун Дэ (Добродетель Дракона)', zh: '龙德', en: 'Long De (Dragon Virtue)' },
  白虎: { ru: 'Бай Ху (Белый Тигр)', zh: '白虎', en: 'Bai Hu (White Tiger)' },
  吊客: { ru: 'Дяо Кэ (Дальний Визит)', zh: '吊客', en: 'Diao Ke (Condolence Guest)' },

  // 12 Jiang Qian Spirits (将前十二神)
  将星: { ru: 'Цзян Син (Звезда Полководца)', zh: '将星', en: 'Jiang Xing (General Star)' },
  攀鞍: { ru: 'Пань Ань (Стремя Почёта)', zh: '攀鞍', en: 'Pan An (Saddle)' },
  岁驿: { ru: 'Суй И (Почтовый Конь Года)', zh: '岁驿', en: 'Sui Yi (Year Post Horse)' },
  息神: { ru: 'Си Шэнь (Покой Духа)', zh: '息神', en: 'Xi Shen (Rest Spirit)' },
  劫煞: { ru: 'Цзе Ша (Потеря Импульса)', zh: '劫煞', en: 'Jie Sha (Robbery Sha)' },
  灾煞: { ru: 'Цзай Ша (Испытание Стихией)', zh: '灾煞', en: 'Zai Sha (Calamity Sha)' },
  天煞: { ru: 'Тянь Ша (Небесное Испытание)', zh: '天煞', en: 'Tian Sha (Heavenly Sha)' },
  指背: { ru: 'Чжи Бэй (Пересуды за Спиной)', zh: '指背', en: 'Zhi Bei (Backbiting)' },
  月煞: { ru: 'Юэ Ша (Лунное Препятствие)', zh: '月煞', en: 'Yue Sha (Month Sha)' },
  亡神: { ru: 'Ван Шэнь (Рассеянность)', zh: '亡神', en: 'Wang Shen (Lost Spirit)' },
};

// Transit stars emitted by `iztro` (运魁..时马)
const TRANSIT_PREFIXES: ReadonlyArray<{ zh: string; ru: string; en: string }> = [
  { zh: '运', ru: 'Такт:', en: 'Decade ' },
  { zh: '流', ru: 'Год:', en: 'Year ' },
  { zh: '月', ru: 'Месяц:', en: 'Month ' },
  { zh: '日', ru: 'День:', en: 'Day ' },
  { zh: '时', ru: 'Час:', en: 'Hour ' },
];

const TRANSIT_BASES: ReadonlyArray<{ zh: string; fullZh: string }> = [
  { zh: '魁', fullZh: '天魁' },
  { zh: '钺', fullZh: '天钺' },
  { zh: '昌', fullZh: '文昌' },
  { zh: '曲', fullZh: '文曲' },
  { zh: '鸾', fullZh: '红鸾' },
  { zh: '喜', fullZh: '天喜' },
  { zh: '禄', fullZh: '禄存' },
  { zh: '羊', fullZh: '擎羊' },
  { zh: '陀', fullZh: '陀罗' },
  { zh: '马', fullZh: '天马' },
];

const STAR_LABELS_MUTABLE: Record<string, LocalizedText> = { ...BASE_STAR_LABELS };
for (const prefix of TRANSIT_PREFIXES) {
  for (const base of TRANSIT_BASES) {
    const key = `${prefix.zh}${base.zh}`;
    const baseEntry = BASE_STAR_LABELS[base.fullZh];
    if (baseEntry) {
      STAR_LABELS_MUTABLE[key] = {
        ru: `${prefix.ru} ${baseEntry.ru}`,
        zh: key,
        en: `${prefix.en}${baseEntry.en}`,
      };
    }
  }
}

export const STAR_LABELS: Readonly<Record<string, LocalizedText>> = STAR_LABELS_MUTABLE;

// ────────────────── SiHua & Brightness ──────────────────

export const SIHUA_LABELS: Readonly<Record<SiHua, LocalizedText>> = {
  禄: { ru: 'Хуа Лу (Процветание)', zh: '化禄', en: 'Hua Lu (Prosperity)' },
  权: { ru: 'Хуа Цюань (Власть)', zh: '化权', en: 'Hua Quan (Authority)' },
  科: { ru: 'Хуа Кэ (Слава / Знания)', zh: '化科', en: 'Hua Ke (Fame / Knowledge)' },
  忌: { ru: 'Хуа Цзи (Препятствие / Завязка)', zh: '化忌', en: 'Hua Ji (Obstacle / Focus)' },
};

export const BRIGHTNESS_LABELS: Readonly<
  Record<StarBrightness | 'bright' | 'normal' | 'dim', LocalizedText>
> = {
  庙: { ru: 'Храм (пик силы)', zh: '庙', en: 'Temple (Peak)' },
  旺: { ru: 'Расцвет (сильная)', zh: '旺', en: 'Prosperous (Strong)' },
  得: { ru: 'Опора (уверенная)', zh: '得', en: 'Gained (Steady)' },
  利: { ru: 'Благо (гармоничная)', zh: '利', en: 'Beneficial (Favorable)' },
  平: { ru: 'Нейтральная', zh: '平', en: 'Neutral' },
  不: { ru: 'Слабая', zh: '不', en: 'Subdued' },
  闲: { ru: 'Покой (пассивная)', zh: '闲', en: 'Idle' },
  陷: { ru: 'Затмение (ослабленная)', zh: '陷', en: 'Fallen (Weak)' },
  地: { ru: 'Земная (сниженная)', zh: '地', en: 'Grounded (Low)' },
  bright: { ru: 'Яркая', zh: '庙旺', en: 'Bright' },
  normal: { ru: 'Средняя', zh: '平和', en: 'Normal' },
  dim: { ru: 'Слабая', zh: '落陷', en: 'Dim' },
};

// ────────────────── 5-Element Bureau, Stems, Branches, Gender ──────────────────

export const WUXING_JU_LABELS: Readonly<Record<string, LocalizedText>> = {
  水二局: { ru: '2-е Бюро Воды', zh: '水二局', en: 'Water 2nd Bureau' },
  木三局: { ru: '3-е Бюро Дерева', zh: '木三局', en: 'Wood 3rd Bureau' },
  金四局: { ru: '4-е Бюро Металла', zh: '金四局', en: 'Metal 4th Bureau' },
  土五局: { ru: '5-е Бюро Земли', zh: '土五局', en: 'Earth 5th Bureau' },
  火六局: { ru: '6-е Бюро Огня', zh: '火六局', en: 'Fire 6th Bureau' },
};

const JU_NUMBER_TO_NAME: Readonly<Record<number, string>> = {
  2: '水二局',
  3: '木三局',
  4: '金四局',
  5: '土五局',
  6: '火六局',
};

export const STEM_LABELS: Readonly<Record<string, LocalizedText>> = {
  甲: { ru: 'Цзя (Ян Дерево)', zh: '甲', en: 'Jia (Yang Wood)' },
  乙: { ru: 'И (Инь Дерево)', zh: '乙', en: 'Yi (Yin Wood)' },
  丙: { ru: 'Бин (Ян Огонь)', zh: '丙', en: 'Bing (Yang Fire)' },
  丁: { ru: 'Дин (Инь Огонь)', zh: '丁', en: 'Ding (Yin Fire)' },
  戊: { ru: 'У (Ян Земля)', zh: '戊', en: 'Wu (Yang Earth)' },
  己: { ru: 'Цзи (Инь Земля)', zh: '己', en: 'Ji (Yin Earth)' },
  庚: { ru: 'Гэн (Ян Металл)', zh: '庚', en: 'Geng (Yang Metal)' },
  辛: { ru: 'Синь (Инь Металл)', zh: '辛', en: 'Xin (Yin Metal)' },
  壬: { ru: 'Жэнь (Ян Вода)', zh: '壬', en: 'Ren (Yang Water)' },
  癸: { ru: 'Гуй (Инь Вода)', zh: '癸', en: 'Gui (Yin Water)' },
};

export const BRANCH_LABELS: Readonly<Record<string, LocalizedText>> = {
  子: { ru: 'Цзы (Крыса)', zh: '子', en: 'Zi (Rat)' },
  丑: { ru: 'Чоу (Бык)', zh: '丑', en: 'Chou (Ox)' },
  寅: { ru: 'Инь (Тигр)', zh: '寅', en: 'Yin (Tiger)' },
  卯: { ru: 'Мао (Кролик)', zh: '卯', en: 'Mao (Rabbit)' },
  辰: { ru: 'Чэнь (Дракон)', zh: '辰', en: 'Chen (Dragon)' },
  巳: { ru: 'Сы (Змея)', zh: '巳', en: 'Si (Snake)' },
  午: { ru: 'У (Лошадь)', zh: '午', en: 'Wu (Horse)' },
  未: { ru: 'Вэй (Коза)', zh: '未', en: 'Wei (Goat)' },
  申: { ru: 'Шэнь (Обезьяна)', zh: '申', en: 'Shen (Monkey)' },
  酉: { ru: 'Ю (Петух)', zh: '酉', en: 'You (Rooster)' },
  戌: { ru: 'Сюй (Собака)', zh: '戌', en: 'Xu (Dog)' },
  亥: { ru: 'Хай (Свинья)', zh: '亥', en: 'Hai (Pig)' },
};

export const GENDER_LABELS: Readonly<Record<'male' | 'female', LocalizedText>> = {
  male: { ru: 'Мужской', zh: '男', en: 'Male' },
  female: { ru: 'Женский', zh: '女', en: 'Female' },
};

export const YINYANG_LABELS: Readonly<Record<'阳' | '阴', LocalizedText>> = {
  阳: { ru: 'Ян', zh: '阳', en: 'Yang' },
  阴: { ru: 'Инь', zh: '阴', en: 'Yin' },
};

export const YINYANG_GENDER_LABELS: Readonly<Record<string, LocalizedText>> = {
  阳男: { ru: 'Ян Мужчина', zh: '阳男', en: 'Yang Male' },
  阴男: { ru: 'Инь Мужчина', zh: '阴男', en: 'Yin Male' },
  阳女: { ru: 'Ян Женщина', zh: '阳女', en: 'Yang Female' },
  阴女: { ru: 'Инь Женщина', zh: '阴女', en: 'Yin Female' },
};

// ────────────────── Analysis & Synastry Domain Terms ──────────────────

export const PATTERN_LEVEL_LABELS: Readonly<Record<PatternSummary['level'], LocalizedText>> = {
  excellent: { ru: 'Высшая конфигурация', zh: '上等格局', en: 'Premier Pattern' },
  good: { ru: 'Благоприятный паттерн', zh: '吉利格局', en: 'Favorable Pattern' },
  neutral: { ru: 'Нейтральная структура', zh: '中性格局', en: 'Balanced Pattern' },
  caution: { ru: 'Зона особого внимания', zh: '需留意格局', en: 'Caution Pattern' },
};

export const PAIN_POINT_CATEGORY_LABELS: Readonly<Record<PainPointCategory, LocalizedText>> = {
  natal_huaji: {
    ru: 'Натальная Хуа Цзи',
    zh: '生年化忌',
    en: 'Natal Hua Ji',
  },
  self_huaji: {
    ru: 'Самотрансформация Хуа Цзи',
    zh: '宫干自化忌',
    en: 'Palace Self Hua Ji',
  },
  daxian_huaji: {
    ru: 'Декадная Хуа Цзи (Да Сянь)',
    zh: '大限化忌',
    en: 'Decade Hua Ji',
  },
  liunian_huaji: {
    ru: 'Годовая Хуа Цзи (Лю Нянь)',
    zh: '流年化忌',
    en: 'Annual Hua Ji',
  },
  double_huaji: {
    ru: 'Двойной резонанс Хуа Цзи',
    zh: '双忌叠加 / 冲夹',
    en: 'Double Hua Ji Overlap / Clash',
  },
  sha_cluster: {
    ru: 'Скопление звёзд напряжения',
    zh: '煞星聚会',
    en: 'Sha Star Cluster',
  },
};

export const PAIN_POINT_SEVERITY_LABELS: Readonly<Record<PainPointSeverity, LocalizedText>> = {
  high: { ru: 'Высокий приоритет', zh: '高关注', en: 'High Priority' },
  medium: { ru: 'Средний приоритет', zh: '中关注', en: 'Medium Priority' },
  watch: { ru: 'Наблюдение', zh: '留意', en: 'Watch' },
};

export const FIVE_ELEMENTS_LABELS: Readonly<Record<string, LocalizedText>> = {
  木: { ru: 'Дерево', zh: '木', en: 'Wood' },
  火: { ru: 'Огонь', zh: '火', en: 'Fire' },
  土: { ru: 'Земля', zh: '土', en: 'Earth' },
  金: { ru: 'Металл', zh: '金', en: 'Metal' },
  水: { ru: 'Вода', zh: '水', en: 'Water' },
};

export const BRANCH_RELATION_LABELS: Readonly<Record<string, LocalizedText>> = {
  same: { ru: 'Совпадение ветвей (Тун Вэй)', zh: '同位', en: 'Same Branch' },
  liuhe: { ru: 'Шесть Гармоний (Лю Хэ)', zh: '六合', en: 'Six Harmonies (Liu He)' },
  sanhe: { ru: 'Тройная Гармония (Сань Хэ)', zh: '三合', en: 'Three Harmonies (San He)' },
  liuchong: { ru: 'Прямое Столкновение (Лю Чун)', zh: '六冲', en: 'Six Clashes (Liu Chong)' },
  neutral: { ru: 'Нейтральная связь', zh: '平合', en: 'Neutral Relation' },
};

export const BOND_TYPE_LABELS: Readonly<Record<string, LocalizedText>> = {
  mutual_blessing: {
    ru: 'Взаимная поддержка и благословение',
    zh: '互禄互助之缘',
    en: 'Mutual Blessing Bond',
  },
  lu_ke_driven: {
    ru: 'Союз процветания и признания (Лу / Кэ)',
    zh: '禄科相映之缘',
    en: 'Prosperity & Wisdom Bond',
  },
  quan_driven: {
    ru: 'Динамичный союз воли и влияния (Цюань)',
    zh: '化权驱动之缘',
    en: 'Authority-Driven Bond',
  },
  mixed_karmic: {
    ru: 'Сложная связь роста и уроков',
    zh: '吉忌交织之缘',
    en: 'Mixed Karmic Bond',
  },
  mutual_ji_entanglement: {
    ru: 'Глубокая взаимная привязка через Хуа Цзи',
    zh: '双忌牵绊之缘',
    en: 'Mutual Hua Ji Entanglement',
  },
};

export const SYNASTRY_LEVEL_LABELS: Readonly<Record<string, LocalizedText>> = {
  五星: { ru: '5 звёзд — высшая совместимость', zh: '五星', en: '5 Stars — Exceptional Match' },
  四星: { ru: '4 звезды — сильный союз', zh: '四星', en: '4 Stars — Strong Compatibility' },
  三星: { ru: '3 звезды — сбалансированный союз', zh: '三星', en: '3 Stars — Balanced Match' },
  二星: { ru: '2 звезды — союз требует усилий', zh: '二星', en: '2 Stars — Needs Conscious Effort' },
  一星: { ru: '1 звезда — высокие трения', zh: '一星', en: '1 Star — High Friction' },
};

// ────────────────── Classical Patterns (44 static + dynamic) ──────────────────

export const PATTERN_LABELS: Readonly<Record<string, PatternLabelEntry>> = {
  君臣庆会: {
    name: {
      ru: 'Собрание Государя и Министров (Цзюнь Чэнь Цин Хуэй)',
      zh: '君臣庆会',
      en: 'Ruler & Ministers Assembly',
    },
    description: {
      ru: 'Цзы Вэй во Дворце Судьбы при поддержке Цзо Фу и Ю Би: редкий дар лидерства, протекции наставников и масштабного влияния.',
      zh: '紫微入命并得左辅右弼同会，主统御之才、贵人扶助与大格局发展。',
      en: 'Zi Wei in Life supported by Zuo Fu and You Bi; indicates strong leadership, influential allies, and high-level achievement.',
    },
  },
  紫府同宫: {
    name: {
      ru: 'Император и Сокровищница в одном дворце (Цзы Фу Тун Гун)',
      zh: '紫府同宫',
      en: 'Emperor & Treasury Co-Residing',
    },
    description: {
      ru: 'Соединение Цзы Вэй и Тянь Фу даёт внутреннее достоинство, стратегический масштаб и умение удерживать ресурсы.',
      zh: '紫微天府同宫，帝相并临，主品格稳重、统筹管理与衣食无忧。',
      en: 'Zi Wei and Tian Fu together confer dignity, sound judgment, executive poise, and steady abundance.',
    },
  },
  府相朝垣: {
    name: {
      ru: 'Сокровищница и Министр обращены ко Дворцу (Фу Сян Чао Юань)',
      zh: '府相朝垣',
      en: 'Treasury & Minister Facing Life',
    },
    description: {
      ru: 'Тянь Фу и Тянь Сян в триаде Судьбы обеспечивают устойчивый статус, достаток, системное управление и доверие окружения.',
      zh: '天府天相分守三方四正，主衣食丰足、地位稳固，宜管理与公职。',
      en: 'Tian Fu and Tian Xiang in the Life triad bring stable status, reliable provision, and administrative strength.',
    },
  },
  阳梁昌禄: {
    name: {
      ru: 'Солнце, Мудрец, Вэнь Чан и Лу Цунь (Ян Лян Чан Лу)',
      zh: '阳梁昌禄',
      en: 'Sun, Sage, Wen Chang & Lu Cun',
    },
    description: {
      ru: 'Классическая конфигурация учёных и экспертов: блестящие экзамены, исследования, преподавание и высокий профессиональный авторитет.',
      zh: '太阳、天梁、文昌、禄存齐会三方，利考运、学术研究与专业清贵之路。',
      en: 'Classic scholarly alignment favoring exams, research, education, and respected professional credentials.',
    },
  },
  火贪格: {
    name: {
      ru: 'Огонь и Волк Желаний (Хо Тань Гэ)',
      zh: '火贪格',
      en: 'Fire & Greedy Wolf Burst',
    },
    description: {
      ru: 'Тань Лан в резонансе с Хо Син даёт мощный рывок, неожиданные финансовые шансы и быстрый взлёт при условии дисциплины.',
      zh: '贪狼会火星，主突发机遇与横财爆发，但宜见好就收、控制节奏。',
      en: 'Tan Lang paired with Huo Xing sparks sudden breakthroughs and windfall opportunities when managed with discipline.',
    },
  },
  铃贪格: {
    name: {
      ru: 'Колокол и Волк Желаний (Лин Тань Гэ)',
      zh: '铃贪格',
      en: 'Bell & Greedy Wolf Burst',
    },
    description: {
      ru: 'Тань Лан в резонансе с Лин Син приносит нестандартные прорывы и быстрый доход через гибкость и смелые решения.',
      zh: '贪狼会铃星，主意外财源与奇遇，宜稳守成果而不贪急进。',
      en: 'Tan Lang with Ling Xing triggers sudden gains and unexpected turns that reward decisive, measured action.',
    },
  },
  武贪格: {
    name: {
      ru: 'Воин и Волк Желаний (У Тань Гэ)',
      zh: '武贪格',
      en: 'Warrior & Greedy Wolf',
    },
    description: {
      ru: 'Конфигурация позднего расцвета: финансовая мощь, связи и коммерческий успех раскрываются наиболее ярко после 30 лет.',
      zh: '武曲贪狼会命，主中年后厚积薄发，财源得自人脉经营与实业投资。',
      en: 'Late-blooming wealth pattern: Wu Qu and Tan Lang ripen after age 30 through networks, commerce, and sustained effort.',
    },
  },
  杀破狼: {
    name: {
      ru: 'Триада Первопроходцев (Ша По Лан)',
      zh: '杀破狼',
      en: 'Qi Sha, Po Jun & Tan Lang Triad',
    },
    description: {
      ru: 'Ци Ша, По Цзюнь и Тань Лан задают жизнь перемен, смелых начинаний, предпринимательства и преодоления границ.',
      zh: '七杀、破军、贪狼三星会命，主开创变动与闯荡之势，宜创业与一线开拓。',
      en: 'Dynamic pioneering triad driving constant transformation, bold enterprise, and resilience under change.',
    },
  },
  机月同梁: {
    name: {
      ru: 'Четыре Звезды Мудрости (Цзи Юэ Тун Лян)',
      zh: '机月同梁',
      en: 'Advisor, Moon, Harmony & Sage',
    },
    description: {
      ru: 'Гармоничный союз интеллекта, анализа и наставничества: сильная позиция для госслужбы, науки, медицины, консалтинга и сервиса.',
      zh: '天机、太阴、天同、天梁四星会齐三方四正，宜公职、教研、医疗与稳健专技。',
      en: 'Harmonious four-star alignment ideal for civil service, academia, medicine, strategy, and steady institutions.',
    },
  },
  廉贞天相格: {
    name: {
      ru: 'Лянь Чжэнь и Тянь Сян в одном дворце',
      zh: '廉贞天相格',
      en: 'Lian Zhen & Tian Xiang Co-Residing',
    },
    description: {
      ru: 'Печать принципиальности и порядка: подходит для права, администрирования, управления и системного планирования.',
      zh: '廉贞天相同宫，主秉公处事、行政管理与法务企划之才。',
      en: 'Balanced seal combination supporting governance, legal affairs, administration, and principled planning.',
    },
  },
  武曲七杀: {
    name: {
      ru: 'У Цюй и Ци Ша в одном дворце',
      zh: '武曲七杀',
      en: 'Wu Qu & Qi Sha Co-Residing',
    },
    description: {
      ru: 'Слияние финансовой хватки и воинской решительности: сильная воля, бизнес-дисциплина, но важно избегать перегрузок.',
      zh: '武曲七杀同宫，果决刚毅、善于理财与执行，忌煞忌过多。',
      en: 'Decisive pairing of finance and martial grit; excels in business execution while needing guardrails against excess.',
    },
  },
  天同天梁格: {
    name: {
      ru: 'Тянь Тун и Тянь Лян в одном дворце',
      zh: '天同天梁格',
      en: 'Tian Tong & Tian Liang Co-Residing',
    },
    description: {
      ru: 'Сочетание благодати и мудрой опеки: доброжелательность, стремление помогать, успех в образовании, медицине и гуманитарной сфере.',
      zh: '天同天梁同宫，主宽厚温和、乐于助人，宜教育、医疗与公益服务。',
      en: 'Gentle, protective pairing suited to education, healthcare, counseling, and service-oriented leadership.',
    },
  },
  日月同宫: {
    name: {
      ru: 'Солнце и Луна в одном дворце (Жи Юэ Тун Гун)',
      zh: '日月同宫',
      en: 'Sun & Moon Co-Residing',
    },
    description: {
      ru: 'Соединение Тай Ян и Тай Инь уравновешивает инь и ян, поддерживая известность, гибкость мышления и развитие карьеры.',
      zh: '太阳太阴同宫，阴阳调和、文武兼备，主名声与事业顺遂。',
      en: 'Tai Yang and Tai Yin sharing a palace balance yin and yang, supporting versatility, reputation, and steady progress.',
    },
  },
  日月夹命: {
    name: {
      ru: 'Солнце и Луна обрамляют Судьбу (Жи Юэ Цзя Мин)',
      zh: '日月夹命',
      en: 'Sun & Moon Flanking Life',
    },
    description: {
      ru: 'Тай Ян и Тай Инь по обе стороны Дворца Судьбы приносят ясность пути, сильных покровителей и рост благосостояния.',
      zh: '太阳太阴分夹命宫，光明磊落、贵人相扶，主事业蓬勃兴旺。',
      en: 'Sun and Moon flanking the Life Palace illuminate one’s path with supportive mentors and broad career growth.',
    },
  },
  巨日同宫: {
    name: {
      ru: 'Врата и Солнце в одном дворце (Цзюй Жи Тун Гун)',
      zh: '巨日同宫',
      en: 'Ju Men & Sun Co-Residing',
    },
    description: {
      ru: 'Солнце освещает Цзюй Мэнь: сила убеждения, ораторское искусство, медиа, языки и международная деятельность.',
      zh: '巨门太阳同宫，太阳化解巨门暗曜，主以口才、传媒、外语与专业立业。',
      en: 'Sun illuminates Ju Men, turning analytical speech into success across media, languages, law, and consulting.',
    },
  },
  石中隐玉: {
    name: {
      ru: 'Нефрит, скрытый в камне (Ши Чжун Инь Юй)',
      zh: '石中隐玉',
      en: 'Jade Hidden in Stone',
    },
    description: {
      ru: 'Цзюй Мэнь в Цзы или У: скромное начало и раскрытие глубокой компетенции к зрелому возрасту через мастерство слова и анализа.',
      zh: '巨门坐命子午，早年沉潜厚积、中年后凭专业与才学显贵。',
      en: 'Ju Men in Zi or Wu: quiet early years ripen into recognized mastery through expertise, research, and communication.',
    },
  },
  明珠出海: {
    name: {
      ru: 'Жемчужина, выходящая из моря (Мин Чжу Чу Хай)',
      zh: '明珠出海',
      en: 'Bright Pearl Rising from the Sea',
    },
    description: {
      ru: 'Пустой Дворец Судьбы в Вэй, озарённый Солнцем и Луной из Чоу: раскрытие потенциала вдали от дома и высокий рост своими силами.',
      zh: '命坐未空宫而对宫丑位日月并明照耀，主后天奋发成器、宜远行与大平台发展。',
      en: 'Empty Life Palace in Wei illuminated by bright Sun and Moon in Chou; signifies self-made eminence and broad horizons.',
    },
  },
  紫微入命: {
    name: {
      ru: 'Император Цзы Вэй во Дворце Судьбы',
      zh: '紫微入命',
      en: 'Zi Wei in Life Palace',
    },
    description: {
      ru: 'Сильная харизма, чувство собственного достоинства и организаторский дар; при поддержке помощников раскрывается в полной мере.',
      zh: '紫微坐命，自尊心强且具领导魅力，得左辅右弼相会方不致孤高。',
      en: 'Strong charisma, dignity, and natural leadership; reaches full potential when teamed with helpful allies.',
    },
  },
  辅弼夹命: {
    name: {
      ru: 'Помощники Цзо Фу и Ю Би обрамляют Судьбу',
      zh: '辅弼夹命',
      en: 'Zuo Fu & You Bi Flanking Life',
    },
    description: {
      ru: 'Мощная командная опора и умение объединять людей; верная поддержка коллег и наставников на ключевых этапах.',
      zh: '左辅右弼分夹命宫，象征贵人扶持与组织协调之优势。',
      en: 'Left and Right Support flanking Life bring reliable teamwork, organizational talent, and timely help.',
    },
  },
  昌曲夹命: {
    name: {
      ru: 'Вэнь Чан и Вэнь Цюй обрамляют Судьбу',
      zh: '昌曲夹命',
      en: 'Wen Chang & Wen Qu Flanking Life',
    },
    description: {
      ru: 'Высокий интеллект, красноречие, вкус к науке, литературе и искусству; отличная конфигурация для учёбы и творчества.',
      zh: '文昌文曲夹命宫，主聪慧文采，利学术、写作、艺术与考运。',
      en: 'Literary and artistic stars flanking Life bless intellect, eloquence, creativity, and academic exams.',
    },
  },
  魁钺夹命: {
    name: {
      ru: 'Тянь Куй и Тянь Юэ обрамляют Судьбу',
      zh: '魁钺夹命',
      en: 'Tian Kui & Tian Yue Flanking Life',
    },
    description: {
      ru: 'Двойная звезда покровительства: своевременная помощь влиятельных людей на экзаменах, в карьере и в переломные моменты.',
      zh: '天魁天钺夹命，一生多得贵人提携，关键时刻常遇助力。',
      en: 'Day and Night Noble stars flanking Life attract timely mentors during exams, job shifts, and turning points.',
    },
  },
  双禄朝垣: {
    name: {
      ru: 'Двойное Процветание во Дворце (Шуан Лу Чао Юань)',
      zh: '双禄朝垣',
      en: 'Dual Wealth Stars Converging',
    },
    description: {
      ru: 'Хуа Лу и Лу Цунь в триаде Судьбы создают устойчивый финансовый поток и богатые возможности материального роста.',
      zh: '化禄与禄存同会命宫三方四正，财源涌动、衣食丰足。',
      en: 'Hua Lu and Lu Cun converging in the Life triad foster abundant cash flow and lasting material security.',
    },
  },
  三奇加会: {
    name: {
      ru: 'Три Чудесные Трансформации (Сань Ци Цзя Хуэй)',
      zh: '三奇加会',
      en: 'Three Auspicious Transformations',
    },
    description: {
      ru: 'Совместное присутствие Хуа Лу, Хуа Цюань и Хуа Кэ в триаде Судьбы: редкое сочетание богатства, влияния и признания.',
      zh: '化禄、化权、化科三吉化齐会命宫三方四正，主财富、名望与权责兼备。',
      en: 'Hua Lu, Hua Quan, and Hua Ke uniting in the Life triad signify rare harmony of wealth, authority, and acclaim.',
    },
  },
  羊陀夹忌: {
    name: {
      ru: 'Клинок и Вихрь зажимают Хуа Цзи (Ян То Цзя Цзи)',
      zh: '羊陀夹忌',
      en: 'Blade & Hurdle Flanking Hua Ji',
    },
    description: {
      ru: 'Испытание через внешнее давление и перегрузки; требует терпения, аккуратного планирования и отказа от импульсивных шагов.',
      zh: '化忌坐命且左右逢擎羊陀罗夹制，提醒稳步化解压力、审慎决策。',
      en: 'Hua Ji flanked by Qing Yang and Tuo Luo signals pressure; calls for patience, steady habits, and careful planning.',
    },
  },
  火铃夹命: {
    name: {
      ru: 'Огонь и Колокол обрамляют Судьбу (Хо Лин Цзя Мин)',
      zh: '火铃夹命',
      en: 'Fire & Bell Flanking Life',
    },
    description: {
      ru: 'Повышенный темп и эмоциональная импульсивность; важно развивать выдержку и проверять риски до резких решений.',
      zh: '火星铃星夹命，主节奏急促、易冲动，宜培养耐性与风险意识。',
      en: 'Huo Xing and Ling Xing flanking Life heighten urgency and restlessness; cultivating calm pacing reduces friction.',
    },
  },
  空劫夹命: {
    name: {
      ru: 'Пустота и Потеря обрамляют Судьбу (Кун Цзе Цзя Мин)',
      zh: '空劫夹命',
      en: 'Void & Loss Flanking Life',
    },
    description: {
      ru: 'Нестандартное мышление, духовный поиск, склонность к философии и ремеслу; финансы требуют строгого бюджета и резерва.',
      zh: '地空地劫夹命，思想脱俗而财宜规划，利技艺、研发与哲学探索。',
      en: 'Di Kong and Di Jie flanking Life confer unconventional insight suited to crafts, research, or philosophy with careful budgeting.',
    },
  },
  廉杀羊: {
    name: {
      ru: 'Триада Лянь Чжэнь, Ци Ша и Цин Ян',
      zh: '廉杀羊',
      en: 'Lian Zhen, Qi Sha & Qing Yang',
    },
    description: {
      ru: 'Концентрированная энергия действия и риска: в активные периоды требует осторожности на дороге, в конфликтах и здоровье.',
      zh: '廉贞、七杀、擎羊同会三方，运限逢之需注重出行安全、人际缓和与理性决策。',
      en: 'High-intensity combination advising extra care around travel safety, conflict management, and measured decisions.',
    },
  },
  巨火羊: {
    name: {
      ru: 'Триада Цзюй Мэнь, Хо Син и Цин Ян',
      zh: '巨火羊',
      en: 'Ju Men, Huo Xing & Qing Yang',
    },
    description: {
      ru: 'Резкость слова и накал эмоций: лучшая профилактика — мягкая дипломатичная речь и осознанное управление реакциями.',
      zh: '巨门、火星、擎羊会照，主言辞易激起摩擦，宜修习温和沟通与情绪觉察。',
      en: 'Blunt speech and heated reactions can spark disputes; practicing tactful communication and calm self-regulation helps.',
    },
  },
  铃昌陀武: {
    name: {
      ru: 'Сочетание Лин Син, Вэнь Чан, То Ло и У Цюй',
      zh: '铃昌陀武',
      en: 'Ling Xing, Wen Chang, Tuo Luo & Wu Qu',
    },
    description: {
      ru: 'Сигнальная конфигурация: в важные периоды важно избегать поспешных финансовых и юридических шагов и беречь внутренний баланс.',
      zh: '铃星、文昌、陀罗、武曲齐会，运限触发时宜理性处理重大决策并保持生活稳定。',
      en: 'Alert configuration advising extra diligence on contracts, major financial moves, and emotional stability in active cycles.',
    },
  },
  马头带箭: {
    name: {
      ru: 'Стрела во главе Коня (Ма Тоу Дай Цзянь)',
      zh: '马头带箭',
      en: 'Arrow at the Horse’s Head',
    },
    description: {
      ru: 'Цин Ян в У во Дворце Судьбы: мощный пробивной характер и лидерство в действии; при поддержке благих звёзд приносит высокий авторитет.',
      zh: '擎羊坐命午宫，象征果决执行力与开拓精神，得吉星配合方能发挥所长。',
      en: 'Qing Yang in Wu in Life reflects fierce drive and decisiveness; blossoms best when balanced by auspicious stars.',
    },
  },
  禄存守命: {
    name: {
      ru: 'Лу Цунь хранит Дворец Судьбы',
      zh: '禄存守命',
      en: 'Lu Cun Guarding Life',
    },
    description: {
      ru: 'Стабильное материальное обеспечение, бережливость и умение накапливать ресурсы при осторожном подходе к окружению.',
      zh: '禄存坐命，主衣食稳足、善于积累，宜配合化禄与辅弼拓宽格局。',
      en: 'Brings steady material stability, prudence, and gradual wealth accumulation; flourishes further with Hua Lu and helpers.',
    },
  },
  禄存守身: {
    name: {
      ru: 'Лу Цунь хранит Дворец Тела',
      zh: '禄存守身',
      en: 'Lu Cun Guarding Body',
    },
    description: {
      ru: 'Укрепление финансовой базы во второй половине жизни через надёжную практику, партнёрство и созидательный труд.',
      zh: '禄存入身宫，主中年后财源稳健，常因稳健实业或伴侣助力而积禄。',
      en: 'Supports steady mid-life income and asset building through practical industry and supportive partnerships.',
    },
  },
  天马入命: {
    name: {
      ru: 'Тянь Ма во Дворце Судьбы',
      zh: '天马入命',
      en: 'Tian Ma in Life Palace',
    },
    description: {
      ru: 'Жизнь в движении, командировки и доход через перемены; в связке с Лу Цунь или Хуа Лу даёт сильный финансовый разгон.',
      zh: '天马坐命，主奔波开拓、动中得财，若会禄存或化禄则成禄马交驰之象。',
      en: 'Signals mobility, travel, and opportunity through change; gains strong momentum when paired with Lu Cun or Hua Lu.',
    },
  },
  天马在迁: {
    name: {
      ru: 'Тянь Ма во Дворце Перемещений',
      zh: '天马在迁',
      en: 'Tian Ma in Travel Palace',
    },
    description: {
      ru: 'Успех в поездках, переездах и работе с другими регионами и странами.',
      zh: '天马居迁移宫，利外出远行、异地发展与跨界往来。',
      en: 'Favors travel, relocation, cross-regional ventures, and thriving away from one’s birthplace.',
    },
  },
  化禄入财: {
    name: {
      ru: 'Хуа Лу во Дворце Богатства',
      zh: '化禄入财',
      en: 'Hua Lu in Wealth Palace',
    },
    description: {
      ru: 'Свободный приток доходов и благоприятная финансовая циркуляция через ключевые таланты звезды-носителя.',
      zh: '化禄入财帛宫，主财源畅通、正财顺遂，会禄存或天马则增益更显。',
      en: 'Supports smooth cash flow and steady income anchored by the talents of the transformed star.',
    },
  },
  化权入官: {
    name: {
      ru: 'Хуа Цюань во Дворце Карьеры',
      zh: '化权入官',
      en: 'Hua Quan in Career Palace',
    },
    description: {
      ru: 'Управленческая сила, самостоятельность в решениях и способность вести сложные проекты или команды.',
      zh: '化权入官禄宫，主事业掌控力强、有执行权威，宜管理或核心技术路线。',
      en: 'Indicates career authority, decisive execution, and readiness for management or senior technical leadership.',
    },
  },
  化科入命: {
    name: {
      ru: 'Хуа Кэ во Дворце Судьбы',
      zh: '化科入命',
      en: 'Hua Ke in Life Palace',
    },
    description: {
      ru: 'Доброе имя, уважение за знания и экспертность; успех в обучении, консалтинге, исследованиях и медиа.',
      zh: '化科入命宫，主清誉、文书与学术运佳，宜教育、研究、咨询等以名立业之途。',
      en: 'Enhances reputation, scholarly luck, and recognized expertise; ideal for teaching, consulting, research, and publishing.',
    },
  },
  化科入身: {
    name: {
      ru: 'Хуа Кэ во Дворце Тела',
      zh: '化科入身',
      en: 'Hua Ke in Body Palace',
    },
    description: {
      ru: 'Укрепление репутации, благородная поддержка и профессиональное признание по мере накопления опыта.',
      zh: '化科入身宫，主名望与贵人助力随历练增长，宜凭专业声誉立足。',
      en: 'Builds lasting credibility, helpful mentors, and respected professional standing over time.',
    },
  },
  机月同梁三星会: {
    name: {
      ru: 'Три из четырёх звёзд мудрости (неполная триада)',
      zh: '机月同梁三星会',
      en: 'Partial Wisdom Triad (3 of 4 Stars)',
    },
    description: {
      ru: 'Собраны 3 из 4 звёзд конфигурации Цзи Юэ Тун Лян: сохраняется склонность к системной и интеллектуальной работе при учёте недостающего звена.',
      zh: '机月同梁四星只会其三，仍具文质稳健与专业累积特质，宜结合缺星与四化观察。',
      en: 'Three of the four wisdom stars gather in the Life triad; still favors steady analytical or institutional work.',
    },
  },
  昌曲坐命: {
    name: {
      ru: 'Вэнь Чан и Вэнь Цюй во Дворце Судьбы',
      zh: '昌曲坐命',
      en: 'Wen Chang & Wen Qu in Life',
    },
    description: {
      ru: 'Живой ум, литературное чутье, блеск в науке и публичной речи; важно следить за аккуратностью в документах.',
      zh: '文昌文曲同入命宫，文采出众、利文学教研，唯遇化忌时需留意契约文书。',
      en: 'Sharp intellect and literary grace supporting writing, teaching, and communication; review contracts if Hua Ji appears.',
    },
  },
  昌曲同会: {
    name: {
      ru: 'Вэнь Чан и Вэнь Цюй сходятся в триаде',
      zh: '昌曲同会',
      en: 'Wen Chang & Wen Qu Converging',
    },
    description: {
      ru: 'Яркие способности к выражению мыслей, обучению и творчеству, особенно сильные в сочетании с Хуа Кэ.',
      zh: '文昌文曲同会三方四正，口才与文笔俱佳，遇化科则名声尤显。',
      en: 'Strong expressive and creative abilities in the Life triad, amplified when linked with Hua Ke.',
    },
  },
  辅弼同会: {
    name: {
      ru: 'Цзо Фу и Ю Би сходятся в триаде',
      zh: '辅弼同会',
      en: 'Zuo Fu & You Bi Converging',
    },
    description: {
      ru: 'Надёжная поддержка людей, сильные деловые связи и преимущество в командной и координационной работе.',
      zh: '左辅右弼同会三方四正，贵人多助、人缘佳，最宜团队统筹与协作。',
      en: 'Strong interpersonal backing and teamwork capability; thrives through collaboration rather than working alone.',
    },
  },
  魁钺同会: {
    name: {
      ru: 'Тянь Куй и Тянь Юэ сходятся в триаде',
      zh: '魁钺同会',
      en: 'Tian Kui & Tian Yue Converging',
    },
    description: {
      ru: 'Незримая протекция и своевременные подсказки от старших и опытных наставников в трудные моменты.',
      zh: '天魁天钺同会三方四正，关键时刻常得长辈或贤达相助，宜善维良缘。',
      en: 'Attracting helpful mentors and timely breakthroughs during challenges through cultivated relationships.',
    },
  },
  科权双会: {
    name: {
      ru: 'Союз Славы и Власти (Кэ Цюань Шуан Хуэй)',
      zh: '科权双会',
      en: 'Hua Ke & Hua Quan Converging',
    },
    description: {
      ru: 'Соединение авторитетных знаний (Хуа Кэ) и управленческой воли (Хуа Цюань): путь ведущего эксперта или руководителя.',
      zh: '化科与化权同会三方四正，名望与掌控力兼具，宜走专业权威之路。',
      en: 'Unites professional credibility (Hua Ke) with executive control (Hua Quan), ideal for expert leadership roles.',
    },
  },
};

// ────────────────── Primitive Translators ──────────────────

export function translatePalace(palaceName: string, lang: SupportedLang): string {
  const trimmed = palaceName.trim();
  if (!trimmed) return palaceName;

  const direct = PALACE_LABELS[trimmed];
  if (direct) return pick(direct, lang);

  if (SHORT_PALACE_ALIAS_TO_FULL[trimmed]) {
    const mapped = PALACE_LABELS[SHORT_PALACE_ALIAS_TO_FULL[trimmed]];
    if (mapped) {
      return lang === 'zh' ? trimmed : pick(mapped, lang);
    }
  }

  const withoutSuffix = trimmed.endsWith('宫') ? trimmed.slice(0, -1) : `${trimmed}宫`;
  const alt = PALACE_LABELS[withoutSuffix];
  if (alt) {
    return lang === 'zh' ? trimmed : pick(alt, lang);
  }

  return palaceName;
}

export function translateStar(starName: string, lang: SupportedLang): string {
  const trimmed = starName.trim();
  if (!trimmed) return starName;

  const direct = STAR_LABELS[trimmed];
  if (direct) return pick(direct, lang);

  return starName;
}

export function translateSiHua(siHua: SiHua | string, lang: SupportedLang): string {
  const trimmed = siHua.trim();
  if (!trimmed) return siHua;

  const normalized = (trimmed.startsWith('化') ? trimmed.slice(1) : trimmed) as SiHua;
  const entry = SIHUA_LABELS[normalized];
  if (entry) return pick(entry, lang);

  return siHua;
}

export function translateBrightness(
  brightness: StarBrightness | 'bright' | 'normal' | 'dim' | string,
  lang: SupportedLang,
): string {
  const trimmed = brightness.trim();
  if (!trimmed) return brightness;

  const entry = BRIGHTNESS_LABELS[trimmed as StarBrightness | 'bright' | 'normal' | 'dim'];
  if (entry) return pick(entry, lang);

  return brightness;
}

export function translateWuxingJu(
  wuxingJu: number | string,
  lang: SupportedLang,
): string {
  if (typeof wuxingJu === 'number') {
    const name = JU_NUMBER_TO_NAME[wuxingJu];
    if (name && WUXING_JU_LABELS[name]) {
      return pick(WUXING_JU_LABELS[name], lang);
    }
    return String(wuxingJu);
  }

  const trimmed = wuxingJu.trim();
  if (WUXING_JU_LABELS[trimmed]) {
    return pick(WUXING_JU_LABELS[trimmed], lang);
  }

  const numeric = Number(trimmed);
  if (Number.isInteger(numeric) && JU_NUMBER_TO_NAME[numeric]) {
    return pick(WUXING_JU_LABELS[JU_NUMBER_TO_NAME[numeric]], lang);
  }

  return wuxingJu;
}

export function translateBranch(branch: number | string, lang: SupportedLang): string {
  if (typeof branch === 'number') {
    if (!Number.isFinite(branch)) return String(branch);
    const idx = ((Math.trunc(branch) % 12) + 12) % 12;
    const key = BRANCHES[idx];
    return key && BRANCH_LABELS[key] ? pick(BRANCH_LABELS[key], lang) : String(branch);
  }

  const trimmed = branch.trim();
  if (BRANCH_LABELS[trimmed]) {
    return pick(BRANCH_LABELS[trimmed], lang);
  }

  return branch;
}

export function translateStem(stem: number | string, lang: SupportedLang): string {
  if (typeof stem === 'number') {
    if (!Number.isFinite(stem)) return String(stem);
    const idx = ((Math.trunc(stem) % 10) + 10) % 10;
    const key = STEMS[idx];
    return key && STEM_LABELS[key] ? pick(STEM_LABELS[key], lang) : String(stem);
  }

  const trimmed = stem.trim();
  if (STEM_LABELS[trimmed]) {
    return pick(STEM_LABELS[trimmed], lang);
  }

  return stem;
}

export function translateGender(gender: string, lang: SupportedLang): string {
  const trimmed = gender.trim().toLowerCase();
  if (trimmed === 'male' || trimmed === '男') {
    return pick(GENDER_LABELS.male, lang);
  }
  if (trimmed === 'female' || trimmed === '女') {
    return pick(GENDER_LABELS.female, lang);
  }
  return gender;
}

export function translateYinYang(yinYang: string, lang: SupportedLang): string {
  const trimmed = yinYang.trim().toLowerCase();
  if (trimmed === '阳' || trimmed === 'yang') {
    return pick(YINYANG_LABELS['阳'], lang);
  }
  if (trimmed === '阴' || trimmed === 'yin') {
    return pick(YINYANG_LABELS['阴'], lang);
  }
  return yinYang;
}

export function translateYinYangGender(value: string, lang: SupportedLang): string {
  const trimmed = value.trim();
  const entry = YINYANG_GENDER_LABELS[trimmed];
  if (entry) return pick(entry, lang);
  return value;
}

// ────────────────── Pattern Translation ──────────────────

function translateCategoryOrLevel(
  category: string | undefined,
  lang: SupportedLang,
): string | undefined {
  if (!category) return undefined;
  const trimmed = category.trim();
  if (!trimmed) return undefined;

  if (trimmed in PATTERN_LEVEL_LABELS) {
    return pick(PATTERN_LEVEL_LABELS[trimmed as PatternSummary['level']], lang);
  }
  if (trimmed in PAIN_POINT_CATEGORY_LABELS) {
    return pick(PAIN_POINT_CATEGORY_LABELS[trimmed as PainPointCategory], lang);
  }
  return trimmed;
}

/**
 * Translate a classical or dynamic Zi Wei Dou Shu pattern entry.
 */
export function translatePattern(
  name: string,
  category: string | undefined,
  description: string | undefined,
  lang: SupportedLang = 'ru',
): TranslatedPatternText {
  const translatedCategory = translateCategoryOrLevel(category, lang);

  if (lang === 'zh') {
    const entry = PATTERN_LABELS[name];
    return {
      name,
      ...(translatedCategory ? { category: translatedCategory } : {}),
      description: description?.trim() || entry?.description.zh || name,
    };
  }

  const staticEntry = PATTERN_LABELS[name];
  if (staticEntry) {
    return {
      name: pick(staticEntry.name, lang),
      ...(translatedCategory ? { category: translatedCategory } : {}),
      description: pick(staticEntry.description, lang),
    };
  }

  // Dynamic `${star}化禄入命`
  const huaLuMatch = /^(.+?)化禄入命$/.exec(name);
  if (huaLuMatch) {
    const starZh = huaLuMatch[1];
    const starLabel = translateStar(starZh, lang);
    if (lang === 'ru') {
      return {
        name: `${starLabel} — Хуа Лу во Дворце Судьбы`,
        ...(translatedCategory ? { category: translatedCategory } : {}),
        description: `Звезда ${starLabel} с трансформацией Хуа Лу во Дворце Судьбы приносит благоприятные шансы, поддержку людей и плавный рост доходов.`,
      };
    }
    return {
      name: `${starLabel} Hua Lu in Life`,
      ...(translatedCategory ? { category: translatedCategory } : {}),
      description: `${starLabel} carrying Hua Lu in the Life Palace brings natural flow of opportunities, goodwill, and steady material gains.`,
    };
  }

  // Dynamic `${star}化忌入命` / `${star}化忌入迁`
  const huaJiMatch = /^(.+?)化忌入(命|迁)$/.exec(name);
  if (huaJiMatch) {
    const starZh = huaJiMatch[1];
    const targetZh = huaJiMatch[2] === '命' ? '命宫' : '迁移';
    const starLabel = translateStar(starZh, lang);
    const palaceLabel = translatePalace(targetZh, lang);
    if (lang === 'ru') {
      return {
        name: `${starLabel} — Хуа Цзи (${palaceLabel})`,
        ...(translatedCategory ? { category: translatedCategory } : {}),
        description:
          targetZh === '命宫'
            ? `Звезда ${starLabel} с Хуа Цзи во Дворце Судьбы требует внимания к упрямству, внутренним зажимам и осознанному распределению сил.`
            : `Звезда ${starLabel} с Хуа Цзи во Дворце Перемещений советует осторожность в поездках, переездах и внешних договорённостях.`,
      };
    }
    return {
      name: `${starLabel} Hua Ji in ${palaceLabel}`,
      ...(translatedCategory ? { category: translatedCategory } : {}),
      description:
        targetZh === '命宫'
          ? `${starLabel} with Hua Ji in the Life Palace highlights an area needing patience, self-awareness, and measured pacing.`
          : `${starLabel} with Hua Ji in the Travel Palace calls for extra care during relocations, long trips, and external dealings.`,
    };
  }

  return {
    name,
    ...(translatedCategory ? { category: translatedCategory } : {}),
    description: description?.trim() || name,
  };
}

// ────────────────── Pain Point Facts & Chart Summary ──────────────────

function translateLayerName(layer: string, lang: SupportedLang): string {
  switch (layer) {
    case 'natal':
      return lang === 'ru' ? 'Натальный слой' : lang === 'zh' ? '生年四化' : 'Natal layer';
    case 'daxian':
      return lang === 'ru' ? 'Декада (Да Сянь)' : lang === 'zh' ? '大限四化' : 'Decade layer (Da Xian)';
    case 'liunian':
      return lang === 'ru' ? 'Годовой цикл (Лю Нянь)' : lang === 'zh' ? '流年四化' : 'Annual layer (Liu Nian)';
    case 'self':
      return lang === 'ru' ? 'Самотрансформация дворца' : lang === 'zh' ? '宫干自化' : 'Palace self-transformation';
    default:
      return layer;
  }
}

/**
 * Translate a structured `ChartPainPoint.facts` token emitted by `chart-analyzer.ts`.
 */
export function translatePainPointFact(fact: string, lang: SupportedLang): string {
  if (fact in PAIN_POINT_CATEGORY_LABELS) {
    return pick(PAIN_POINT_CATEGORY_LABELS[fact as PainPointCategory], lang);
  }
  if (fact === 'locked_palace') {
    return lang === 'ru'
      ? 'Ключевой жизненный дворец'
      : lang === 'zh'
        ? '核心人生宫位'
        : 'Key life-domain palace';
  }
  if (fact === 'life_palace') {
    return lang === 'ru'
      ? 'Дворец Судьбы (базовая ось карты)'
      : lang === 'zh'
        ? '命宫（全盘中枢）'
        : 'Life Palace (core chart axis)';
  }
  if (fact === 'clamped_by_yang_tuo') {
    return lang === 'ru'
      ? 'Зажато Цин Ян и То Ло с обеих сторон'
      : lang === 'zh'
        ? '擎羊陀罗夹制'
        : 'Flanked by Qing Yang and Tuo Luo';
  }
  if (fact === 'natal_plus_self_huaji') {
    return lang === 'ru'
      ? 'Натальная Хуа Цзи усилена самотрансформацией дворца'
      : lang === 'zh'
        ? '生年化忌叠宫干自化忌'
        : 'Natal Hua Ji reinforced by palace self-Hua Ji';
  }
  if (fact === 'triggers_self_huaji' || fact === 'cycle_triggers_self_huaji') {
    return lang === 'ru'
      ? 'Цикл активирует самотрансформацию Хуа Цзи'
      : lang === 'zh'
        ? '运限触发宫干自化忌'
        : 'Cycle activates palace self-Hua Ji';
  }
  if (fact === 'same_palace_double_ji') {
    return lang === 'ru'
      ? 'Двойная Хуа Цзи в одном дворце'
      : lang === 'zh'
        ? '同宫双忌叠加'
        : 'Double Hua Ji stacked in the same palace';
  }
  if (fact === 'self_sihua_ji') {
    return lang === 'ru'
      ? 'Ствол дворца запускает самотрансформацию Хуа Цзи'
      : lang === 'zh'
        ? '宫干自化忌'
        : 'Palace stem emits self-Hua Ji';
  }
  if (fact === 'clashes_opposite' || fact === 'opposite_clash') {
    return lang === 'ru'
      ? 'Импульс бьёт по противоположному дворцу'
      : lang === 'zh'
        ? '冲照对宫'
        : 'Clashes opposite palace';
  }
  if (fact === 'opposite_palace_double_ji') {
    return lang === 'ru'
      ? 'Взаимная Хуа Цзи на противоположной оси'
      : lang === 'zh'
        ? '对宫双忌对冲'
        : 'Opposite-axis double Hua Ji clash';
  }
  if (fact === 'clamped_by_huaji') {
    return lang === 'ru'
      ? 'Дворец зажат Хуа Цзи с соседних позиций'
      : lang === 'zh'
        ? '双邻宫化忌夹制'
        : 'Flanked by Hua Ji from adjacent palaces';
  }
  if (fact === 'empty_palace_borrowed') {
    return lang === 'ru'
      ? 'Пустой дворец (звёзды заимствованы из противоположного дворца)'
      : lang === 'zh'
        ? '空宫借对宫主星评估'
        : 'Empty palace evaluated via opposite stars';
  }

  const colonIdx = fact.indexOf(':');
  if (colonIdx > 0) {
    const key = fact.slice(0, colonIdx);
    const value = fact.slice(colonIdx + 1);
    switch (key) {
      case 'opposes_palace': {
        const pal = translatePalace(value, lang);
        return lang === 'ru' ? `Ось напротив: ${pal}` : lang === 'zh' ? `对宫：${pal}` : `Opposes: ${pal}`;
      }
      case 'star_dim': {
        const star = translateStar(value, lang);
        return lang === 'ru' ? `Ослабленная звезда: ${star}` : lang === 'zh' ? `落陷星曜：${star}` : `Dim star: ${star}`;
      }
      case 'star_brightness': {
        const br = translateBrightness(value, lang);
        return lang === 'ru' ? `Яркость: ${br}` : lang === 'zh' ? `亮度：${br}` : `Brightness: ${br}`;
      }
      case 'sha_present': {
        const star = translateStar(value, lang);
        return lang === 'ru' ? `Звезда напряжения: ${star}` : lang === 'zh' ? `同宫煞星：${star}` : `Sha star present: ${star}`;
      }
      case 'volatile_star': {
        const star = translateStar(value, lang);
        return lang === 'ru' ? `Динамичная главная звезда: ${star}` : lang === 'zh' ? `动荡主星：${star}` : `Volatile major star: ${star}`;
      }
      case 'palace_stem': {
        const stem = translateStem(value, lang);
        return lang === 'ru' ? `Ствол дворца: ${stem}` : lang === 'zh' ? `宫干：${stem}` : `Palace stem: ${stem}`;
      }
      case 'daxian_stem': {
        const stem = translateStem(value, lang);
        return lang === 'ru' ? `Ствол декады: ${stem}` : lang === 'zh' ? `大限宫干：${stem}` : `Decade stem: ${stem}`;
      }
      case 'liunian_stem': {
        const stem = translateStem(value, lang);
        return lang === 'ru' ? `Ствол года: ${stem}` : lang === 'zh' ? `流年天干：${stem}` : `Annual stem: ${stem}`;
      }
      case 'daxian_age':
        return lang === 'ru' ? `Возраст декады: ${value}` : lang === 'zh' ? `大限虚岁：${value}` : `Decade age: ${value}`;
      case 'layer':
        return translateLayerName(value, lang);
      case 'target_year':
        return lang === 'ru' ? `Целевой год: ${value}` : lang === 'zh' ? `目标年份：${value}` : `Target year: ${value}`;
      case 'sha_count':
        return lang === 'ru' ? `Число ша-звёзд: ${value}` : lang === 'zh' ? `煞星数量：${value}` : `Sha star count: ${value}`;
      case 'axis_palaces': {
        const parts = value.split('<->').map((p) => translatePalace(p, lang));
        return lang === 'ru'
          ? `Ось дворцов: ${parts.join(' ↔ ')}`
          : lang === 'zh'
            ? `对冲轴线：${parts.join(' ↔ ')}`
            : `Axis palaces: ${parts.join(' ↔ ')}`;
      }
      case 'flanking_palaces': {
        const parts = value.split('+').map((p) => translatePalace(p, lang));
        return lang === 'ru'
          ? `Соседние дворцы: ${parts.join(' + ')}`
          : lang === 'zh'
            ? `夹宫：${parts.join(' + ')}`
            : `Flanking palaces: ${parts.join(' + ')}`;
      }
      default:
        break;
    }
  }

  return fact;
}

function translateLayerSiHuaTag(tag: string, lang: SupportedLang): string {
  const colonIdx = tag.indexOf(':');
  if (colonIdx <= 0) {
    return translateSiHua(tag, lang);
  }
  const layer = tag.slice(0, colonIdx);
  const siHuaPart = tag.slice(colonIdx + 1);
  const layerText = translateLayerName(layer, lang);
  const siHuaText = translateSiHua(siHuaPart, lang);
  return `${layerText}: ${siHuaText}`;
}

function translateFreeStar(
  star: FreeStarSummary,
  lang: SupportedLang,
): TranslatedStarSummary {
  return {
    name: translateStar(star.name, lang),
    originalName: star.name,
    type: star.type,
    ...(star.brightness ? { brightness: translateBrightness(star.brightness, lang) } : {}),
    ...(star.brightnessRaw ? { brightnessRaw: translateBrightness(star.brightnessRaw, lang) } : {}),
    ...(star.siHua ? { siHua: translateSiHua(star.siHua, lang), siHuaCode: star.siHua } : {}),
    borrowed: star.borrowed,
  };
}

function translateSanFangPalace(
  palace: SanFangPalaceSummary,
  lang: SupportedLang,
): TranslatedPalaceSummary {
  return {
    palaceName: translatePalace(palace.palaceName, lang),
    originalPalaceName: palace.palaceName,
    branch: translateBranch(palace.branch, lang),
    branchIndex: palace.branch,
    stem: translateStem(palace.stem, lang),
    stemIndex: palace.stem,
    isEmpty: palace.isEmpty,
    majorStars: palace.majorStars.map((s) => translateFreeStar(s, lang)),
    ...(palace.borrowedFromName
      ? { borrowedFromName: translatePalace(palace.borrowedFromName, lang) }
      : {}),
    ...(palace.borrowedFromBranch !== undefined
      ? { borrowedFromBranch: translateBranch(palace.borrowedFromBranch, lang) }
      : {}),
    borrowedStars: palace.borrowedStars.map((name) => translateStar(name, lang)),
    effectiveMajorStars: palace.effectiveMajorStars.map((s) => translateFreeStar(s, lang)),
    luckyStars: palace.luckyStars.map((name) => translateStar(name, lang)),
    shaStars: palace.shaStars.map((name) => translateStar(name, lang)),
    favorableSiHua: palace.favorableSiHua.map((item) => ({
      starName: translateStar(item.starName, lang),
      siHua: translateSiHua(item.siHua, lang),
      siHuaCode: item.siHua,
    })),
  };
}

function translateFavorableSiHuaItem(
  item: FavorableSiHuaHighlight,
  lang: SupportedLang,
): TranslatedFavorableSiHua {
  return {
    siHua: translateSiHua(item.siHua, lang),
    siHuaCode: item.siHua,
    starName: translateStar(item.starName, lang),
    originalStarName: item.starName,
    starType: item.starType,
    palaceName: translatePalace(item.palaceName, lang),
    palaceBranch: translateBranch(item.palaceBranch, lang),
    inSanFang: item.inSanFang,
    inMingOrShen: item.inMingOrShen,
    ...(item.brightness ? { brightness: translateBrightness(item.brightness, lang) } : {}),
    ...(item.brightnessRaw ? { brightnessRaw: translateBrightness(item.brightnessRaw, lang) } : {}),
  };
}

function translatePainPointItem(
  point: ChartPainPoint,
  lang: SupportedLang,
): TranslatedPainPoint {
  return {
    id: point.id,
    palaceName: translatePalace(point.palaceName, lang),
    originalPalaceName: point.palaceName,
    palaceBranch: translateBranch(point.palaceBranch, lang),
    category: point.category,
    categoryLabel: pick(PAIN_POINT_CATEGORY_LABELS[point.category], lang),
    severity: point.severity,
    severityLabel: pick(PAIN_POINT_SEVERITY_LABELS[point.severity], lang),
    priorityScore: point.priorityScore,
    isLockedPalace: point.isLockedPalace,
    stars: point.stars.map((s) => translateStar(s, lang)),
    siHua: point.siHua.map((tag) => translateLayerSiHuaTag(tag, lang)),
    facts: point.facts.map((fact) => translatePainPointFact(fact, lang)),
  };
}

/**
 * Produce a fully localized summary structure from a `ZiweiChart`,
 * `ChartAnalysisSummary`, and detected `PatternSummary[]`.
 */
export function translateChartSummary(
  chart: ZiweiChart,
  analysis: ChartAnalysisSummary,
  patterns: readonly PatternSummary[],
  lang: SupportedLang,
): TranslatedChartSummary {
  const { mingSummary } = analysis;
  const mingPalace = translateSanFangPalace(mingSummary.mingPalace, lang);
  const shenPalaceBase = translateSanFangPalace(mingSummary.shenPalace, lang);
  const yinYangGenderRaw = mingSummary.yinYangGender || chart.yinYangGender || '';

  return {
    lang,
    basic: {
      wuxingJu: translateWuxingJu(mingSummary.wuxingJuName || chart.wuxingJuName || chart.wuxingJu, lang),
      wuxingJuNumber: mingSummary.wuxingJu || chart.wuxingJu,
      mingZhu: translateStar(mingSummary.mingZhu || chart.mingZhu || '', lang),
      shenZhu: translateStar(mingSummary.shenZhu || chart.shenZhu || '', lang),
      gender: translateGender(chart.birthInfo.gender, lang),
      yinYangGender: translateYinYangGender(yinYangGenderRaw, lang),
      mingPalaceName: mingPalace.palaceName,
      mingPalaceBranch: mingPalace.branch,
      mingPalaceStem: mingPalace.stem,
      shenPalaceName: shenPalaceBase.palaceName,
      shenPalaceBranch: shenPalaceBase.branch,
      shenPalaceStem: shenPalaceBase.stem,
      isShenSameAsMing: mingSummary.shenPalace.isSameAsMing,
      lunarYear: chart.lunarInfo.lunarYear,
      lunarMonth: chart.lunarInfo.lunarMonth,
      lunarDay: chart.lunarInfo.lunarDay,
      isLeapMonth: chart.lunarInfo.isLeapMonth,
      yearStem: translateStem(chart.lunarInfo.yearStem, lang),
      yearBranch: translateBranch(chart.lunarInfo.yearBranch, lang),
      ...(chart.birthInfo.city ? { city: chart.birthInfo.city } : {}),
    },
    mingPalace,
    shenPalace: {
      ...shenPalaceBase,
      isSameAsMing: mingSummary.shenPalace.isSameAsMing,
    },
    sanFangSiZheng: mingSummary.sanFangSiZheng.map((p) => translateSanFangPalace(p, lang)),
    favorableSiHua: mingSummary.favorableSiHua.map((h) => translateFavorableSiHuaItem(h, lang)),
    sanFangFavorableSiHua: mingSummary.sanFangFavorableSiHua.map((h) =>
      translateFavorableSiHuaItem(h, lang),
    ),
    hasSanQiJiaHui: mingSummary.hasSanQiJiaHui,
    painPoints: analysis.painPoints.map((pp) => translatePainPointItem(pp, lang)),
    patterns: patterns.map((pattern) => {
      const translated = translatePattern(pattern.name, pattern.level, pattern.description, lang);
      return {
        name: translated.name,
        originalName: pattern.name,
        level: pattern.level,
        levelLabel: pick(PATTERN_LEVEL_LABELS[pattern.level], lang),
        palaces: pattern.palaces.map((pal) => translatePalace(pal, lang)),
        description: translated.description,
        ...(pattern.source ? { source: pattern.source } : {}),
      };
    }),
  };
}
