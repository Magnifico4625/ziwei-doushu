/**
 * lib/ziwei/db-analysis.ts
 *
 * Deterministic Zero-LLM Zi Wei Dou Shu knowledge & Free Tier reading generator.
 * - Preserves SEO knowledge base types and empty STAR_DB stub (`exists = false`).
 * - Provides complete localized ('ru' | 'zh' | 'en') deterministic Free Tier
 *   Life Palace (命宫) readings across all 14 Major Stars, all 24 classical
 *   dual-star pairings (including all 9 core combinations), empty-palace
 *   borrowing (空宫借对宫主星), brightness nuances (庙旺/平/陷), and natal SiHua
 *   (生年禄/权/科/忌) modifiers.
 */

import type { Palace, SiHua, Star, StarBrightness, ZiweiChart } from './types';
import { BRANCHES } from './constants';
import {
  normalizeLang,
  translateBranch,
  translateBrightness,
  translatePalace,
  translateSiHua,
  translateStar,
  type SupportedLang,
} from './i18n';

// ────────────────── Preserved SEO Stub Exports ──────────────────

export type TopicKey =
  | 'overview'
  | 'personality'
  | 'love'
  | 'career'
  | 'wealth'
  | 'health'
  | 'family'
  | 'children'
  | 'move'
  | 'friends'
  | 'home'
  | 'spirit'
  | 'parents';

export const TOPIC_PALACE_NAME: Record<TopicKey, string> = {
  overview: '命宫',
  personality: '命宫',
  love: '夫妻',
  career: '官禄',
  wealth: '财帛',
  health: '疾厄',
  family: '兄弟',
  children: '子女',
  move: '迁移',
  friends: '仆役',
  home: '田宅',
  spirit: '福德',
  parents: '父母',
};

export const TOPIC_LABEL: Record<TopicKey, string> = {
  overview: '命格总览',
  personality: '性格特质',
  love: '感情婚姻',
  career: '事业职业',
  wealth: '财富运势',
  health: '健康状况',
  family: '兄弟合伙',
  children: '子女缘分',
  move: '迁移外出',
  friends: '人际贵人',
  home: '田宅不动产',
  spirit: '精神福德',
  parents: '父母长辈',
};

/**
 * Legacy SEO knowledge map kept intentionally empty so static knowledge detail
 * routes do not expose paid interpretation copy (`exists = false`).
 */
export const STAR_DB: Record<string, unknown> = {};

// ────────────────── Public Types ──────────────────

export type { SupportedLang };

export type LocalizedText = Record<SupportedLang, string>;
export type LocalizedList = Record<SupportedLang, readonly string[]>;

export type BrightnessBand = 'bright' | 'normal' | 'dim';

export type MajorStarName =
  | '紫微'
  | '天机'
  | '太阳'
  | '武曲'
  | '天同'
  | '廉贞'
  | '天府'
  | '太阴'
  | '贪狼'
  | '巨门'
  | '天相'
  | '天梁'
  | '七杀'
  | '破军';

export type DualStarComboKey =
  | '紫府'
  | '机月'
  | '日月'
  | '廉杀'
  | '武杀'
  | '武贪'
  | '巨日'
  | '同梁'
  | '廉相'
  | '紫贪'
  | '紫相'
  | '紫杀'
  | '紫破'
  | '机巨'
  | '机梁'
  | '阳梁'
  | '武府'
  | '武相'
  | '武破'
  | '同阴'
  | '同巨'
  | '廉府'
  | '廉贪'
  | '廉破';

export interface SingleStarLifeProfile {
  star: MajorStarName;
  archetypeTitle: LocalizedText;
  coreTemperament: LocalizedText;
  brightnessNuances: Record<BrightnessBand, LocalizedText>;
  lifeOrientation: LocalizedText;
  keywords: LocalizedList;
}

export interface DualStarLifeProfile {
  key: DualStarComboKey;
  stars: readonly [MajorStarName, MajorStarName];
  archetypeTitle: LocalizedText;
  coreTemperament: LocalizedText;
  lifeOrientation: LocalizedText;
  keywords: LocalizedList;
}

export interface FreeLifePalaceStarInfo {
  name: string;
  label: string;
  brightness?: BrightnessBand;
  brightnessRaw?: StarBrightness;
  brightnessLabel?: string;
  siHua?: SiHua;
  siHuaLabel?: string;
  borrowed: boolean;
}

export interface FreeLifePalaceReading {
  lang: SupportedLang;
  palaceName: string;
  branchName: string;
  isEmpty: boolean;
  borrowedFromPalace?: string;
  stars: FreeLifePalaceStarInfo[];
  comboKey?: DualStarComboKey;
  archetypeTitle: string;
  starSummary: string;
  paragraphs: string[];
  reading: string;
  keywords: string[];
  brightnessNote: string;
  siHuaNote?: string;
}

// ────────────────── Constants ──────────────────

export const ALL_MAJOR_STARS: readonly MajorStarName[] = [
  '紫微',
  '天机',
  '太阳',
  '武曲',
  '天同',
  '廉贞',
  '天府',
  '太阴',
  '贪狼',
  '巨门',
  '天相',
  '天梁',
  '七杀',
  '破军',
] as const;

export const KEY_DUAL_STAR_COMBOS: readonly DualStarComboKey[] = [
  '紫府',
  '机月',
  '日月',
  '廉杀',
  '武杀',
  '武贪',
  '巨日',
  '同梁',
  '廉相',
] as const;

const MAJOR_STAR_SET = new Set<string>(ALL_MAJOR_STARS);
const BRIGHT_RAW_SET = new Set<StarBrightness>(['庙', '旺']);
const DIM_RAW_SET = new Set<StarBrightness>(['陷', '不', '闲']);

// ────────────────── 14 Major Star Profiles ──────────────────

export const LIFE_PALACE_STAR_PROFILES: Record<MajorStarName, SingleStarLifeProfile> = {
  '紫微': {
    star: '紫微',
    archetypeTitle: {
      ru: 'Императорский суверенитет (Цзы Вэй)',
      zh: '帝座统御格 · 紫微守命',
      en: 'Sovereign Architect (Zi Wei)',
    },
    coreTemperament: {
      ru: 'Цзы Вэй в Дворце Жизни формирует сильное чувство собственного достоинства, стратегическое мышление и естественную тягу к самостоятельным решениям. Вам тесно в роли пассивного исполнителя: внутренний компас настроен на целостную картину, ответственность и авторитет, но без опоры на союзников велика склонность замыкаться в себе.',
      zh: '紫微坐命主尊贵自主与统御视野，气度沉稳、自尊心强，习惯站在全局高度审视问题，不甘久居被动。若得左辅、右弼或魁钺同会，格局如君臣得辅，领导力与整合力尤为突出；若偏于独行，则外显威严而内多孤高。',
      en: 'Zi Wei in the Life Palace bestows composure, high standards, and an instinct for strategic oversight. You naturally seek autonomy and big-picture responsibility rather than routine subordination, thriving when capable allies complement your leadership instead of leaving you to carry everything alone.',
    },
    brightnessNuances: {
      bright: {
        ru: 'При ярком положении (Мяо/Ван) авторитет звучит мягко, но убедительно: люди тянутся к вашему масштабу, а решения приносят устойчивое признание.',
        zh: '紫微居庙旺之位，威仪不怒而自重，决策格局开阔，更容易汇聚资源与贵人助力。',
        en: 'In bright dignity (Miao/Wang), your authority feels grounded and magnetic, drawing respect and reliable support.',
      },
      normal: {
        ru: 'При ровной яркости (Пин/Дэ/Ли) лидерство раскрывается через практический опыт и дисциплину, требуя опоры на сильную команду.',
        zh: '紫微处平得之位，重在以稳健实务树立威信，需借合作与制度放大自身号召力。',
        en: 'At moderate dignity, leadership develops steadily through practical competence and structured teamwork.',
      },
      dim: {
        ru: 'При ослабленной яркости возрастает внутренняя требовательность и уязвимость к упрямству; важно отделять подлинный статус от внешней гордости.',
        zh: '紫微若逢偏弱之位，易见外强内劳或主观偏执，宜放下独揽心态，借合作共赢稳固根基。',
        en: 'When dimmed, pride or over-responsibility can create quiet pressure; delegating and staying flexible unlocks true leverage.',
      },
    },
    lifeOrientation: {
      ru: 'Опирайтесь на системное управление, стратегию и доверенных партнеров: ваша главная зона роста — умение делегировать, сохраняя уважение к чужой инициативе.',
      zh: '适合往管理统筹、品牌主导或核心决策方向深耕；人生功课在于知人善任，既守原则又留人情回旋。',
      en: 'You excel in governance, executive strategy, and independent ventures; your key growth edge is trusting partners with execution.',
    },
    keywords: {
      ru: ['Авторитет', 'Независимость', 'Стратегия', 'Ответственность'],
      zh: ['统御', '尊贵', '自主', '全局观'],
      en: ['Leadership', 'Autonomy', 'Strategy', 'Dignity'],
    },
  },

  '天机': {
    star: '天机',
    archetypeTitle: {
      ru: 'Живой интеллект и стратег (Тянь Цзи)',
      zh: '智谋灵动格 · 天机守命',
      en: 'Agile Strategist (Tian Ji)',
    },
    coreTemperament: {
      ru: 'Тянь Цзи наделяет быстрым, гибким умом, способностью видеть скрытые связи и моментально адаптироваться к переменам. Вы склонны просчитывать несколько шагов вперед, легко учитесь новому, но при избытке вариантов можете колебаться между идеями дольше, чем нужно для старта.',
      zh: '天机坐命主聪敏灵动、善思善变，脑中构想绵密，极擅拆解复杂问题与统筹策划。因思虑过快、视角多元，行动力有时会被反复权衡牵制，需避免想得多而落子迟。',
      en: 'Tian Ji in the Life Palace grants swift cognition, pattern recognition, and adaptability under shifting conditions. You constantly connect dots and anticipate contingencies, though over-analyzing multiple options can occasionally delay decisive commitment.',
    },
    brightnessNuances: {
      bright: {
        ru: 'В сильном положении (Мяо/Ван) интуиция и аналитика работают в унисон, превращая идеи в точные стратегические ходы.',
        zh: '天机庙旺则机敏而有条理，策划判断切中要害，动静皆能踩准节奏。',
        en: 'When bright (Miao/Wang), analytical agility sharpens into clear, timely strategic judgment.',
      },
      normal: {
        ru: 'При средней яркости ум остается живым и изобретательным, но нуждается в четком плане и внешних сроках.',
        zh: '天机处平得之位，才思敏捷仍足，唯需以明确目标与节奏约束分散的心力。',
        en: 'At moderate dignity, your inventiveness stays strong and thrives when anchored by concrete milestones.',
      },
      dim: {
        ru: 'В ослабленном положении растет нервное напряжение и склонность менять курс на полпути; полезны фокусировка на одном приоритете и бережный режим сна.',
        zh: '天机若居陷弱，易因思虑过重而精力耗散、中途改辙，宜专注主线并调节作息。',
        en: 'When dimmed, mental restlessness and mid-course pivots increase; narrowing focus and protecting rest keeps your edge sharp.',
      },
    },
    lifeOrientation: {
      ru: 'Ваша сила — консалтинг, технологии, аналитика, проектирование и переговоры. Превращайте ментальную подвижность в пошаговую реализацию.',
      zh: '极宜技术研发、策略顾问、企划分析与跨界协调；切忌空转焦虑，把灵感落成可验证的节奏最为关键。',
      en: 'Consulting, technology, research, and planning suit your mind best; anchor big ideas into repeatable execution habits.',
    },
    keywords: {
      ru: ['Интеллект', 'Гибкость', 'Стратегия', 'Адаптивность'],
      zh: ['智慧', '策划', '灵动', '应变'],
      en: ['Intellect', 'Adaptability', 'Planning', 'Insight'],
    },
  },

  '太阳': {
    star: '太阳',
    archetypeTitle: {
      ru: 'Свет открытого лидерства (Тай Ян)',
      zh: '光辉坦荡格 · 太阳守命',
      en: 'Radiant Trailblazer (Tai Yang)',
    },
    coreTemperament: {
      ru: 'Тай Ян дает прямоту, великодушие, высокую энергию отдачи и стремление действовать открыто, на виду у людей. Вы берете на себя роль защитника и организатора, охотно делитесь ресурсами и идеями, однако риск выгорания возникает там, где вы тянете чужие задачи в ущерб себе.',
      zh: '太阳坐命主光明磊落、热忱外向，具有极强的社会责任感与公众表达力。处事喜明不喜暗，乐于照拂他人，但若事事亲力亲为，也容易先勤后倦、操劳过甚。',
      en: 'Tai Yang brings warmth, candor, generosity, and public vitality. You feel most alive when championing causes, rallying people, and operating transparently, though taking on everyone else’s burdens can drain your reserves if boundaries blur.',
    },
    brightnessNuances: {
      bright: {
        ru: 'Яркое Солнце (Мяо/Ван) дает мощный общественный авторитет, ясность целей и поддержку со стороны руководства или широкой аудитории.',
        zh: '太阳庙旺犹如日中天，声望与贵气俱隆，付出容易转化为可见的认可与地位。',
        en: 'A bright Tai Yang (Miao/Wang) radiates natural prestige, clear vision, and strong public or institutional backing.',
      },
      normal: {
        ru: 'При умеренной яркости успех приходит через последовательный труд и личную репутацию, без лишней суеты.',
        zh: '太阳处平得之位，光辉虽不张扬却持久稳健，踏实耕耘即可累积口碑。',
        en: 'At moderate dignity, steady credibility and consistent service build lasting influence over time.',
      },
      dim: {
        ru: 'При ослабленном Солнце много сил уходит на отдачу без быстрой отдачи; важно дозировать нагрузку, избегать суеты и беречь зрение и сердце.',
        zh: '太阳若逢陷弱，容易辛勤付出却回报偏慢，宜学会收放心力，顾好精力与健康节奏。',
        en: 'When dimmed, effort can feel thankless at first; pacing your generosity and protecting physical stamina makes all the difference.',
      },
    },
    lifeOrientation: {
      ru: 'Раскрывайтесь в публичных ролях, управлении, образовании, медиа и международных проектах, оставляя пространство для личного восстановления.',
      zh: '适合公职管理、教育传播、市场公关或对外开拓型事业；懂得适度留白，方能长久发光。',
      en: 'Public leadership, education, communications, and external growth fit well—just guard against over-extending yourself.',
    },
    keywords: {
      ru: ['Открытость', 'Щедрость', 'Признание', 'Инициатива'],
      zh: ['光明', '担当', '声望', '热忱'],
      en: ['Candor', 'Visibility', 'Generosity', 'Drive'],
    },
  },

  '武曲': {
    star: '武曲',
    archetypeTitle: {
      ru: 'Мастер дела и финансов (У Цюй)',
      zh: '刚毅聚财格 · 武曲守命',
      en: 'Resolute Builder (Wu Qu)',
    },
    coreTemperament: {
      ru: 'У Цюй — звезда воли, конкретики и материального результата. Вы цените точность, слово дела и самостоятельность, умеете доводить начатое до ощутимой прибыли или измеримого итога, хотя в близком общении прямолинейность порой звучит жестче, чем вы хотели.',
      zh: '武曲坐命主刚毅果决、务实重诺，行动力极强，对数字、资产与落地效率天生敏感。遇事习惯正面攻坚、不尚空谈，但在人际相处上若过于直率，容易显得孤硬。',
      en: 'Wu Qu embodies grit, financial acumen, and disciplined execution. You respect measurable results, keep your word, and push projects across the finish line, though blunt directness can occasionally feel unforgiving in sensitive relationships.',
    },
    brightnessNuances: {
      bright: {
        ru: 'В ярком достоинстве (Мяо/Ван) решительность сочетается с финансовым чутьем, открывая путь к крупным проектам и прочной материальной базе.',
        zh: '武曲庙旺则财气与魄力并举，越在关键时刻越能稳住局面、化挑战为实利。',
        en: 'In bright dignity (Miao/Wang), financial instincts and executive courage reinforce each other powerfully.',
      },
      normal: {
        ru: 'При спокойной яркости благосостояние строится методично — через ремесло, стандарты качества и терпеливое накопление.',
        zh: '武曲处平得之位，胜在稳扎稳打与专业精进，财源随实力逐年沉淀。',
        en: 'At moderate dignity, wealth and authority accrue steadily through disciplined craft and financial consistency.',
      },
      dim: {
        ru: 'При ослабленной яркости повышается риск перегрузки и излишней жесткости к себе и другим; мягкость в диалоге снижает лишнее трение.',
        zh: '武曲若居偏弱，易因求成心切而徒增波折，处事多一分圆融反而更利聚财。',
        en: 'When dimmed, impatience or rigidity can add friction; pairing your resolve with diplomatic tact smooths progress.',
      },
    },
    lifeOrientation: {
      ru: 'Ваши сферы — финансы, реальный сектор, инженерия, управление операциями и собственный бизнес. Учитесь сочетать твердость решений с теплотой в контакте.',
      zh: '适合金融财经、实业运营、工程管理或专业技能立身；刚中带柔，往往能让事业与关系走得更远。',
      en: 'Finance, operations, engineering, and entrepreneurship suit your drive; balancing rigor with warmth deepens loyalty.',
    },
    keywords: {
      ru: ['Воля', 'Финансы', 'Результат', 'Дисциплина'],
      zh: ['果决', '实干', '理财', '原则'],
      en: ['Resolve', 'Finance', 'Execution', 'Discipline'],
    },
  },

  '天同': {
    star: '天同',
    archetypeTitle: {
      ru: 'Гармония и дар притяжения благ (Тянь Тун)',
      zh: '温润享福格 · 天同守命',
      en: 'Harmonious Harmonizer (Tian Tong)',
    },
    coreTemperament: {
      ru: 'Тянь Тун приносит мягкость характера, эмоциональную чуткость и умение создавать вокруг себя атмосферу доверия. Вы не любите бессмысленных конфликтов, умеете радоваться жизни и располагать людей, но без внешней мотивации можете откладывать трудные шаги.',
      zh: '天同坐命主性情温和、人缘顺畅，懂得体察他人情绪并营造舒适氛围。本身自带福泽与调和之力，较少锋芒毕露，但有时也容易安于现状、欠缺破局锐气。',
      en: 'Tian Tong grants warmth, emotional tact, and an approachable presence that puts others at ease. You naturally defuse tension and value quality of life, though comfort can turn into procrastination unless clear challenges keep you engaged.',
    },
    brightnessNuances: {
      bright: {
        ru: 'При высокой яркости (Мяо/Ван) мягкость не превращается в слабость: удача поддерживает вовремя, а люди охотно помогают вашим начинаниям.',
        zh: '天同庙旺则温润而有底气，人际助力充沛，往往在从容节奏中顺势成事。',
        en: 'In bright dignity (Miao/Wang), ease is backed by solid resilience and timely support from well-disposed allies.',
      },
      normal: {
        ru: 'В ровном положении вы сохраняете баланс между комфортом и делом, если опираетесь на понятный рабочий ритм.',
        zh: '天同处平得之位，心态平和稳重，配合适度历练更能把好人缘化为实际成果。',
        en: 'At moderate dignity, steady routines help translate your social grace into dependable achievement.',
      },
      dim: {
        ru: 'При ослабленной яркости могут появляться внутренние сомнения или усталость от давления; конструктивные вызовы помогают быстрее набрать тонус.',
        zh: '天同若逢陷弱，早年较易感性犹豫或畏难退缩，经由历练突破舒适区后反见清福。',
        en: 'When dimmed, sensitivity to pressure can sap momentum; stepping into structured challenges builds lasting confidence.',
      },
    },
    lifeOrientation: {
      ru: 'Вам подходят сервис, культура, дизайн, психология, клиентский бизнес и партнерские команды, где ценят эмпатию и устойчивые связи.',
      zh: '适合文化创意、服务体验、教育咨询与品牌运营；适度借重外部目标感，便能兼顾快乐与成就。',
      en: 'Culture, design, hospitality, counseling, and collaborative leadership fit naturally when paired with purposeful structure.',
    },
    keywords: {
      ru: ['Гармония', 'Эмпатия', 'Дипломатия', 'Комфорт'],
      zh: ['温和', '福泽', '亲和', '随缘'],
      en: ['Harmony', 'Empathy', 'Ease', 'Goodwill'],
    },
  },

  '廉贞': {
    star: '廉贞',
    archetypeTitle: {
      ru: 'Харизма, страсть и внутренний кодекс (Лянь Чжэнь)',
      zh: '才情律令格 · 廉贞守命',
      en: 'Magnetic Strategist (Lian Zhen)',
    },
    coreTemperament: {
      ru: 'Лянь Чжэнь соединяет яркую харизму, художественное чутье и обостренное чувство границ и правил. Вы способны очаровывать, вести за собой и тонко чувствовать скрытые мотивы, но сильные эмоции требуют зрелого русла — иначе внутреннее напряжение толкает в крайности.',
      zh: '廉贞坐命兼备才艺魅力与秩序意识，既懂得公关交际、拿捏分寸，又有极强的底线感与好胜心。内心情感与野心同样炽烈，守正修心则成大器，失衡则易陷情绪内耗。',
      en: 'Lian Zhen blends magnetic poise with a keen sense of boundaries, taste, and ambition. You read people quickly and command attention effortlessly, though your intense emotional drive flourishes best when anchored by ethical clarity and discipline.',
    },
    brightnessNuances: {
      bright: {
        ru: 'При яркости (Мяо/Ван) харизма работает на статус и творческую самореализацию, позволяя управлять сложными процессами с артистизмом.',
        zh: '廉贞庙旺则才华与魄力相得益彰，社交气场出众，擅于在复杂规则中游刃有余。',
        en: 'In bright dignity (Miao/Wang), charisma and precision reinforce each other across creative and institutional arenas.',
      },
      normal: {
        ru: 'В среднем положении важно поддерживать баланс между творческой свободой и юридической, финансовой или бытовой аккуратностью.',
        zh: '廉贞处平得之位，多才多艺且重效率，只要把控好原则边界便能稳步向上。',
        en: 'At moderate dignity, your versatility shines brightest when paired with clean agreements and clear personal standards.',
      },
      dim: {
        ru: 'При ослабленной яркости обостряются ревность к деталям, усталость от конфликтов и склонность к резким решениям; пауза перед ответом бережет репутацию.',
        zh: '廉贞若居陷弱，情绪起伏与是非敏感度升高，重大决策宜慢半拍，重合规轻意气。',
        en: 'When dimmed, emotional intensity or perfectionism can trigger avoidable friction; pausing before reacting protects your path.',
      },
    },
    lifeOrientation: {
      ru: 'Сильные направления — искусство, право, бренд-коммуникации, продюсирование, кризис-менеджмент и стратегические переговоры.',
      zh: '适合法务合规、艺术设计、品牌公关、精密运营与谈判统筹；以定力驾驭热情，潜能极深。',
      en: 'Design, law, brand strategy, diplomacy, and high-stakes operations thrive under your intense focus and polish.',
    },
    keywords: {
      ru: ['Харизма', 'Границы', 'Творчество', 'Интенсивность'],
      zh: ['才情', '风采', '秩序', '张力'],
      en: ['Charisma', 'Boundaries', 'Artistry', 'Intensity'],
    },
  },

  '天府': {
    star: '天府',
    archetypeTitle: {
      ru: 'Хранитель ресурсов и устойчивости (Тянь Фу)',
      zh: '厚重守成格 · 天府守命',
      en: 'Steadfast Steward (Tian Fu)',
    },
    coreTemperament: {
      ru: 'Тянь Фу — звезда стабильности, накопления и зрелого хозяйственного расчета. Вы не бросаетесь в сомнительные авантюры, предпочитаете проверять фундамент, умеете сохранять капитал и поддерживать порядок, хотя иногда излишняя осторожность замедляет смелые повороты.',
      zh: '天府坐命主稳重宽厚、擅于统筹守财，处事讲求章法与安全边际，不易被短期波动动摇。天生具备管理资源与稳住军心的能力，唯有时略显保守，错过快速变局中的先机。',
      en: 'Tian Fu governs stability, resource stewardship, and calm judgment. You naturally protect assets, evaluate downside risk before moving, and keep teams steady under pressure, though excessive caution can sometimes delay bold reinvention.',
    },
    brightnessNuances: {
      bright: {
        ru: 'В сильном положении (Мяо/Ван) ваша надежность притягивает крупные бюджеты, недвижимость и долгосрочное доверие партнеров.',
        zh: '天府庙旺则财库丰盈、气度雍容，一生抗风险能力强，极易积累实质资产。',
        en: 'In bright dignity (Miao/Wang), asset preservation and serene authority create durable long-term security.',
      },
      normal: {
        ru: 'При ровной яркости вы шаг за шагом укрепляете позиции через качество, порядок и продуманные инвестиции.',
        zh: '天府处平得之位，胜在务实有恒，只要持续优化结构即可厚积薄发。',
        en: 'At moderate dignity, consistent systems and patient capital building keep you steadily ahead.',
      },
      dim: {
        ru: 'При ослабленной яркости осторожность может перерастать в тревогу за потери; учитесь отличать разумный резерв от застоя.',
        zh: '天府若遇偏弱，容易因顾虑过多而显局促，适度打开视野与合作能盘活现有资源。',
        en: 'When dimmed, caution can tip into hesitation; strategic partnerships help unlock stagnant potential.',
      },
    },
    lifeOrientation: {
      ru: 'Оптимальны финансы, управление активами, недвижимость, операционный менеджмент и семейное дело с долгосрочным горизонтом.',
      zh: '适合资产管理、企业行政、不动产规划及中长线稳健经营；守正的同时保留一点试错空间更佳。',
      en: 'Asset management, real estate, operations, and long-horizon leadership reward your steady hand.',
    },
    keywords: {
      ru: ['Надежность', 'Капитал', 'Стабильность', 'Расчет'],
      zh: ['稳重', '财库', '守成', '包容'],
      en: ['Stability', 'Stewardship', 'Prudence', 'Reserves'],
    },
  },

  '太阴': {
    star: '太阴',
    archetypeTitle: {
      ru: 'Глубина интуиции и тихая сила (Тай Инь)',
      zh: '清雅内敛格 · 太阴守命',
      en: 'Reflective Accumulator (Tai Yin)',
    },
    coreTemperament: {
      ru: 'Тай Инь дарит тонкую восприимчивость, эстетический вкус и способность накапливать результаты без лишнего шума. Вы лучше работаете в спокойной, продуманной обстановке, глубоко чувствуете нюансы отношений и финансов, но чрезмерная ранимость порой мешает говорить о своих интересах вслух.',
      zh: '太阴坐命主温婉细腻、重情重美，思考偏于内敛深沉，具备极佳的蓄水聚财与耐心打磨之力。处事讲究分寸与质感，不喜正面硬碰，但情绪敏感时容易把委屈藏在心里。',
      en: 'Tai Yin brings refined intuition, aesthetic sensitivity, and quiet wealth-building patience. You notice subtle emotional and financial undercurrents that louder personalities miss, though keeping frustrations unspoken can create quiet inner strain.',
    },
    brightnessNuances: {
      bright: {
        ru: 'При яркой Луне (Мяо/Ван) интуиция точна, вкус безупречен, а материальный достаток и внутреннее спокойствие растут естественно.',
        zh: '太阴庙旺如皓月当空，气质清雅、财禄厚实，家庭与内心世界皆易得滋养。',
        en: 'In bright dignity (Miao/Wang), intuition runs clear and financial, creative, and domestic comfort grow gracefully.',
      },
      normal: {
        ru: 'При средней яркости мягкость и методичность дают устойчивый прогресс в тихой, системной работе.',
        zh: '太阴处平得之位，循序渐进则根基扎实，擅在幕后把细节做到极致。',
        en: 'At moderate dignity, patient refinement and behind-the-scenes precision yield dependable progress.',
      },
      dim: {
        ru: 'При ослабленной Луне усиливаются тревожность и зависимость от настроения; ясные договоренности и опора на факты возвращают внутренний покой.',
        zh: '太阴若落陷弱，情绪波动与多愁善感较明显，宜通过运动与明确边界稳定心神。',
        en: 'When dimmed, mood fluctuations or self-doubt can cloud judgment; grounding routines and clear boundaries restore clarity.',
      },
    },
    lifeOrientation: {
      ru: 'Реализуйтесь в финансах, недвижимости, искусстве, психологии, аналитике и проектах, где важны вкус, деликатность и долгий цикл накопления.',
      zh: '适合财务规划、美学设计、心理咨询、房地产及精细化研发；学会温和坚定地表达诉求，福气更稳。',
      en: 'Finance, design, counseling, real estate, and thoughtful research flourish under your patient, observant eye.',
    },
    keywords: {
      ru: ['Интуиция', 'Эстетика', 'Накопление', 'Деликатность'],
      zh: ['细腻', '蓄财', '温雅', '直觉'],
      en: ['Intuition', 'Refinement', 'Patience', 'Wealth'],
    },
  },

  '贪狼': {
    star: '贪狼',
    archetypeTitle: {
      ru: 'Магнетизм, таланты и жажда опыта (Тань Лан)',
      zh: '多才交际格 · 贪狼守命',
      en: 'Versatile Catalyst (Tan Lang)',
    },
    coreTemperament: {
      ru: 'Тань Лан наделяет широким кругозором, ярким обаянием и ненасытным интересом к возможностям жизни. Вы быстро схватываете тренды, легко заводите связи и умеете превращать увлечения в доход, хотя распыление на десятки желаний сразу тормозит главный прорыв до зрелости фокуса.',
      zh: '贪狼坐命主多才多艺、社交敏锐、欲望与好奇心并旺，极擅把握趋势、氛围与人脉资源。天性热爱鲜活体验，往往在中年专注主航道后爆发力倍增；早年则须防贪多嚼不烂。',
      en: 'Tan Lang confers versatility, social magnetism, and an appetite for growth and mastery. You spot trends quickly and turn connections into opportunities, though chasing too many interests at once can dilute your breakthroughs until you lock onto a core focus.',
    },
    brightnessNuances: {
      bright: {
        ru: 'В ярком положении (Мяо/Ван) амбиции и харизма приносят масштабные связи, яркую карьеру и умение монетизировать таланты.',
        zh: '贪狼庙旺则魅力与格局兼备，善用人脉杠杆撬动机会，中年之后成就尤显。',
        en: 'In bright dignity (Miao/Wang), charm and ambition compound through high-value networks and bold career pivots.',
      },
      normal: {
        ru: 'При средней яркости важно выбирать два-три ключевых навыка и доводить их до мастерства, не отвлекаясь на сиюминутные соблазны.',
        zh: '贪狼处平得之位，多面手特质明显，锁定核心专长持续深耕便可脱颖而出。',
        en: 'At moderate dignity, channeling broad curiosity into two or three signature strengths unlocks lasting success.',
      },
      dim: {
        ru: 'При ослабленной яркости возрастает риск поспешных увлечений и непоследовательности; дисциплина в финансах и отношениях защищает ваш потенциал.',
        zh: '贪狼若逢偏弱，易因贪快或分心而耗损精力，收敛欲望、守住长期主义最为关键。',
        en: 'When dimmed, restlessness or scattered commitments can drain energy; disciplined routines keep your gifts productive.',
      },
    },
    lifeOrientation: {
      ru: 'Ваши области — маркетинг, продажи, медиа, развлечения, консалтинг, международный бизнес и сложные переговорные проекты.',
      zh: '适合市场营销、商务拓展、娱乐传媒、公关咨询及跨界整合；越早把欲望化作长期技艺，后劲越足。',
      en: 'Marketing, business development, media, hospitality, and cross-disciplinary ventures amplify your natural magnetism.',
    },
    keywords: {
      ru: ['Многогранность', 'Связи', 'Амбиции', 'Магнетизм'],
      zh: ['多才', '人脉', '进取', '魅力'],
      en: ['Versatility', 'Networking', 'Drive', 'Magnetism'],
    },
  },

  '巨门': {
    star: '巨门',
    archetypeTitle: {
      ru: 'Сила слова и глубокого анализа (Цзюй Мэнь)',
      zh: '思辨口才格 · 巨门守命',
      en: 'Penetrating Analyst (Ju Men)',
    },
    coreTemperament: {
      ru: 'Цзюй Мэнь — звезда исследования, аргументации и поиска скрытой правды за словами. Вы не принимаете ничего на веру, замечаете малейшие нестыковки и убедительно доносите позицию, но склонность к сомнениям и резкой критике требует осознанного контроля в диалоге.',
      zh: '巨门坐命主心思缜密、善辩能言，对细节与真相有本能的追问力，适合凭专业口才与深度研究立身。因防备心较重、眼光犀利，若言语少一分缓和，容易无意间招致口舌误解。',
      en: 'Ju Men brings probing intellect, verbal precision, and a skeptic’s eye for what lies beneath the surface. You dissect complex claims effortlessly and persuade through rigorous logic, though hyper-criticism or guardedness can spark misunderstandings if left unchecked.',
    },
    brightnessNuances: {
      bright: {
        ru: 'При сильной яркости (Мяо/Ван) дар слова приносит авторитет, экспертное признание и способность превращать острые темы в влияние.',
        zh: '巨门庙旺则口才化为权威，言辞切中肯綮，极利讲学、律师、顾问与传媒立业。',
        en: 'In bright dignity (Miao/Wang), incisive speech commands respect in advocacy, teaching, media, and advisory work.',
      },
      normal: {
        ru: 'В спокойном положении аналитика служит надежным инструментом, если проверять гипотезы фактами, а не подозрениями.',
        zh: '巨门处平得之位，研究功底扎实，重实证、少猜忌即可减少不必要的人际摩擦。',
        en: 'At moderate dignity, evidence-based rigor keeps your analytical depth sharp without unnecessary skepticism.',
      },
      dim: {
        ru: 'При ослабленной яркости слова могут ранить острее задуманного, а тревожные мысли — затягивать; тренируйте бережную формулировку и доверие.',
        zh: '巨门若逢陷弱，内心多疑且易生是非风波，管住情绪化表达与先入为主尤为重要。',
        en: 'When dimmed, defensive communication or overthinking can create friction; deliberate clarity and patience protect key bonds.',
      },
    },
    lifeOrientation: {
      ru: 'Подходят юриспруденция, преподавание, журналистика, аудит, переговоры, психоанализ и экспертный консалтинг.',
      zh: '适合法律仲裁、教育培训、研究审计、传媒评论与深度咨询；修口德、聚实学，终成一方权威。',
      en: 'Law, teaching, investigative research, auditing, and expert advisory reward your razor-sharp mind.',
    },
    keywords: {
      ru: ['Речь', 'Анализ', 'Истина', 'Проницательность'],
      zh: ['思辨', '口才', '深究', '敏锐'],
      en: ['Eloquence', 'Analysis', 'Discernment', 'Depth'],
    },
  },

  '天相': {
    star: '天相',
    archetypeTitle: {
      ru: 'Дипломатический баланс и печать доверия (Тянь Сян)',
      zh: '印绶佐才格 · 天相守命',
      en: 'Trusted Diplomat (Tian Xiang)',
    },
    coreTemperament: {
      ru: 'Тянь Сян олицетворяет достоинство, чувство справедливости и искусство сглаживать противоречия. Вы цените эстетику, порядочность и надежные договоренности, часто выступая связующим звеном между людьми и системами, хотя порой слишком зависите от оценки и гармонии окружения.',
      zh: '天相坐命主忠厚守信、仪态得体，擅长协调折中与制度执行，犹如持印之臣。对公平、形象与分寸感格外讲究，但受环境影响较深，遇强势压力时容易在迎合与原则间左右为难。',
      en: 'Tian Xiang represents integrity, poise, and principled mediation. Like the keeper of the official seal, you value fairness, presentation, and dependable agreements, often serving as the bridge that keeps partnerships cohesive—though reading the room too closely can make boundaries harder to assert.',
    },
    brightnessNuances: {
      bright: {
        ru: 'При ярком положении (Мяо/Ван) ваша репутация безупречна, а умение соединять интересы открывает высокие руководящие или советнические роли.',
        zh: '天相庙旺则气度端庄、处事公正，极易赢得高层信任与长期稳定的合作资源。',
        en: 'In bright dignity (Miao/Wang), impeccable credibility earns senior trust and stabilizing leadership roles.',
      },
      normal: {
        ru: 'При средней яркости главная опора — последовательность, верность слову и внимательный выбор окружения.',
        zh: '天相处平得之位，稳健重诺，择良木而栖、与正派伙伴同行便能行稳致远。',
        en: 'At moderate dignity, reliable follow-through and choosing principled partners keep your trajectory strong.',
      },
      dim: {
        ru: 'При ослабленной яркости усиливается уступчивость или зависимость от чужих колебаний; учитесь спокойно говорить «нет», защищая свои рамки.',
        zh: '天相若居偏弱，易受周围环境牵动或过于妥协，守住自身核心底线尤为重要。',
        en: 'When dimmed, over-accommodating others can drain your autonomy; clear personal boundaries restore poise.',
      },
    },
    lifeOrientation: {
      ru: 'Ваши сферы — администрирование, право, HR, управление проектами, партнерский сервис, мода и дипломатия.',
      zh: '适合行政统筹、法务合约、项目管理、品牌礼仪与核心辅佐岗位；择善而从，大有可为。',
      en: 'Administration, governance, contract law, partnerships, and curated brand roles match your diplomatic grace.',
    },
    keywords: {
      ru: ['Дипломатия', 'Порядочность', 'Баланс', 'Репутация'],
      zh: ['辅佐', '信誉', '协调', '端正'],
      en: ['Diplomacy', 'Integrity', 'Balance', 'Credibility'],
    },
  },

  '天梁': {
    star: '天梁',
    archetypeTitle: {
      ru: 'Мудрый покровитель и опора (Тянь Лян)',
      zh: '清高荫庇格 · 天梁守命',
      en: 'Protective Mentor (Tian Liang)',
    },
    coreTemperament: {
      ru: 'Тянь Лян несет дух наставничества, морального стержня и удивительной способности проходить через кризисы с защитой. Вы рано взрослеете во взглядах, любите добираться до сути правил и помогать людям, но склонность поучать или держаться отстраненно порой создает дистанцию.',
      zh: '天梁坐命主老成持重、慈悲正直，具有逢凶化吉与护持他人的天性。看重原则、经验与长远道理，常在关键时刻充当定海神针，唯有时略显清高说教，令人觉得不易亲近。',
      en: 'Tian Liang confers moral gravity, mentoring wisdom, and a remarkable knack for navigating storms intact. You naturally take the long view and step up to protect or guide others, though sounding overly principled or detached can occasionally create distance.',
    },
    brightnessNuances: {
      bright: {
        ru: 'В сильном положении (Мяо/Ван) авторитет опирается на зрелую мудрость: кризисы оборачиваются ростом, а ваша поддержка высоко ценится.',
        zh: '天梁庙旺则清贵而有福荫，遇险常能化险为夷，极易在专业或公益领域树立声望。',
        en: 'In bright dignity (Miao/Wang), steady wisdom turns turbulence into resilience and respected mentorship.',
      },
      normal: {
        ru: 'При ровной яркости вы надежный эксперт и советчик; важно слушать собеседника прежде, чем предлагать готовый рецепт.',
        zh: '天梁处平得之位，经验沉淀带来稳健判断，多倾听少说教能让人际更融洽。',
        en: 'At moderate dignity, practical experience anchors sound counsel—especially when paired with empathetic listening.',
      },
      dim: {
        ru: 'При ослабленной яркости возможны излишняя самокритика, одиночество или уход в бесконечное спасение чужих проблем; берегите собственные границы.',
        zh: '天梁若逢陷弱，易因独挑重担或过度挑剔而心累，学会适度放下他人课题反得轻松。',
        en: 'When dimmed, carrying others’ crises alone can cause fatigue; letting people own their lessons frees your energy.',
      },
    },
    lifeOrientation: {
      ru: 'Ваше призвание — медицина, юриспруденция, преподавание, аудит, наставничество, риск-менеджмент и социальные проекты.',
      zh: '适合医药健康、法律监察、教育研究、风控顾问与文化传承；清而不孤，则福泽深厚。',
      en: 'Medicine, law, compliance, education, and advisory leadership fit your protective, principled nature.',
    },
    keywords: {
      ru: ['Мудрость', 'Защита', 'Принципы', 'Наставничество'],
      zh: ['荫庇', '稳重', '正义', '历练'],
      en: ['Wisdom', 'Protection', 'Principles', 'Mentorship'],
    },
  },

  '七杀': {
    star: '七杀',
    archetypeTitle: {
      ru: 'Характер первопроходца и стратега поля боя (Ци Ша)',
      zh: '将帅孤勇格 · 七杀守命',
      en: 'Fearless Vanguard (Qi Sha)',
    },
    coreTemperament: {
      ru: 'Ци Ша — звезда решимости, выносливости и готовности идти туда, где нет проторенных дорог. Вы презираете фальшь и полумеры, быстро мобилизуетесь в кризисе и опираетесь на собственные силы, хотя высокая требовательность и одинокая независимость делают путь напряженным.',
      zh: '七杀坐命主刚毅果决、敢闯敢拼，具大将之风与极强的抗压耐力。凡事喜直击核心、靠自己打江山，不喜拖泥带水，但性情偏急孤傲时，也容易与周遭步调产生硬碰。',
      en: 'Qi Sha embodies warrior resolve, self-reliance, and crisp decisiveness under pressure. You disdain half-measures, thrive in pioneering or turnaround territory, and forge your own path—though uncompromising intensity can feel solitary if softened rarely.',
    },
    brightnessNuances: {
      bright: {
        ru: 'При яркости (Мяо/Ван) суровость превращается в блестящую исполнительскую мощь: трудные задачи приносят прорыв и уважение.',
        zh: '七杀庙旺则肃杀化为权威，越遇艰难局面越能打出漂亮战绩、奠定格局。',
        en: 'In bright dignity (Miao/Wang), raw courage translates into commanding achievement in demanding arenas.',
      },
      normal: {
        ru: 'В умеренном положении успех требует дисциплины, выдержки и союзников, прикрывающих тыл.',
        zh: '七杀处平得之位，胜在执行力与韧性，若配稳健团队协防则事半功倍。',
        en: 'At moderate dignity, pairing grit with steady operational allies multiplies your momentum.',
      },
      dim: {
        ru: 'При ослабленной яркости поспешность и резкость повышают цену ошибок; стратегия, пауза и проверка рисков обязательны перед рывком.',
        zh: '七杀若居偏弱，易因急进硬闯而徒增损耗，先定章法再出击可大幅降低折损。',
        en: 'When dimmed, impulsiveness can raise stakes unnecessarily; deliberate pacing and risk checks safeguard every leap.',
      },
    },
    lifeOrientation: {
      ru: 'Подходят предпринимательство с нуля, антикризисное управление, спорт, силовые структуры, хирургия и конкурентные рынки.',
      zh: '适合独立创业、开疆拓土、危机攻坚、军警体育或高强度专业赛道；刚柔并济方能长胜。',
      en: 'Entrepreneurship, turnaround leadership, competitive strategy, and high-stakes execution unleash your edge.',
    },
    keywords: {
      ru: ['Решительность', 'Прорыв', 'Стойкость', 'Независимость'],
      zh: ['果决', '孤勇', '开拓', '抗压'],
      en: ['Courage', 'Breakthrough', 'Grit', 'Independence'],
    },
  },

  '破军': {
    star: '破军',
    archetypeTitle: {
      ru: 'Реформатор и первооткрыватель перемен (По Цзюнь)',
      zh: '破旧立新格 · 破军守命',
      en: 'Bold Transformer (Po Jun)',
    },
    coreTemperament: {
      ru: 'По Цзюнь несет импульс обновления: вы не терпите застоя, интуитивно сносите устаревшие рамки и строите с чистого листа. Жизнь редко идет по прямой линии — каждый крупный скачок требует смелой перестройки, но умение доводить начатое после рывка решает итоговый масштаб.',
      zh: '破军坐命主革新突破、不破不立，行动力大开大合，最不耐陈规与停滞。一生常在重塑与转折中跃升，但若只重开头破坏而忽略后续收口，也容易精力消耗过大。',
      en: 'Po Jun drives radical renewal, dismantling stagnant structures to pioneer what comes next. Your trajectory rarely stays static—bold reinventions define your milestones, and your biggest multiplier is finishing and stabilizing what your courage starts.',
    },
    brightnessNuances: {
      bright: {
        ru: 'При сильном положении (Мяо/Ван) энергия реформ приносит масштабное созидание, лидерство в переменах и впечатляющие результаты.',
        zh: '破军庙旺则破而后立之力极强，能把大刀阔斧的改革转化为扎实事业版图。',
        en: 'In bright dignity (Miao/Wang), disruptive drive builds substantial, enduring new territory.',
      },
      normal: {
        ru: 'При средней яркости перемены работают на пользу, если вы заранее оставляете запас ресурсов перед очередным обновлением.',
        zh: '破军处平得之位，宜有计划地迭代升级，先留安全垫再大步向前。',
        en: 'At moderate dignity, planned iteration with solid buffers turns bold shifts into lasting gains.',
      },
      dim: {
        ru: 'При ослабленной яркости растет склонность ломать раньше, чем готов новый план; разделяйте творческий риск и базовую финансовую подушку.',
        zh: '破军若逢陷弱，易因冲动推翻既有积累而波动加剧，稳住底盘、分步革新为上策。',
        en: 'When dimmed, tearing down before the next foundation is ready can create churn; ring-fence core stability before pivoting.',
      },
    },
    lifeOrientation: {
      ru: 'Идеальны инновации, стартапы, реинжиниринг процессов, архитектура, дизайн и проекты трансформации.',
      zh: '适合创新创业、业务重组、技术迭代、建筑设计及从零到一的开拓任务；善始更需善终。',
      en: 'Innovation, startups, transformation leadership, and zero-to-one creation match your pioneering spirit.',
    },
    keywords: {
      ru: ['Новаторство', 'Трансформация', 'Смелость', 'Масштаб'],
      zh: ['革新', '突破', '开创', '重塑'],
      en: ['Innovation', 'Reinvention', 'Boldness', 'Pioneer'],
    },
  },
};

// ────────────────── 24 Classical Dual-Star Profiles ──────────────────

export const LIFE_PALACE_DUAL_PROFILES: Record<DualStarComboKey, DualStarLifeProfile> = {
  // ── 9 Core Highlighted Dual-Star Combinations ──
  '紫府': {
    key: '紫府',
    stars: ['紫微', '天府'],
    archetypeTitle: {
      ru: 'Император и Казначей (Цзы Вэй · Тянь Фу)',
      zh: '帝座财库 · 紫府同宫格',
      en: 'Sovereign & Steward (Zi Wei · Tian Fu)',
    },
    coreTemperament: {
      ru: 'Союз Цзы Вэй и Тянь Фу в Дворце Жизни соединяет стратегическое достоинство правителя с прагматичной устойчивостью хранителя казны. Вы одновременно видите высокий горизонт и умеете удерживать материальную базу, не размениваясь на мелкую суету; главное — не позволять консерватизму перевесить смелость.',
      zh: '紫微与天府同守命宫，集帝星之统御格局与财库之稳健守成于一身。处事有章法、重信誉、抗压度高，既具高层视野又能守住资源底盘，唯需警惕因追求万全而显得略偏保守或孤傲。',
      en: 'Zi Wei and Tian Fu together unite executive vision with seasoned asset stewardship. You naturally balance ambition with prudence, building credibility and solid reserves—just watch that caution does not turn into quiet rigidity.',
    },
    lifeOrientation: {
      ru: 'Эта конфигурация раскрывается в крупном управлении, финансах, институциональных проектах и собственном бизнесе, особенно при опоре на сильных помощников.',
      zh: '适合大型平台管理、资产配置、实业掌舵与核心决策；广结良佐、善用团队，格局尤为宏阔。',
      en: 'Executive leadership, finance, institutional strategy, and asset-backed ventures reward your rare blend of stature and steadiness.',
    },
    keywords: {
      ru: ['Статус', 'Казна', 'Устойчивость', 'Управление'],
      zh: ['帝相并临', '稳健', '财库', '统御'],
      en: ['Authority', 'Stewardship', 'Stability', 'Scale'],
    },
  },

  '机月': {
    key: '机月',
    stars: ['天机', '太阴'],
    archetypeTitle: {
      ru: 'Мудрость и Лунная чуткость (Тянь Цзи · Тай Инь)',
      zh: '智月相映 · 机月同宫格',
      en: 'Intuitive Strategist (Tian Ji · Tai Yin)',
    },
    coreTemperament: {
      ru: 'Сочетание Тянь Цзи и Тай Инь рождает тонкий, многослойный интеллект, где логическая изобретательность опирается на глубокую интуицию и вкус. Вы прекрасно улавливаете скрытые настроения и тренды, предпочитаете мягкую силу и точную стратегию лобовому давлению.',
      zh: '天机与太阴同宫，智谋灵动遇上清雅细腻，构成了极为敏锐的洞察与策划力。不喜粗暴硬碰，擅于以柔克刚、在安静思考中看清局势脉络，但若思虑过度也易内心摇摆。',
      en: 'Tian Ji and Tai Yin fuse analytical agility with subtle emotional and aesthetic intuition. You read hidden currents effortlessly and prefer graceful, thoughtful strategy over brute force, though over-deliberation can slow big leaps.',
    },
    lifeOrientation: {
      ru: 'Высокие результаты приносят консалтинг, дизайн, аналитика, психология, финансы и проекты, где ценятся тонкое планирование и бережная коммуникация.',
      zh: '适合策略研究、金融企划、美学设计、教育顾问与精细化管理；坚定执行节奏便能把才思落成实绩。',
      en: 'Advisory strategy, finance, design, research, and psychology let your perceptive mind shine without unnecessary friction.',
    },
    keywords: {
      ru: ['Тонкий ум', 'Интуиция', 'Дипломатия', 'Планирование'],
      zh: ['机敏', '细腻', '策划', '温润'],
      en: ['Perceptive', 'Intuitive', 'Refined', 'Strategic'],
    },
  },

  '日月': {
    key: '日月',
    stars: ['太阳', '太阴'],
    archetypeTitle: {
      ru: 'Союз Солнца и Луны (Тай Ян · Тай Инь)',
      zh: '阴阳交辉 · 日月同宫格',
      en: 'Solar-Lunar Polarity (Tai Yang · Tai Yin)',
    },
    coreTemperament: {
      ru: 'Тай Ян и Тай Инь в одном дворце (в осях Чоу или Вэй) создают внутри личности постоянный диалог внешнего энтузиазма и глубокой рефлексии. Одна ваша сторона стремится к масштабу, признанию и открытому действию, другая — к тишине, деликатности и рассудительному расчету.',
      zh: '太阳与太阴同守一宫，刚柔动静两股力量同驻于身，既有对外担当与开阔视野，又有内省细腻与美学聚财之心。情绪与节奏易随境切换，一旦学会平衡昼夜消长，反具少见的包容格局。',
      en: 'Tai Yang and Tai Yin sharing one palace weave outward drive together with quiet, reflective depth. One side pushes for visibility and service while the other craves nuance and private sanctuary; mastering that rhythm turns inner contrast into rare versatility.',
    },
    lifeOrientation: {
      ru: 'Сильные сферы — международные проекты, бренд-стратегия, управление на стыке креатива и финансов; чередуйте активную отдачу с качественным отдыхом.',
      zh: '适合跨界运营、对外沟通、品牌财务与教育文化；顺应动静周期而不强求全天候高耗，运势更稳。',
      en: 'Cross-cultural leadership, brand strategy, and balancing external outreach with private craft maximize both halves of your chart.',
    },
    keywords: {
      ru: ['Контраст', 'Баланс', 'Масштаб', 'Глубина'],
      zh: ['阴阳并济', '动静相兼', '包容', '多面'],
      en: ['Duality', 'Balance', 'Perspective', 'Adaptability'],
    },
  },

  '廉杀': {
    key: '廉杀',
    stars: ['廉贞', '七杀'],
    archetypeTitle: {
      ru: 'Закаленный клинок и воля (Лянь Чжэнь · Ци Ша)',
      zh: '雄才历练 · 廉贞七杀格',
      en: 'Tempered Vanguard (Lian Zhen · Qi Sha)',
    },
    coreTemperament: {
      ru: 'Лянь Чжэнь и Ци Ша образуют одну из самых напряженных и волевых связок: страстная амбициозность соединяется с жесткой самодисциплиной и готовностью к тяжелым испытаниям. Вы способны совершить мощный прорыв там, где другие отступают, если направляете внутренний огонь в созидательные рамки.',
      zh: '廉贞与七杀同宫，才情魄力与刚烈决断并存，天生带有「在压力中淬炼成器」的硬核气质。行动力与掌控欲极强，不畏艰险，但若缺少吉星调和或自制力，易因锋芒太露而经历较大起伏。',
      en: 'Lian Zhen and Qi Sha form a fiercely driven pairing where intense passion meets martial grit. You can execute daunting turnarounds and rise through pressure that deters others, provided your fire stays channeled into disciplined structure rather than impulsive battles.',
    },
    lifeOrientation: {
      ru: 'Высокий потенциал в кризисном управлении, предпринимательстве, праве, хирургии, инженерии и стратегической конкуренции. Терпение — ваш главный союзник.',
      zh: '适合攻坚创业、行业改革、法务风控、精密技术与高挑战管理；以制度与耐心收束锐气，成就非凡。',
      en: 'Turnaround leadership, entrepreneurship, law, engineering, and high-stakes execution reward your resilience when tempered by patience.',
    },
    keywords: {
      ru: ['Сверхволя', 'Прорыв', 'Закалка', 'Интенсивность'],
      zh: ['刚烈', '突破', '魄力', '淬炼'],
      en: ['Intensity', 'Resilience', 'Turnaround', 'Grit'],
    },
  },

  '武杀': {
    key: '武杀',
    stars: ['武曲', '七杀'],
    archetypeTitle: {
      ru: 'Полководец финансов и дела (У Цюй · Ци Ша)',
      zh: '将财并峙 · 武曲七杀格',
      en: 'Iron Executive (Wu Qu · Qi Sha)',
    },
    coreTemperament: {
      ru: 'Две металлические звезды — У Цюй и Ци Ша — дают железобетонную решительность, нацеленность на конкретный результат и бесстрашие перед сложными задачами. Вы привыкли рассчитывать на себя, рубите сплеча и не любите лишних сантиментов, поэтому мягкость в коммуникации становится ключевым фактором успеха.',
      zh: '武曲与七杀双金同宫，刚毅果断与实干冲劲推向极致，对效率、收益与成败极为敏感。天生适合在竞争环境中硬碰硬地打天下，唯性格较易刚直急躁，需防过于孤硬而伤及人脉。',
      en: 'Two metal stars—Wu Qu and Qi Sha—deliver uncompromising determination, financial focus, and fearless execution. You tackle hard realities head-on without sugarcoating, and cultivating diplomatic warmth keeps loyal allies at your side.',
    },
    lifeOrientation: {
      ru: 'Отлично раскрывается в крупном бизнесе, инвестициях, производстве, логистике, силовых и технологических проектах.',
      zh: '适合金融实业、工程制造、独立创业及高压决策岗位；凡事留三分转圜，财富与威望更长久。',
      en: 'Finance, manufacturing, venture execution, and demanding operational roles thrive on your clarity and endurance.',
    },
    keywords: {
      ru: ['Решительность', 'Капитал', 'Сталь', 'Результат'],
      zh: ['刚毅', '实干', '聚财', '果断'],
      en: ['Decisiveness', 'Capital', 'Endurance', 'Precision'],
    },
  },

  '武贪': {
    key: '武贪',
    stars: ['武曲', '贪狼'],
    archetypeTitle: {
      ru: 'Коммерческий драйв и зрелый прорыв (У Цюй · Тань Лан)',
      zh: '厚积晚发 · 武曲贪狼格',
      en: 'Commercial Strategist (Wu Qu · Tan Lang)',
    },
    coreTemperament: {
      ru: 'У Цюй и Тань Лан объединяют деловую хватку с предпринимательским чутьем и умением работать с людьми. Классическая формула этой связки — зрелое созревание: сначала вы накапливаете опыт, связи и дисциплину, а затем превращаете их в ощутимый финансовый масштаб.',
      zh: '武曲与贪狼同宫，财星之务实遇上贪狼之交际与野心，构成极具商业敏锐度的配置。早年往往经历打磨与节奏摸索，三十岁后随着经验与人脉沉淀，反而越走越宽、后劲强劲。',
      en: 'Wu Qu and Tan Lang pair financial pragmatism with social savvy and commercial appetite. Classic tradition notes this combination matures best over time—early years build craft and networks that compound into major material momentum later on.',
    },
    lifeOrientation: {
      ru: 'Высокий потенциал в коммерции, инвестициях, переговорах, девелопменте и индустрии стиля жизни; избегайте поспешных спекуляций в молодости.',
      zh: '适合金融商业、资源整合、销售拓展与品牌经营；重长期复利而不急功近利，终见大成。',
      en: 'Commerce, investments, partnerships, and consumer brands thrive when your bold networking stays anchored by financial rigor.',
    },
    keywords: {
      ru: ['Коммерция', 'Амбиции', 'Опыт', 'Рост'],
      zh: ['商机', '厚积薄发', '人脉', '实利'],
      en: ['Commerce', 'Maturity', 'Networks', 'Prosperity'],
    },
  },

  '巨日': {
    key: '巨日',
    stars: ['太阳', '巨门'],
    archetypeTitle: {
      ru: 'Сила убеждения и открытый голос (Тай Ян · Цзюй Мэнь)',
      zh: '声名远播 · 巨日同宫格',
      en: 'Advocate & Beacon (Tai Yang · Ju Men)',
    },
    coreTemperament: {
      ru: 'Солнце рассеивает тень Цзюй Мэнь: проницательный, критический ум соединяется с ясностью, благородством и желанием доносить смысл широкой аудитории. Вы убедительны в спорах, хорошо чувствуете международную повестку и умеете защищать правду фактами.',
      zh: '太阳与巨门同宫，太阳之光辉恰能驱散巨门之暗疑，化口舌思辨为公众影响力。思路清晰、表达有力、擅长跨文化与专业沟通，宜靠学识、声望与讲理服人走上大舞台。',
      en: 'Tai Yang illuminates Ju Men’s probing intellect, turning skepticism into persuasive public voice and clarity. You excel at articulating complex truths across cultures and audiences, thriving wherever credible speech builds authority.',
    },
    lifeOrientation: {
      ru: 'Отлично подходит для права, образования, международных переговоров, медиа, консалтинга и публичной экспертизы.',
      zh: '适合律师法务、高校教学、传媒出版、国际贸易与专业讲师；以诚意配锋芒，名利易得。',
      en: 'Law, education, international business, media, and thought leadership capitalize on your clarity and reach.',
    },
    keywords: {
      ru: ['Убедительность', 'Авторитет', 'Смысл', 'Горизонт'],
      zh: ['名声', '口才', '明理', '远播'],
      en: ['Persuasion', 'Clarity', 'Advocacy', 'Reach'],
    },
  },

  '同梁': {
    key: '同梁',
    stars: ['天同', '天梁'],
    archetypeTitle: {
      ru: 'Мудрая доброта и устойчивое покровительство (Тянь Тун · Тянь Лян)',
      zh: '福荫相随 · 天同天梁格',
      en: 'Gracious Guardian (Tian Tong · Tian Liang)',
    },
    coreTemperament: {
      ru: 'Тянь Тун смягчает строгость Тянь Лян, а Тянь Лян придает доброте Тянь Тун прочный моральный фундамент. В результате складывается редкий склад защитника-миротворца: вы вызываете искреннее доверие, умеете лечить словом или делом и спокойно выходите из трудных ситуаций.',
      zh: '天同与天梁同宫，温厚福星与老成荫星合璧，既具仁心亲和力，又有原则护持之力。遇事往往能沉着化解波折、受长辈或制度庇荫，唯有时偏于求稳，宜适度激发主动破局之心。',
      en: 'Tian Tong softens Tian Liang’s solemnity while Tian Liang anchors Tian Tong’s warmth with principles and resilience. People naturally trust your steady goodwill and crisis composure, though proactively claiming ambition keeps comfort from turning passive.',
    },
    lifeOrientation: {
      ru: 'Прекрасная основа для медицины, психологии, права, образования, благотворительности и устойчивого управления людьми.',
      zh: '适合医疗康养、法律咨询、教育辅导、公共机构及稳健服务业；以仁厚立身，愈久愈见厚福。',
      en: 'Healthcare, counseling, law, education, and stewardship roles prosper under your calm, trustworthy demeanor.',
    },
    keywords: {
      ru: ['Защита', 'Доброта', 'Зрелость', 'Доверие'],
      zh: ['福荫', '仁厚', '稳健', '解厄'],
      en: ['Grace', 'Protection', 'Trust', 'Stability'],
    },
  },

  '廉相': {
    key: '廉相',
    stars: ['廉贞', '天相'],
    archetypeTitle: {
      ru: 'Эстетика порядка и утонченная стратегия (Лянь Чжэнь · Тянь Сян)',
      zh: '印绶化刚 · 廉贞天相格',
      en: 'Refined Executive (Lian Zhen · Tian Xiang)',
    },
    coreTemperament: {
      ru: 'Тянь Сян уравновешивает страстный, контрастный темперамент Лянь Чжэнь чувством формы, такта и закона. Вы объединяете харизму, вкус и способность выстраивать безупречные процессы: в делах умеете сочетать дипломатичность с жестким знанием своих интересов.',
      zh: '廉贞与天相同宫，天相之印绶礼法恰可收敛廉贞之锋芒，化炽烈才情为优雅从容的统筹力。既有审美格调与交际手腕，又重规则分寸，只要不碰破规底线，极易凭专业与信誉上位。',
      en: 'Tian Xiang tempers Lian Zhen’s fiery intensity with diplomatic poise, fairness, and executive polish. You combine creative flair with procedural rigor, gaining influence through taste, tact, and clean execution.',
    },
    lifeOrientation: {
      ru: 'Ваши сферы — корпоративное управление, право, дизайн, дипломатия, консалтинг и люксовый или интеллектуальный сервис.',
      zh: '适合法务行政、时尚设计、品牌公关、企业中枢与高阶顾问；守正重诺则声望日隆。',
      en: 'Governance, law, luxury/design leadership, diplomacy, and high-trust consulting fit your balanced refinement.',
    },
    keywords: {
      ru: ['Такт', 'Стиль', 'Порядок', 'Влияние'],
      zh: ['优雅', '守礼', '才干', '分寸'],
      en: ['Poise', 'Tact', 'Order', 'Influence'],
    },
  },

  // ── Remaining 15 Classical Dual-Star Combinations (Full 24-Pair Coverage) ──
  '紫贪': {
    key: '紫贪',
    stars: ['紫微', '贪狼'],
    archetypeTitle: {
      ru: 'Император и харизматичный искатель (Цзы Вэй · Тань Лан)',
      zh: '桃花帝座 · 紫微贪狼格',
      en: 'Charismatic Sovereign (Zi Wei · Tan Lang)',
    },
    coreTemperament: {
      ru: 'Цзы Вэй придает размах и стремление к первенству, а Тань Лан добавляет яркое обаяние, вкус к жизни и художественное чутье. Вы притягиваете людей и возможности, но внутренний выбор между самодисциплиной и соблазнами определяет итоговый масштаб.',
      zh: '紫微与贪狼同入命宫（卯酉），兼备帝星之志向与贪狼之风采才艺，极擅社交与跨界表现。人生魅力突出、渴望多元体验，若能以克己与专精收束欲望，极易在名利场脱颖而出。',
      en: 'Zi Wei and Tan Lang combine imperial ambition with artistic charm and social magnetism. You draw attention and opportunity naturally, reaching peak stature once focus disciplines restless desires.',
    },
    lifeOrientation: {
      ru: 'Раскрывается в медиа, бизнесе, искусстве, управлении брендами и переговорах высокого уровня.',
      zh: '适合文化娱乐、高端商业、公关品牌与跨界创业；守住定力与原则则格局倍增。',
      en: 'Media, luxury, entrepreneurship, and strategic partnerships flourish when your vision stays focused.',
    },
    keywords: {
      ru: ['Харизма', 'Масштаб', 'Талант', 'Амбиции'],
      zh: ['才艺', '气场', '桃花', '进取'],
      en: ['Charisma', 'Ambition', 'Artistry', 'Appeal'],
    },
  },

  '紫相': {
    key: '紫相',
    stars: ['紫微', '天相'],
    archetypeTitle: {
      ru: 'Власть и верная опора закона (Цзы Вэй · Тянь Сян)',
      zh: '君臣同度 · 紫微天相格',
      en: 'Principled Leader (Zi Wei · Tian Xiang)',
    },
    coreTemperament: {
      ru: 'Союз Цзы Вэй и Тянь Сян в осях Чэнь или Сюй формирует уравновешенного, ответственного лидера с сильным чувством этики и порядка. Вы убедительны без грубого давления, умеете выстраивать прочные альянсы и цените честную игру.',
      zh: '紫微与天相同宫（辰戌），帝王格局得印绶辅弼之性调和，处事既讲高度又重公道。为人正直有担当、协调力佳，唯有时受对宫破军冲动影响，需在稳健与变革间拿捏平衡。',
      en: 'Zi Wei and Tian Xiang unite sovereign vision with diplomatic fairness and respect for due process. You build durable alliances and steady authority while balancing stability against urges for sudden overhaul.',
    },
    lifeOrientation: {
      ru: 'Сильная конфигурация для госуправления, права, корпоративной стратегии, дипломатии и руководства крупными командами.',
      zh: '适合行政管理、法律制度、企业运营与公共事务；兼顾果断与温和，功业稳步积累。',
      en: 'Governance, law, institutional management, and strategic partnerships capitalize on your fairness and poise.',
    },
    keywords: {
      ru: ['Этика', 'Порядок', 'Лидерство', 'Альянсы'],
      zh: ['公正', '统御', '信誉', '稳健'],
      en: ['Fairness', 'Governance', 'Poise', 'Trust'],
    },
  },

  '紫杀': {
    key: '紫杀',
    stars: ['紫微', '七杀'],
    archetypeTitle: {
      ru: 'Власть, превращенная в созидательную силу (Цзы Вэй · Ци Ша)',
      zh: '化杀为权 · 紫微七杀格',
      en: 'Commanding Strategist (Zi Wei · Qi Sha)',
    },
    coreTemperament: {
      ru: 'Цзы Вэй направляет неукротимую мощь Ци Ша в конструктивное русло, превращая жесткость в стратегический авторитет. Вы способны вести масштабные преобразования, не боитесь конкуренции и держите удар, но важно слышать близких, а не только команды.',
      zh: '紫微与七杀同宫（巳亥），帝星能御将星之威，化刚猛肃杀为实际掌控力。志向远大、魄力非凡，凡事敢于拍板担责，但性格较显强硬，学会刚柔相济方能聚拢人心。',
      en: 'Zi Wei harnesses Qi Sha’s martial force into purposeful executive command. Unfazed by competition or crisis, you lead decisive breakthroughs—especially when empathy balances your uncompromising drive.',
    },
    lifeOrientation: {
      ru: 'Великолепно работает в бизнесе, трансформации компаний, индустрии, строительстве и кризис-менеджменте.',
      zh: '适合企业掌舵、行业攻坚、工程开发与变革管理；以德御威则追随者众。',
      en: 'Executive turnarounds, industry leadership, and high-stakes ventures benefit from your commanding presence.',
    },
    keywords: {
      ru: ['Командование', 'Сила', 'Масштаб', 'Прорыв'],
      zh: ['化杀为权', '魄力', '担当', '格局'],
      en: ['Command', 'Authority', 'Breakthrough', 'Resolve'],
    },
  },

  '紫破': {
    key: '紫破',
    stars: ['紫微', '破军'],
    archetypeTitle: {
      ru: 'Суверен перемен и реформ (Цзы Вэй · По Цзюнь)',
      zh: '开创新局 · 紫微破军格',
      en: 'Reformist Sovereign (Zi Wei · Po Jun)',
    },
    coreTemperament: {
      ru: 'Цзы Вэй и По Цзюнь в Чоу или Вэй создают мощный тандем стратега-реформатора: вы не довольствуетесь готовым, стремитесь перестроить правила игры и поднять планку. Поток идей и энергии огромен, но устойчивость приходит тогда, когда за обновлением следует четкий порядок.',
      zh: '紫微与破军同宫（丑未），帝星遇先锋破旧之星，极富开拓精神与颠覆重建之力。不满足于平庸现状，一生常主动破局立新，唯需防止情绪化大拆大建，先立规矩再革新更稳。',
      en: 'Zi Wei and Po Jun unite vision with pioneering disruption. Rarely content with the status quo, you rebuild institutions and standards from the ground up—thriving most when bold reforms are followed by systematic consolidation.',
    },
    lifeOrientation: {
      ru: 'Идеально для запуска новых направлений, реструктуризации бизнеса, архитектуры систем и лидерства в период перемен.',
      zh: '适合创业拓荒、业务重整、产品研发与制度革新；用稳健执行承接大胆构想，成就突出。',
      en: 'New ventures, business transformation, systems architecture, and change leadership showcase your pioneering vision.',
    },
    keywords: {
      ru: ['Реформы', 'Лидерство', 'Новаторство', 'Масштаб'],
      zh: ['破旧立新', '开创', '魄力', '格局'],
      en: ['Reform', 'Vision', 'Innovation', 'Authority'],
    },
  },

  '机巨': {
    key: '机巨',
    stars: ['天机', '巨门'],
    archetypeTitle: {
      ru: 'Мастер аргумента и живой аналитики (Тянь Цзи · Цзюй Мэнь)',
      zh: '智辩精研 · 天机巨门格',
      en: 'Incisive Thinker (Tian Ji · Ju Men)',
    },
    coreTemperament: {
      ru: 'Тянь Цзи придает скорость и системность мысли, а Цзюй Мэнь — глубину анализа и дар убедительной речи. Вы мгновенно замечаете слабые места в чужой логике и строите сильные аргументы, но избыточная самокритика или споры из принципа способны истощать силы.',
      zh: '天机与巨门同宫（卯酉），灵动智慧结合深度思辨，反应极快、言辞犀利，具备出众的策划与研究天赋。适合靠脑力与口才破局立身，但也要留意避免钻牛角尖或陷入无谓争执。',
      en: 'Tian Ji’s swift cognition meets Ju Men’s probing logic and verbal agility. You spot flaws rapidly and build compelling cases, though mental over-scrutiny or debating just to win can create avoidable friction.',
    },
    lifeOrientation: {
      ru: 'Раскрывается в праве, исследованиях, IT-архитектуре, преподавании, консалтинге и сложной коммуникации.',
      zh: '适合法律、科研、技术架构、教育培训与商业谈判；以诚相待、少疑多行，前景开阔。',
      en: 'Law, research, software architecture, education, and complex negotiations harness your analytical eloquence.',
    },
    keywords: {
      ru: ['Логика', 'Речь', 'Аналитика', 'Скорость'],
      zh: ['思辨', '机敏', '口才', '研究'],
      en: ['Logic', 'Eloquence', 'Research', 'Agility'],
    },
  },

  '机梁': {
    key: '机梁',
    stars: ['天机', '天梁'],
    archetypeTitle: {
      ru: 'Мудрый советник и архитектор решений (Тянь Цзи · Тянь Лян)',
      zh: '高明参谋 · 天机天梁格',
      en: 'Wise Counselor (Tian Ji · Tian Liang)',
    },
    coreTemperament: {
      ru: 'Тянь Цзи дает гибкость и изобретательность, а Тянь Лян — этический компас и долгосрочную мудрость. Это классический склад блестящего стратега и наставника: вы видите выход из запутанных ситуаций, цените знания и помогаете людям находить опору.',
      zh: '天机与天梁同宫（辰戌），善谋之星遇荫庇老成之星，堪称天生的智囊与军师配置。思路既有前瞻巧思，又不失稳健原则与慈悲情怀，善于化解难题并提出可靠方案。',
      en: 'Tian Ji’s inventiveness pairs with Tian Liang’s seasoned wisdom and moral compass. You are a natural strategist and counselor—adept at untangling complex dilemmas with solutions that hold up ethically and practically.',
    },
    lifeOrientation: {
      ru: 'Прекрасно подходит для стратегического консалтинга, науки, медицины, права, образования и системного проектирования.',
      zh: '适合战略咨询、医学法务、学术研究、教育公益与规划设计；知行合一，口碑极佳。',
      en: 'Strategy, academia, medicine, law, and architecture reward your thoughtful, principled problem-solving.',
    },
    keywords: {
      ru: ['Советник', 'Мудрость', 'Стратегия', 'Этика'],
      zh: ['智囊', '稳健', '谋略', '善解'],
      en: ['Counsel', 'Wisdom', 'Strategy', 'Integrity'],
    },
  },

  '阳梁': {
    key: '阳梁',
    stars: ['太阳', '天梁'],
    archetypeTitle: {
      ru: 'Свет знаний и благородного служения (Тай Ян · Тянь Лян)',
      zh: '清贵昌明 · 太阳天梁格',
      en: 'Luminous Scholar (Tai Yang · Tian Liang)',
    },
    coreTemperament: {
      ru: 'Тай Ян и Тянь Лян (в осях Мао и Ю) образуют светлый, благородный характер, ориентированный на знания, честность и общественную пользу. Вы стремитесь к профессиональному авторитету и ясности принципов, легко выступаете наставником или экспертом.',
      zh: '太阳与天梁同宫（卯酉），光辉坦荡与清贵仁厚交融，极利于学术考试、专业认证与公信力建设。处事重正义、讲体面，一生易走清贵显达之路，唯需兼顾务实财务规划。',
      en: 'Tai Yang and Tian Liang blend radiant candor with principled mentorship. Favoring scholarly mastery, ethics, and public service, you thrive where recognized expertise and personal integrity lead the way.',
    },
    lifeOrientation: {
      ru: 'Наиболее гармонично раскрывается в науке, образовании, праве, медицине, госслужбе и экспертной аналитике.',
      zh: '适合科研教育、医疗法律、专业资质行业与公共管理；专精一门则名望长青。',
      en: 'Academia, medicine, law, public institutions, and credentialed professions amplify your credibility.',
    },
    keywords: {
      ru: ['Знания', 'Честь', 'Экспертиза', 'Служение'],
      zh: ['清贵', '学识', '正义', '名望'],
      en: ['Scholarship', 'Honor', 'Expertise', 'Service'],
    },
  },

  '武府': {
    key: '武府',
    stars: ['武曲', '天府'],
    archetypeTitle: {
      ru: 'Архитектор прочного капитала (У Цюй · Тянь Фу)',
      zh: '双财聚库 · 武曲天府格',
      en: 'Wealth Custodian (Wu Qu · Tian Fu)',
    },
    coreTemperament: {
      ru: 'Соединение звезды дохода У Цюй и звезды хранилища Тянь Фу дает редкое сочетание активности в заработке и умения сохранять накопленное. Вы трезво оцениваете риски, уважаете порядок и строите благосостояние на десятилетия, хотя иногда излишне осторожны в личных чувствах.',
      zh: '武曲与天府同宫（子午），正财星与财库星携手，既擅开源创收，又精于稳健守成。判断务实冷静、信用可靠，对物质保障与长远规划尤为敏锐，是极具底气的务实派格局。',
      en: 'Combining wealth-generator Wu Qu with vault-keeper Tian Fu creates rare discipline in both earning and preserving capital. You calculate risks coolly and build lasting security, though emotional expression can feel guarded.',
    },
    lifeOrientation: {
      ru: 'Отлично подходит для финансов, банковской сферы, недвижимости, управления капиталом и производственного бизнеса.',
      zh: '适合金融投资、财务掌舵、不动产配置与实业经营；在稳健中多些生活温度，人生更圆满。',
      en: 'Banking, investment management, real estate, and durable enterprise building align seamlessly with your strengths.',
    },
    keywords: {
      ru: ['Богатство', 'Сохранность', 'Расчет', 'Надежность'],
      zh: ['聚财', '守库', '务实', '稳健'],
      en: ['Prosperity', 'Prudence', 'Capital', 'Trust'],
    },
  },

  '武相': {
    key: '武相',
    stars: ['武曲', '天相'],
    archetypeTitle: {
      ru: 'Точность дела и дипломатия (У Цюй · Тянь Сян)',
      zh: '刚柔并济 · 武曲天相格',
      en: 'Measured Executor (Wu Qu · Tian Xiang)',
    },
    coreTemperament: {
      ru: 'Тянь Сян смягчает прямолинейность У Цюй, превращая жесткую волю в отточенную, тактичную эффективность. Вы умеете и считать деньги, и договариваться с людьми, выступая надежным управляющим или партнером, на которого можно положиться в кризис.',
      zh: '武曲与天相同宫（寅申），天相之协调礼度缓和了武曲之刚硬，兼具执行效率与沟通分寸。处事既重结果也顾体面，擅长在制度与人情间找到精准平衡点。',
      en: 'Tian Xiang refines Wu Qu’s blunt edge into measured, diplomatic execution. You balance financial discipline with interpersonal tact, making you an indispensable operator and trusted partner.',
    },
    lifeOrientation: {
      ru: 'Подходят корпоративные финансы, юридически выверенный бизнес, управление проектами и международная торговля.',
      zh: '适合财务管理、商业合作、法务合规与核心运营岗位；刚柔得宜，发展稳中有升。',
      en: 'Corporate finance, structured partnerships, operations, and trade reward your poised efficiency.',
    },
    keywords: {
      ru: ['Эффективность', 'Такт', 'Сделки', 'Порядок'],
      zh: ['务实', '协调', '信誉', '高效'],
      en: ['Efficiency', 'Tact', 'Execution', 'Balance'],
    },
  },

  '武破': {
    key: '武破',
    stars: ['武曲', '破军'],
    archetypeTitle: {
      ru: 'Прорыв через действие и риск (У Цюй · По Цзюнь)',
      zh: '果决革故 · 武曲破军格',
      en: 'Disruptive Operator (Wu Qu · Po Jun)',
    },
    coreTemperament: {
      ru: 'У Цюй и По Цзюнь в Сы или Хай — это мощный импульс практического переворота: вы не боитесь разрушать неэффективные схемы и немедленно перестраивать дело на практике. Энергия колоссальная, но финансовые и карьерные скачки требуют четкого риск-менеджмента.',
      zh: '武曲与破军同宫（巳亥），刚毅实干遇上破旧立新，行动力与革新欲皆极旺盛。敢于在别人犹豫时果断出手重整局面，但因起伏较大，切忌孤注一掷，留足后手最为要紧。',
      en: 'Wu Qu and Po Jun deliver formidable hands-on disruption, tearing out inefficiency to rebuild stronger operations immediately. Your drive is intense, and disciplined risk buffers ensure bold leaps translate into lasting wealth.',
    },
    lifeOrientation: {
      ru: 'Сильная связка для реструктуризации компаний, технологического предпринимательства, инженерии и кризис-проектов.',
      zh: '适合商业重整、技术革新、工程攻坚与独立创业；以严谨风控配合魄力，方能越战越稳。',
      en: 'Turnarounds, venture building, engineering, and dynamic markets harness your transformative drive.',
    },
    keywords: {
      ru: ['Действие', 'Перестройка', 'Характер', 'Риск'],
      zh: ['决断', '革新', '实干', '突破'],
      en: ['Action', 'Overhaul', 'Courage', 'Drive'],
    },
  },

  '同阴': {
    key: '同阴',
    stars: ['天同', '太阴'],
    archetypeTitle: {
      ru: 'Утонченная гармония и тихое изобилие (Тянь Тун · Тай Инь)',
      zh: '水澄桂萼 · 天同太阴格',
      en: 'Serene Aesthetic (Tian Tong · Tai Yin)',
    },
    coreTemperament: {
      ru: 'Союз двух мягких водных звезд — Тянь Тун и Тай Инь — наделяет удивительным обаянием, чувством красоты, миролюбием и интуитивным притяжением комфорта. При яркости в Цзы это классическая мягкая удача, но в делах важно вовремя включать инициативу и не уходить от решений.',
      zh: '天同与太阴双水星同宫（子午），性情温润如玉、富有浪漫与审美情怀，极擅营造安心融洽的氛围。若居子位庙旺则清雅聚福，唯在面对竞争时须多一分果断主见。',
      en: 'Two gentle water stars—Tian Tong and Tai Yin—bestow poise, artistic sensibility, and quiet magnetic charm. In bright positions this creates graceful good fortune, flourishing even further when paired with proactive decisiveness.',
    },
    lifeOrientation: {
      ru: 'Подходят искусство, дизайн, культура, гостеприимство, психология, финансы и бренды о качестве жизни.',
      zh: '适合美学设计、文艺传媒、教育心理、生活品牌与稳健理财；温和之中带一点韧劲更佳。',
      en: 'Design, arts, hospitality, psychology, and thoughtful wealth management thrive on your calm touch.',
    },
    keywords: {
      ru: ['Эстетика', 'Мягкость', 'Гармония', 'Комфорт'],
      zh: ['温润', '清雅', '审美', '福泽'],
      en: ['Serenity', 'Aesthetics', 'Warmth', 'Ease'],
    },
  },

  '同巨': {
    key: '同巨',
    stars: ['天同', '巨门'],
    archetypeTitle: {
      ru: 'Чувствительность и поиск глубинного смысла (Тянь Тун · Цзюй Мэнь)',
      zh: '外和内思 · 天同巨门格',
      en: 'Thoughtful Empath (Tian Tong · Ju Men)',
    },
    coreTemperament: {
      ru: 'Тянь Тун стремится к покою и близости, а Цзюй Мэнь постоянно анализирует подтексты и тревожные детали. Это рождает глубокую, искреннюю личность с даром слова и эмпатией, которой важно проговаривать сомнения открыто, а не копить их внутри.',
      zh: '天同与巨门同宫（丑未），外在温和随和，内心却敏锐多思、对言语与细节极度在意。一旦把细致观察力投入专业研究或表达创作，反而能言之有物，关键在于释放无谓的内耗与猜疑。',
      en: 'Tian Tong craves harmony while Ju Men probes every nuance beneath the surface. This creates a deeply observant, articulate personality that shines once unspoken doubts are voiced constructively rather than bottled up.',
    },
    lifeOrientation: {
      ru: 'Хорошо проявляется в психологии, литературе, преподавании, праве, исследованиях и деликатном консультировании.',
      zh: '适合文字创作、心理咨询、研究教学与专业顾问；化敏感为洞察，愈见从容。',
      en: 'Counseling, writing, research, teaching, and advisory roles convert your sensitivity into rare insight.',
    },
    keywords: {
      ru: ['Чуткость', 'Смысл', 'Речь', 'Глубина'],
      zh: ['细腻', '敏思', '言辞', '内省'],
      en: ['Sensitivity', 'Insight', 'Expression', 'Depth'],
    },
  },

  '廉府': {
    key: '廉府',
    stars: ['廉贞', '天府'],
    archetypeTitle: {
      ru: 'Талант под защитой здравого смысла (Лянь Чжэнь · Тянь Фу)',
      zh: '才守兼备 · 廉贞天府格',
      en: 'Grounded Tactician (Lian Zhen · Tian Fu)',
    },
    coreTemperament: {
      ru: 'Тянь Фу надежно заземляет яркую, темпераментную энергию Лянь Чжэнь. В итоге вы сочетаете артистизм, смелость и дипломатическое чутье с практическим контролем над финансами и ресурсами, уверенно держа баланс между желаниями и долгом.',
      zh: '廉贞与天府同宫（辰戌），才情张力得稳重财库之星包容收束，既不失开拓魅力，又能守住实质利益与分寸。处事兼顾创意与财务安全感，属于能进能守的成熟型组合。',
      en: 'Tian Fu grounds Lian Zhen’s fiery magnetism with steady judgment and asset awareness. You blend creative energy and charisma with sound financial restraint, knowing when to push forward and when to consolidate.',
    },
    lifeOrientation: {
      ru: 'Эффективно в управлении активами, праве, продюсировании, корпоративном управлении и брендинге.',
      zh: '适合商业管理、金融风控、法务合规与文化品牌运营；守正蓄势，发展稳健长远。',
      en: 'Enterprise management, finance, legal strategy, and brand stewardship reward your balanced intensity.',
    },
    keywords: {
      ru: ['Контроль', 'Харизма', 'Ресурс', 'Зрелость'],
      zh: ['才守兼备', '稳健', '魅力', '掌控'],
      en: ['Composed', 'Strategic', 'Steward', 'Magnetic'],
    },
  },

  '廉贪': {
    key: '廉贪',
    stars: ['廉贞', '贪狼'],
    archetypeTitle: {
      ru: 'Огонь страсти, таланта и амбиций (Лянь Чжэнь · Тань Лан)',
      zh: '风华才情 · 廉贞贪狼格',
      en: 'Passionate Creator (Lian Zhen · Tan Lang)',
    },
    coreTemperament: {
      ru: 'Союз двух ярких звезд обаяния и таланта в Сы или Хай дает огромную притягательность, артистичность и жажду яркой реализации. Жизнь полна сильных впечатлений и встреч; главная задача — дисциплинировать импульсы, превращая вдохновение в мастерство.',
      zh: '廉贞与贪狼同宫（巳亥），双桃花与才艺能量交叠，极富感染力、创意与社交魅力。感受敏锐且渴望精彩舞台，若缺乏原则边界则易情绪或感情波动；以专业技艺沉淀热情，反而光芒万丈。',
      en: 'Two magnetic stars—Lian Zhen and Tan Lang—ignite extraordinary charm, creative drive, and social presence. Experiences run vivid and intense; anchoring passion in mastery and clear personal boundaries turns spark into lasting brilliance.',
    },
    lifeOrientation: {
      ru: 'Сильнее всего в искусстве, дизайне, медиа, развлечениях, люкс-индустрии, продажах и международных связях.',
      zh: '适合艺术设计、演艺传媒、高端营销、公关外交与创意创业；修心守正，才华变现极强。',
      en: 'Arts, media, luxury brands, public relations, and creative ventures thrive on your expressive flair.',
    },
    keywords: {
      ru: ['Страсть', 'Артистизм', 'Шарм', 'Творчество'],
      zh: ['才艺', '魅力', '感性', '表达'],
      en: ['Passion', 'Artistry', 'Charm', 'Expression'],
    },
  },

  '廉破': {
    key: '廉破',
    stars: ['廉贞', '破军'],
    archetypeTitle: {
      ru: 'Нестандартный реформатор с огненным нравом (Лянь Чжэнь · По Цзюнь)',
      zh: '破局重塑 · 廉贞破军格',
      en: 'Fierce Innovator (Lian Zhen · Po Jun)',
    },
    coreTemperament: {
      ru: 'Лянь Чжэнь и По Цзюнь в Мао или Ю формируют бескомпромиссного новатора с сильной волей и неприятием фальши. Вы способны на резкие карьерные повороты и смелую борьбу за правду, но высокая импульсивность требует холодной головы в финансах и контрактах.',
      zh: '廉贞与破军同宫（卯酉），炽烈执着遇上破旧立新，行动力锐利、最厌虚饰与束缚。一生容易经历较大转折与自我重塑，凡遇合约财务或冲突节点，多一分冷静核验即能化险为进。',
      en: 'Lian Zhen and Po Jun form an intense innovator who rejects artificial limits and thrives on decisive reinvention. Bold turns define your journey, and verifying details calmly before leaping ensures breakthroughs build lasting security.',
    },
    lifeOrientation: {
      ru: 'Реализуется в технологическом прорыве, трансформации процессов, дизайне, кризис-менеджменте и независимых проектах.',
      zh: '适合技术革新、危机攻坚、创意破局与独立事业；收敛情绪化冲动，能成别人不敢做之事。',
      en: 'Disruptive tech, turnaround projects, engineering, and bold independent work suit your fearless energy.',
    },
    keywords: {
      ru: ['Решительность', 'Переворот', 'Огонь', 'Смелость'],
      zh: ['革新', '锐气', '破局', '真性情'],
      en: ['Fierce', 'Innovative', 'Unfiltered', 'Bold'],
    },
  },
};

// ────────────────── Lookup & Nuance Helpers ──────────────────

const DUAL_COMBO_BY_PAIR = new Map<string, DualStarComboKey>();
for (const profile of Object.values(LIFE_PALACE_DUAL_PROFILES)) {
  const [a, b] = profile.stars;
  DUAL_COMBO_BY_PAIR.set(`${a}+${b}`, profile.key);
  DUAL_COMBO_BY_PAIR.set(`${b}+${a}`, profile.key);
}

const SIHUA_GENERAL_NUANCE: Record<SiHua, LocalizedText> = {
  '禄': {
    ru: 'Натальная Хуа Лу (Процветание) привносит естественную открытость возможностям, оптимизм, доверие людей и мягкое притяжение ресурсов.',
    zh: '生年化禄入命（或自对宫来会）主乐观通达、人缘财气顺畅，做事更容易找到获利与变现入口。',
    en: 'Natal Hua Lu (Prosperity) brings ease, optimism, social warmth, and natural resource flow.',
  },
  '权': {
    ru: 'Натальная Хуа Цюань (Власть) усиливает волю, инициативу, стремление к авторитету и способность брать управление в свои руки.',
    zh: '生年化权入命主主见强烈、行动力与掌控欲提升，凡事倾向自己拍板，越历练越显权威。',
    en: 'Natal Hua Quan (Authority) amplifies ambition, self-direction, and executive willpower.',
  },
  '科': {
    ru: 'Натальная Хуа Кэ (Слава и Знания) дает ясность ума, хорошую репутацию, поддержку наставников и умение решать споры достойно.',
    zh: '生年化科入命主聪慧重名声、谈吐得体，易凭专业学识与良好口碑赢得贵人赏识。',
    en: 'Natal Hua Ke (Renown) bestows refined intellect, credibility, and graceful support in critical moments.',
  },
  '忌': {
    ru: 'Натальная Хуа Цзи (Узел концентрации) фокусирует внимание и привязанность, рождая перфекционизм и внутреннее напряжение — но при зрелой работе превращается в глубокую экспертность.',
    zh: '生年化忌入命主执着专注与内在自我要求高，早年易感压力或反复磨砺，转化为深耕钻研后反而稳固深厚。',
    en: 'Natal Hua Ji (Karmic Focus) concentrates intensity and perfectionism—demanding early resilience, yet maturing into deep mastery.',
  },
};

function normalizeBranch(branch: number): number {
  return ((Math.trunc(branch) % 12) + 12) % 12;
}

export function resolveLifePalaceBrightnessBand(
  star: Pick<Star, 'brightness' | 'brightnessRaw'>,
): BrightnessBand {
  if (star.brightnessRaw) {
    if (BRIGHT_RAW_SET.has(star.brightnessRaw)) return 'bright';
    if (DIM_RAW_SET.has(star.brightnessRaw)) return 'dim';
    return 'normal';
  }
  if (star.brightness === 'bright' || star.brightness === 'normal' || star.brightness === 'dim') {
    return star.brightness;
  }
  return 'normal';
}

export function resolveDualStarComboKey(
  starNames: readonly string[],
): DualStarComboKey | undefined {
  if (starNames.length < 2) return undefined;
  return DUAL_COMBO_BY_PAIR.get(`${starNames[0]}+${starNames[1]}`);
}

function resolveEffectiveMingStars(chart: ZiweiChart): {
  mingPalace: Palace | undefined;
  mingBranch: number;
  isEmpty: boolean;
  borrowedFromName?: string;
  effectiveMajors: Array<{ star: Star; borrowed: boolean }>;
} {
  const mingBranch = normalizeBranch(chart.mingGongBranch);
  const mingPalace =
    chart.palaces.find((p) => normalizeBranch(p.branch) === mingBranch)
    ?? chart.palaces.find((p) => p.isMingGong || p.name === '命宫')
    ?? chart.palaces[0];

  if (!mingPalace) {
    return {
      mingPalace: undefined,
      mingBranch,
      isEmpty: true,
      effectiveMajors: [],
    };
  }

  const directMajors = mingPalace.stars.filter((s) => s.type === 'major');
  const isEmpty = mingPalace.isEmpty ?? directMajors.length === 0;

  if (!isEmpty && directMajors.length > 0) {
    return {
      mingPalace,
      mingBranch: normalizeBranch(mingPalace.branch),
      isEmpty: false,
      effectiveMajors: directMajors.map((star) => ({ star, borrowed: false })),
    };
  }

  const oppBranch = normalizeBranch(
    mingPalace.borrowedFromBranch ?? mingPalace.oppositeBranch ?? mingPalace.branch + 6,
  );
  const oppPalace = chart.palaces.find((p) => normalizeBranch(p.branch) === oppBranch);
  const oppMajors = oppPalace ? oppPalace.stars.filter((s) => s.type === 'major') : [];
  const borrowedFromName = mingPalace.borrowedFromName ?? oppPalace?.name ?? '迁移';

  if (oppMajors.length > 0) {
    return {
      mingPalace,
      mingBranch: normalizeBranch(mingPalace.branch),
      isEmpty: true,
      borrowedFromName,
      effectiveMajors: oppMajors.map((star) => ({ star, borrowed: true })),
    };
  }

  const fallbackBorrowedNames = mingPalace.borrowedStars ?? [];
  return {
    mingPalace,
    mingBranch: normalizeBranch(mingPalace.branch),
    isEmpty: true,
    borrowedFromName,
    effectiveMajors: fallbackBorrowedNames.map((name) => ({
      star: { name, type: 'major' as const },
      borrowed: true,
    })),
  };
}

function formatStarInfo(
  item: { star: Star; borrowed: boolean },
  lang: SupportedLang,
): FreeLifePalaceStarInfo {
  const band = resolveLifePalaceBrightnessBand(item.star);
  const brightnessLabel = item.star.brightnessRaw
    ? translateBrightness(item.star.brightnessRaw, lang)
    : undefined;
  const siHuaLabel = item.star.siHua ? translateSiHua(item.star.siHua, lang) : undefined;

  return {
    name: item.star.name,
    label: translateStar(item.star.name, lang),
    brightness: band,
    ...(item.star.brightnessRaw ? { brightnessRaw: item.star.brightnessRaw } : {}),
    ...(brightnessLabel ? { brightnessLabel } : {}),
    ...(item.star.siHua ? { siHua: item.star.siHua } : {}),
    ...(siHuaLabel ? { siHuaLabel } : {}),
    borrowed: item.borrowed,
  };
}

function formatStarSummaryLine(
  stars: readonly FreeLifePalaceStarInfo[],
  branchName: string,
  palaceName: string,
  isEmpty: boolean,
  borrowedFromPalace: string | undefined,
  lang: SupportedLang,
): string {
  const starTokens = stars.map((s) => {
    const parts: string[] = [];
    if (s.brightnessLabel) parts.push(s.brightnessLabel);
    if (s.siHuaLabel) parts.push(s.siHuaLabel);
    return parts.length > 0 ? `${s.label} (${parts.join(' · ')})` : s.label;
  });

  if (isEmpty) {
    const borrowedText = starTokens.length > 0 ? starTokens.join(' + ') : '—';
    const opp = borrowedFromPalace ?? translatePalace('迁移', lang);
    if (lang === 'ru') {
      return `${palaceName} [${branchName}]: Пустой дворец (Кун-гун), заимствование из ${opp} → ${borrowedText}`;
    }
    if (lang === 'en') {
      return `${palaceName} [${branchName}]: Empty Palace (borrowed from ${opp}) → ${borrowedText}`;
    }
    return `${palaceName}（${branchName}宫）：空宫借星（借对宫${opp}）→ ${borrowedText}`;
  }

  const joined = starTokens.join(' + ');
  if (lang === 'ru') {
    return `${palaceName} [${branchName}]: ${joined}`;
  }
  if (lang === 'en') {
    return `${palaceName} [${branchName}]: ${joined}`;
  }
  return `${palaceName}（${branchName}宫）：${joined}`;
}

function buildBorrowedDynamicPrefix(
  borrowedFromPalace: string,
  lang: SupportedLang,
): string {
  if (lang === 'ru') {
    return `Ваш Дворец Жизни (Мин-гун) не содержит собственных главных звезд — это «Пустой дворец» (Кун-гун), который заимствует главные звезды из противоположного дворца (${borrowedFromPalace}). Такая структура дает высокую внешнюю гибкость: вы быстро считываете среду и раскрываетесь ярче через поездки, новую аудиторию и смену обстановки. Внутренний характер выражается через заимствованную связку: `;
  }
  if (lang === 'en') {
    return `Your Life Palace (Ming Gong) contains no direct major stars—an Empty Palace (Kong Gong) that borrows its governing stars from the opposite ${borrowedFromPalace}. This dynamic makes you highly adaptive to your environment, often shining brightest through travel, cross-cultural exchanges, and external momentum. Your core temperament expresses through these borrowed stars: `;
  }
  return `你的命宫本宫无主星，属于「空宫借星」结构，需借对宫（${borrowedFromPalace}）主星为用。空宫命格通常可塑性强、善于顺应外部环境，往往越走出去历练、接触更广阔的平台，内在潜能越容易被激活。借星后的核心性情呈现如下：`;
}

function buildBrightnessParagraph(
  effectiveMajors: ReadonlyArray<{ star: Star; borrowed: boolean }>,
  lang: SupportedLang,
): string {
  const parts: string[] = [];
  for (const { star } of effectiveMajors) {
    if (!MAJOR_STAR_SET.has(star.name)) continue;
    const profile = LIFE_PALACE_STAR_PROFILES[star.name as MajorStarName];
    const band = resolveLifePalaceBrightnessBand(star);
    parts.push(profile.brightnessNuances[band][lang]);
  }
  if (parts.length > 0) {
    return parts.join(' ');
  }
  if (lang === 'ru') {
    return 'Влияние внешних условий на проявление Дворца Жизни сбалансировано и постепенно раскрывается через личный опыт.';
  }
  if (lang === 'en') {
    return 'Palace dignity stays balanced overall, expressing steadily through real-world experience and deliberate practice.';
  }
  return '命宫星曜整体亮度平衡，特质随人生阶段与实际历练逐步显现。';
}

function buildSiHuaNote(
  mingPalace: Palace | undefined,
  effectiveMajors: ReadonlyArray<{ star: Star; borrowed: boolean }>,
  lang: SupportedLang,
): string | undefined {
  const notes: string[] = [];
  const seen = new Set<string>();

  for (const { star, borrowed } of effectiveMajors) {
    if (!star.siHua) continue;
    const key = `${star.name}:${star.siHua}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const starLabel = translateStar(star.name, lang);
    const shLabel = translateSiHua(star.siHua, lang);
    const meaning = SIHUA_GENERAL_NUANCE[star.siHua][lang];
    if (lang === 'ru') {
      const origin = borrowed ? ' (активируется через заимствование из Дворца Перемещений)' : '';
      notes.push(`Натальная трансформация ${starLabel} → ${shLabel}${origin}: ${meaning}`);
    } else if (lang === 'en') {
      const origin = borrowed ? ' (channeled via the opposite Migration Palace)' : '';
      notes.push(`Natal ${starLabel} with ${shLabel}${origin}: ${meaning}`);
    } else {
      const origin = borrowed ? '（由迁移宫借星带入）' : '';
      notes.push(`${starLabel}${shLabel}${origin}：${meaning}`);
    }
  }

  if (mingPalace) {
    for (const star of mingPalace.stars) {
      if (star.type === 'major' || !star.siHua) continue;
      const key = `${star.name}:${star.siHua}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const starLabel = translateStar(star.name, lang);
      const shLabel = translateSiHua(star.siHua, lang);
      const meaning = SIHUA_GENERAL_NUANCE[star.siHua][lang];
      if (lang === 'ru') {
        notes.push(`Вспомогательная звезда ${starLabel} в Дворце Жизни несет ${shLabel}: ${meaning}`);
      } else if (lang === 'en') {
        notes.push(`Auxiliary star ${starLabel} in the Life Palace carries ${shLabel}: ${meaning}`);
      } else {
        notes.push(`命宫辅曜${starLabel}${shLabel}：${meaning}`);
      }
    }
  }

  if (notes.length > 0) {
    return notes.join(' ');
  }
  return undefined;
}

function buildDefaultNoSiHuaNote(lang: SupportedLang): string {
  if (lang === 'ru') {
    return 'Натальные Четыре Трансформации (Сы-Хуа) напрямую не окрашивают Дворец Жизни, поэтому ключевые финансовые и эмоциональные триггеры включаются через смежные дворцы карты.';
  }
  if (lang === 'en') {
    return 'Since none of the Four Natal Transformations land directly in the Life Palace, your key wealth, power, and tension catalysts activate through surrounding palaces.';
  }
  return '生年四化未直接落入命宫，意味着你的关键动能、财官助力与压力课题主要通过其他关联宫位触发。';
}

// ────────────────── Main Deterministic Generator ──────────────────

export function generateFreeLifePalaceReading(
  chart: ZiweiChart,
  rawLang: SupportedLang = 'ru',
): FreeLifePalaceReading {
  const lang = normalizeLang(rawLang, 'ru');
  const resolved = resolveEffectiveMingStars(chart);
  const rawBranch = BRANCHES[resolved.mingBranch] ?? '子';
  const branchName = translateBranch(rawBranch, lang);
  const palaceName = translatePalace('命宫', lang);
  const borrowedFromPalace = resolved.isEmpty
    ? translatePalace(resolved.borrowedFromName ?? '迁移', lang)
    : undefined;

  const stars = resolved.effectiveMajors.map((item) => formatStarInfo(item, lang));
  const starNames = stars.map((s) => s.name);
  const comboKey = resolveDualStarComboKey(starNames);

  const starSummary = formatStarSummaryLine(
    stars,
    branchName,
    palaceName,
    resolved.isEmpty,
    borrowedFromPalace,
    lang,
  );

  const brightnessNote = buildBrightnessParagraph(resolved.effectiveMajors, lang);
  const siHuaNote = buildSiHuaNote(resolved.mingPalace, resolved.effectiveMajors, lang);
  const paragraphTwo = siHuaNote ? `${brightnessNote} ${siHuaNote}` : `${brightnessNote} ${buildDefaultNoSiHuaNote(lang)}`;

  let archetypeTitle: string;
  let coreBody: string;
  let paragraphThree: string;
  let keywords: string[];

  if (comboKey) {
    const dual = LIFE_PALACE_DUAL_PROFILES[comboKey];
    archetypeTitle = dual.archetypeTitle[lang];
    coreBody = dual.coreTemperament[lang];
    paragraphThree = dual.lifeOrientation[lang];
    keywords = [...dual.keywords[lang]];
  } else if (starNames.length >= 1 && MAJOR_STAR_SET.has(starNames[0])) {
    const single = LIFE_PALACE_STAR_PROFILES[starNames[0] as MajorStarName];
    archetypeTitle = single.archetypeTitle[lang];
    coreBody = single.coreTemperament[lang];
    paragraphThree = single.lifeOrientation[lang];
    keywords = [...single.keywords[lang]];
  } else {
    // Defensive fallback if both Ming and opposite palace lack major stars in a synthetic test chart
    archetypeTitle =
      lang === 'ru'
        ? 'Адаптивный Дворец Жизни (Кун-гун)'
        : lang === 'en'
          ? 'Adaptive Empty Life Palace'
          : '空宫借曜 · 灵动自适应格';
    coreBody =
      lang === 'ru'
        ? 'Отсутствие фиксированных главных звезд делает характер открытым к обучению и гибкой смене ролей.'
        : lang === 'en'
          ? 'With no fixed major stars anchoring the Life Palace, adaptability and environmental awareness guide your evolution.'
          : '命宫暂无固定主星坐守，性情弹性高，善于顺应局势变化与外部平台调整自我定位。';
    paragraphThree =
      lang === 'ru'
        ? 'Выбирайте сильное профессиональное окружение и ясные ориентиры — среда усиливает ваш природный потенциал.'
        : lang === 'en'
          ? 'Choosing strong peers and structured environments gives your flexible temperament clear direction.'
          : '择良师益友与稳定平台同行，能更快沉淀核心竞争力。';
    keywords =
      lang === 'ru'
        ? ['Гибкость', 'Адаптация', 'Открытость', 'Среда']
        : lang === 'en'
          ? ['Adaptability', 'Versatility', 'Openness', 'Environment']
          : ['灵活', '借势', '可塑性', '应变'];
  }

  if (resolved.isEmpty && borrowedFromPalace) {
    const borrowedTag =
      lang === 'ru'
        ? 'Заимствование из Цяньи-гун'
        : lang === 'en'
          ? 'Borrowed Palace'
          : '空宫借星';
    if (!keywords.includes(borrowedTag)) {
      keywords = [...keywords.slice(0, 3), borrowedTag];
    }
    if (lang === 'ru') {
      archetypeTitle = `${archetypeTitle} · Пустой дворец`;
    } else if (lang === 'en') {
      archetypeTitle = `${archetypeTitle} · Empty Palace`;
    } else {
      archetypeTitle = `${archetypeTitle}（空宫借星）`;
    }
  }

  const paragraphOne = resolved.isEmpty && borrowedFromPalace
    ? `${buildBorrowedDynamicPrefix(borrowedFromPalace, lang)}${coreBody}`
    : coreBody;

  const paragraphs = [paragraphOne, paragraphTwo, paragraphThree];

  return {
    lang,
    palaceName,
    branchName,
    isEmpty: resolved.isEmpty,
    ...(borrowedFromPalace ? { borrowedFromPalace } : {}),
    stars,
    ...(comboKey ? { comboKey } : {}),
    archetypeTitle,
    starSummary,
    paragraphs,
    reading: paragraphs.join('\n\n'),
    keywords,
    brightnessNote,
    ...(siHuaNote ? { siHuaNote } : {}),
  };
}
