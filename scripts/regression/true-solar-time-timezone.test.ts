/**
 * 回归：share.ts 与 true-solar-time.ts 对齐 + 海外城市时区参数化（utcOffsetMinutes）。
 *
 * 锁住四个核心契约：
 *   1. `formToBirthInfo` 与 `calcTrueSolarBranch` 统一走 `calculateTrueSolarTime` + `resolveZiweiDayOffset`，
 *      不再按死钟点 23:xx 盲目进位，而是按真太阳时的跨日偏移与晚子时（23:00–23:59）决定排盘日。
 *   2. 西部经度（如乌鲁木齐 87.6°E，UTC+8）：
 *      - 北京时间 23:30 对应当地真太阳时约 21:17（亥时，branch=11），仍在当日，不进次日，也不显示晚子时换日提示；
 *      - 北京时间 00:30 对应当地真太阳时前一日约 22:07（亥时，branch=11，dayOffset=-1），排盘日退回前一日；
 *      - 北京时间次日 01:30 对应当地真太阳时前一日约 23:17（晚子时，branch=0，dayOffset=-1），按晚子时进一日后归回当日（offset=0）。
 *   3. 东部经度（如哈尔滨 126.5°E / 抚远 134.3°E，UTC+8）：
 *      - 哈尔滨 22:45 钟点未到 23 点，但真太阳时已过 23:00（晚子时，branch=0），排盘日进到次日并显示晚子时说明；
 *      - 抚远 23:20 真太阳时已过次日 00:00（早子时，branch=0，dayOffset=+1），排盘日同样进到次日。
 *   4. 海外时区参数化（`utcOffsetMinutes`，标准经线 = `utcOffsetMinutes / 4`）：
 *      - 莫斯科（37.6°E，UTC+3 = 180 分钟，标准经线 45°E）：经度修正为 `(37.6 - 45) * 4 = -29.6` 分钟，
 *        绝不按东八区 120°E 误扣 329.6 分钟；
 *      - 圣彼得堡（30.3°E，UTC+3 = 180 分钟）、符拉迪沃斯托克（131.9°E，UTC+10 = 600 分钟）、
 *        东京（139.7°E，UTC+9 = 540 分钟）、伦敦（-0.1°E，UTC+0 = 0 分钟）、纽约（-74.0°E，UTC-5 = -300 分钟）
 *        各自按本时区标准经线校正，并通过分享链接 `tz` 参数无损往返。
 *
 * 跑: npx tsx scripts/regression/true-solar-time-timezone.test.ts
 */
import assert from 'node:assert/strict';
import type { BirthFormState } from '../../components/BirthForm';
import { generateChart } from '../../lib/ziwei/algorithm';
import { findCityInfo, PROVINCES } from '../../lib/ziwei/cities';
import {
  calcTrueSolarBranch,
  chinaDstNoteForForm,
  formToBirthInfo,
  formToSearchParams,
  isLateZiNextDay,
  lateZiNoteForChart,
  parseShareLongitudeParam,
  parseShareTzParam,
  resolveFormTrueSolarTime,
  resolveFormUtcOffsetMinutes,
  searchParamsToForm,
} from '../../lib/ziwei/share';
import {
  calculateTrueSolarTime,
  DEFAULT_UTC_OFFSET_MINUTES,
  formatUtcOffsetLabel,
  resolveTimeZoneOffsetMinutes,
  resolveZiweiDayOffset,
  standardMeridianDegrees,
} from '../../lib/ziwei/true-solar-time';

function makeForm(overrides: Partial<BirthFormState>): BirthFormState {
  return {
    name: '',
    year: '1990',
    month: '12',
    day: '31',
    clockHour: '12',
    clockMinute: '0',
    unknownTime: false,
    province: '',
    city: '',
    longitude: 120,
    gender: 'male',
    ...overrides,
  };
}

// ── 1. 标准经线与时区标签 ──────────────────────────────────────────
assert.equal(DEFAULT_UTC_OFFSET_MINUTES, 480);
assert.equal(standardMeridianDegrees(480), 120);
assert.equal(standardMeridianDegrees(180), 45);     // 莫斯科 UTC+3
assert.equal(standardMeridianDegrees(600), 150);    // 符拉迪沃斯托克 / 悉尼 UTC+10
assert.equal(standardMeridianDegrees(540), 135);    // 东京 / 首尔 UTC+9
assert.equal(standardMeridianDegrees(330), 82.5);   // 印度 UTC+5:30
assert.equal(standardMeridianDegrees(0), 0);        // 伦敦 UTC+0
assert.equal(standardMeridianDegrees(-300), -75);   // 纽约 UTC-5
assert.equal(standardMeridianDegrees(-480), -120);  // 洛杉矶 UTC-8

assert.equal(formatUtcOffsetLabel(480), 'UTC+8');
assert.equal(formatUtcOffsetLabel(180), 'UTC+3');
assert.equal(formatUtcOffsetLabel(330), 'UTC+5:30');
assert.equal(formatUtcOffsetLabel(0), 'UTC+0');
assert.equal(formatUtcOffsetLabel(-300), 'UTC-5');

// ── 2. 西部经度（乌鲁木齐 87.6°E，UTC+8）跨日与晚子时同步 ──────────
{
  // (a) 1990-12-31 23:30 北京时间 → 乌鲁木齐真太阳时约 21:17（亥时，当日）
  const urumqi2330 = makeForm({
    year: '1990',
    month: '12',
    day: '31',
    clockHour: '23',
    clockMinute: '30',
    province: '新疆维吾尔自治区',
    city: '乌鲁木齐',
    longitude: 87.6,
  });
  const solar2330 = resolveFormTrueSolarTime(urumqi2330);
  assert.equal(solar2330.dayOffset, 0);
  assert.equal(solar2330.branch, 11, 'Urumqi 23:30 Beijing time is hai hour (11)');
  assert.equal(resolveZiweiDayOffset(solar2330, 'next-day'), 0);

  const info2330 = formToBirthInfo(urumqi2330);
  assert.deepEqual(
    { year: info2330.year, month: info2330.month, day: info2330.day, hour: info2330.hour },
    { year: 1990, month: 12, day: 31, hour: 11 },
    'Urumqi 23:30 must stay on 1990-12-31 in hai hour',
  );
  assert.equal(isLateZiNextDay(info2330), false);
  assert.equal(lateZiNoteForChart(info2330, 'zh'), '');

  // (b) 1990-01-31 00:30 北京时间 → 乌鲁木齐真太阳时退回前一日 1990-01-30 约 22:07（亥时）
  const urumqi0030 = makeForm({
    year: '1990',
    month: '1',
    day: '31',
    clockHour: '0',
    clockMinute: '30',
    province: '新疆维吾尔自治区',
    city: '乌鲁木齐',
    longitude: 87.6,
  });
  const solar0030 = resolveFormTrueSolarTime(urumqi0030);
  assert.equal(solar0030.dayOffset, -1);
  assert.equal(solar0030.branch, 11);
  const info0030 = formToBirthInfo(urumqi0030);
  assert.deepEqual(
    { year: info0030.year, month: info0030.month, day: info0030.day, hour: info0030.hour },
    { year: 1990, month: 1, day: 30, hour: 11 },
    'Urumqi 00:30 Beijing time rolls back to 1990-01-30 hai hour',
  );
  assert.equal(isLateZiNextDay(info0030), false);

  // (c) 1990-02-01 01:30 北京时间 → 乌鲁木齐真太阳时为前一日 23:07（晚子时，dayOffset=-1），
  //     晚子时按次日排盘（-1 + 1 = 0），最终排盘日仍为 1990-02-01 子时（branch=0）。
  const urumqi0130 = makeForm({
    year: '1990',
    month: '2',
    day: '1',
    clockHour: '1',
    clockMinute: '30',
    province: '新疆维吾尔自治区',
    city: '乌鲁木齐',
    longitude: 87.6,
  });
  const solar0130 = resolveFormTrueSolarTime(urumqi0130);
  assert.equal(solar0130.dayOffset, -1);
  assert.equal(solar0130.branch, 0);
  assert.ok(solar0130.normalizedMinutes >= 1380);
  assert.equal(resolveZiweiDayOffset(solar0130, 'next-day'), 0);
  assert.equal(resolveZiweiDayOffset(solar0130, 'current-day'), -1);
  const info0130 = formToBirthInfo(urumqi0130);
  assert.deepEqual(
    { year: info0130.year, month: info0130.month, day: info0130.day, hour: info0130.hour },
    { year: 1990, month: 2, day: 1, hour: 0 },
  );
}

// ── 3. 东部经度（哈尔滨 126.5°E / 抚远 134.3°E）真太阳晚子时进位 ────
{
  // (a) 哈尔滨 1990-12-31 22:45 北京时间 → 真太阳时约 23:08（晚子时），进位至 1991-01-01 子时
  const harbin2245 = makeForm({
    year: '1990',
    month: '12',
    day: '31',
    clockHour: '22',
    clockMinute: '45',
    province: '黑龙江省',
    city: '哈尔滨',
    longitude: 126.5,
  });
  const solarHarbin = resolveFormTrueSolarTime(harbin2245);
  assert.equal(solarHarbin.dayOffset, 0);
  assert.equal(solarHarbin.branch, 0);
  assert.ok(solarHarbin.normalizedMinutes >= 1380);
  const infoHarbin = formToBirthInfo(harbin2245);
  assert.deepEqual(
    { year: infoHarbin.year, month: infoHarbin.month, day: infoHarbin.day, hour: infoHarbin.hour },
    { year: 1991, month: 1, day: 1, hour: 0 },
    'Harbin 22:45 Beijing time enters true-solar Late Zi and advances to 1991-01-01',
  );
  assert.equal(isLateZiNextDay(infoHarbin), true);
  assert.equal(
    lateZiNoteForChart(infoHarbin, 'zh'),
    '晚子时：按次日排盘（输入 1990-12-31 22:45）',
  );

  // (b) 哈尔滨 1990-01-01 23:50 北京时间 → 真太阳时已过午夜进入 1990-01-02 00:12（早子时，dayOffset=+1），
  //     排盘日为次日但时辰属于「早子时」，绝不能误标为「晚子时：按次日排盘」。
  const harbin2350 = makeForm({
    year: '1990',
    month: '1',
    day: '1',
    clockHour: '23',
    clockMinute: '50',
    province: '黑龙江省',
    city: '哈尔滨',
    longitude: 126.5,
  });
  const solarHarbin2350 = resolveFormTrueSolarTime(harbin2350);
  assert.equal(solarHarbin2350.dayOffset, 1);
  assert.equal(solarHarbin2350.branch, 0);
  assert.ok(solarHarbin2350.normalizedMinutes < 60, 'Harbin 1990-01-01 23:50 is early Zi on 1990-01-02');
  const infoHarbin2350 = formToBirthInfo(harbin2350);
  assert.deepEqual(
    { year: infoHarbin2350.year, month: infoHarbin2350.month, day: infoHarbin2350.day, hour: infoHarbin2350.hour },
    { year: 1990, month: 1, day: 2, hour: 0 },
  );
  assert.equal(isLateZiNextDay(infoHarbin2350), false, 'early Zi after solar midnight must not trigger Late Zi note');
  assert.equal(lateZiNoteForChart(infoHarbin2350, 'zh'), '');
  assert.equal(lateZiNoteForChart(infoHarbin2350, 'ru'), '');

  // (c) 哈尔滨 1990-01-01 23:10 北京时间 → 真太阳时约 23:32（仍处于 1990-01-01 晚子时），必须显示晚子时说明。
  const harbin2310 = makeForm({
    year: '1990',
    month: '1',
    day: '1',
    clockHour: '23',
    clockMinute: '10',
    province: '黑龙江省',
    city: '哈尔滨',
    longitude: 126.5,
  });
  const infoHarbin2310 = formToBirthInfo(harbin2310);
  assert.equal(isLateZiNextDay(infoHarbin2310), true);
  assert.equal(lateZiNoteForChart(infoHarbin2310, 'zh'), '晚子时：按次日排盘（输入 1990-01-01 23:10）');

  // (d) 抚远（134.3°E，+57.2 分钟）1990-12-31 23:20 → 真太阳时已跨过午夜进入 1991-01-01 早子时（dayOffset=+1）
  const fuyuan2320 = makeForm({
    year: '1990',
    month: '12',
    day: '31',
    clockHour: '23',
    clockMinute: '20',
    province: '黑龙江省',
    city: '抚远（中国最东）',
    longitude: 134.3,
  });
  const solarFuyuan = resolveFormTrueSolarTime(fuyuan2320);
  assert.equal(solarFuyuan.dayOffset, 1);
  assert.equal(solarFuyuan.branch, 0);
  const infoFuyuan = formToBirthInfo(fuyuan2320);
  assert.deepEqual(
    { year: infoFuyuan.year, month: infoFuyuan.month, day: infoFuyuan.day, hour: infoFuyuan.hour },
    { year: 1991, month: 1, day: 1, hour: 0 },
  );
  assert.equal(isLateZiNextDay(infoFuyuan), false);
  assert.equal(lateZiNoteForChart(infoFuyuan, 'zh'), '');
}

// ── 4. 海外城市 IANA 时区与历史夏令时（莫斯科、纽约、伦敦、巴黎、柏林、悉尼、新德里） ──
{
  const overseasProv = PROVINCES.find((p) => p.name === '海外 / 国际');
  assert.ok(overseasProv, 'PROVINCES must include 海外 / 国际');

  const moscowCity = findCityInfo('海外 / 国际', '莫斯科');
  assert.ok(moscowCity);
  assert.equal(moscowCity.longitude, 37.6);
  assert.equal(moscowCity.utcOffsetMinutes, 180);
  assert.equal(moscowCity.timeZone, 'Europe/Moscow');

  // (a) 莫斯科 1990-06-15 14:00（苏联夏季时 UTC+4 = 240 分钟，标准经线 60°E，修正 -89.6 分钟 → ~12:30 午时）
  const moscowSummerCalc = calculateTrueSolarTime({
    year: 1990,
    month: 6,
    day: 15,
    clockHour: 14,
    clockMinute: 0,
    longitude: moscowCity.longitude,
    timeZone: moscowCity.timeZone,
  });
  assert.equal(moscowSummerCalc.utcOffsetMinutes, 240);
  assert.equal(moscowSummerCalc.standardMeridian, 60);
  assert.ok(Math.abs(moscowSummerCalc.longitudeCorrectionMinutes - (-89.6)) < 1e-9);
  assert.equal(moscowSummerCalc.hour, 12);
  assert.equal(moscowSummerCalc.branch, 6, 'Moscow 1990-06-15 14:00 DST is ~12:30 true solar time (Wu hour, branch=6)');

  // (b) 莫斯科 2011–2014 永久夏令时（2012-02-15 冬季也是 UTC+4 = 240 分钟）与 2014 后恢复 UTC+3
  assert.equal(resolveTimeZoneOffsetMinutes('Europe/Moscow', 2012, 2, 15, 12, 0), 240);
  assert.equal(resolveTimeZoneOffsetMinutes('Europe/Moscow', 2012, 7, 15, 12, 0), 240);
  assert.equal(resolveTimeZoneOffsetMinutes('Europe/Moscow', 2020, 2, 15, 12, 0), 180);

  const moscowSummerForm = makeForm({
    year: '1990',
    month: '6',
    day: '15',
    clockHour: '14',
    clockMinute: '0',
    province: '海外 / 国际',
    city: '莫斯科',
    longitude: moscowCity.longitude,
  });
  assert.equal(resolveFormUtcOffsetMinutes(moscowSummerForm), 240);
  const moscowSummerInfo = formToBirthInfo(moscowSummerForm);
  assert.equal(moscowSummerInfo.utcOffsetMinutes, 240);
  assert.equal(moscowSummerInfo.timeZone, 'Europe/Moscow');
  assert.equal(moscowSummerInfo.hour, 6);
  const moscowChart = generateChart(moscowSummerInfo);
  assert.equal(moscowChart.birthInfo.hour, 6);

  // (c) 莫斯科冬季 1990-12-31 23:45（UTC+3 = 180 分钟）→ 真太阳时约 23:12（晚子时），按次日排盘 → 1991-01-01 子时
  const moscowLateZi = makeForm({
    year: '1990',
    month: '12',
    day: '31',
    clockHour: '23',
    clockMinute: '45',
    province: '海外 / 国际',
    city: '莫斯科',
    longitude: moscowCity.longitude,
  });
  assert.equal(resolveFormUtcOffsetMinutes(moscowLateZi), 180);
  const moscowLateZiInfo = formToBirthInfo(moscowLateZi);
  assert.deepEqual(
    { year: moscowLateZiInfo.year, month: moscowLateZiInfo.month, day: moscowLateZiInfo.day, hour: moscowLateZiInfo.hour },
    { year: 1991, month: 1, day: 1, hour: 0 },
  );
  assert.equal(
    lateZiNoteForChart(moscowLateZiInfo, 'ru'),
    'Поздний час Цзы: карта считается по следующему дню (ввод 1990-12-31 23:45)',
  );

  // (d) 纽约 2024-07-01 01:30（EDT UTC-4 = -240 分钟，标准经线 -60°W，经度修正 -56 分钟）→ ~00:30 子时 (branch=0)，绝非丑时 (branch=1)
  const nyCity = findCityInfo('海外 / 国际', '纽约');
  assert.ok(nyCity);
  const nySummerForm = makeForm({
    year: '2024',
    month: '7',
    day: '1',
    clockHour: '1',
    clockMinute: '30',
    province: '海外 / 国际',
    city: '纽约',
    longitude: nyCity.longitude,
  });
  assert.equal(resolveFormUtcOffsetMinutes(nySummerForm), -240);
  const nySummerSolar = resolveFormTrueSolarTime(nySummerForm);
  assert.equal(nySummerSolar.utcOffsetMinutes, -240);
  assert.equal(nySummerSolar.dayOffset, 0);
  assert.equal(nySummerSolar.hour, 0);
  assert.equal(nySummerSolar.branch, 0, 'New York 2024-07-01 01:30 EDT must be Zi hour (branch=0), not Chou');
  const nySummerInfo = formToBirthInfo(nySummerForm);
  assert.equal(nySummerInfo.hour, 0);
  assert.equal(nySummerInfo.day, 1);

  // 纽约冬季 2024-01-15 01:30（EST UTC-5 = -300 分钟）
  const nyWinterForm = makeForm({
    year: '2024',
    month: '1',
    day: '15',
    clockHour: '1',
    clockMinute: '30',
    province: '海外 / 国际',
    city: '纽约',
    longitude: nyCity.longitude,
  });
  assert.equal(resolveFormUtcOffsetMinutes(nyWinterForm), -300);

  // (e) 伦敦 / 巴黎 / 柏林 / 悉尼 夏冬令时自动切换
  assert.equal(resolveTimeZoneOffsetMinutes('Europe/London', 2024, 7, 1, 12, 0), 60);
  assert.equal(resolveTimeZoneOffsetMinutes('Europe/London', 2024, 1, 15, 12, 0), 0);
  assert.equal(resolveTimeZoneOffsetMinutes('Europe/Paris', 2024, 7, 1, 12, 0), 120);
  assert.equal(resolveTimeZoneOffsetMinutes('Europe/Berlin', 2024, 7, 1, 12, 0), 120);
  assert.equal(resolveTimeZoneOffsetMinutes('Australia/Sydney', 2024, 1, 15, 12, 0), 660); // 南半球夏季 AEDT
  assert.equal(resolveTimeZoneOffsetMinutes('Australia/Sydney', 2024, 7, 1, 12, 0), 600);  // 南半球冬季 AEST

  // (f) 圣彼得堡（30.3°E）冬季 1990-12-31 23:30 → 亥时 (当日)
  const spbCity = findCityInfo('海外 / 国际', '圣彼得堡');
  assert.ok(spbCity);
  const spb2330 = makeForm({
    year: '1990',
    month: '12',
    day: '31',
    clockHour: '23',
    clockMinute: '30',
    province: '海外 / 国际',
    city: '圣彼得堡',
    longitude: spbCity.longitude,
  });
  const spbInfo = formToBirthInfo(spb2330);
  assert.deepEqual(
    { year: spbInfo.year, month: spbInfo.month, day: spbInfo.day, hour: spbInfo.hour },
    { year: 1990, month: 12, day: 31, hour: 11 },
    'Saint Petersburg 23:30 local time is ~22:28 true solar time (hai hour on the same day)',
  );
  assert.equal(isLateZiNextDay(spbInfo), false);

  // (g) 半小时时区支持：新德里（UTC+5:30 = 330 分钟，标准经线 82.5°E）及无城市手动选择 UTC+5:30
  const delhiCity = findCityInfo('海外 / 国际', '新德里');
  assert.ok(delhiCity);
  assert.equal(delhiCity.utcOffsetMinutes, 330);
  const indiaManualForm = makeForm({
    year: '1995',
    month: '5',
    day: '10',
    clockHour: '12',
    clockMinute: '0',
    province: '',
    city: '',
    longitude: 77.2,
    utcOffsetMinutes: 330,
    timeZone: '',
  });
  const indiaSolar = resolveFormTrueSolarTime(indiaManualForm);
  assert.equal(indiaSolar.utcOffsetMinutes, 330);
  assert.equal(indiaSolar.standardMeridian, 82.5);
  assert.ok(Math.abs(indiaSolar.longitudeCorrectionMinutes - ((77.2 - 82.5) * 4)) < 1e-9);

  // (h) 分享链接 URL 参数往返与校验（`tz` / `lo`）
  const moscowParams = formToSearchParams(moscowLateZi);
  assert.equal(moscowParams.get('tz'), '180');
  assert.equal(moscowParams.get('lo'), '37.6');
  const moscowRestored = searchParamsToForm(moscowParams);
  assert.ok(moscowRestored);
  assert.equal(moscowRestored.utcOffsetMinutes, 180);
  assert.equal(moscowRestored.longitude, 37.6);
  assert.deepEqual(
    formToBirthInfo({ ...moscowLateZi, ...moscowRestored }),
    moscowLateZiInfo,
  );

  // 非法 tz / lo 参数必须被拒绝
  assert.equal(parseShareTzParam('99999'), undefined);
  assert.equal(parseShareTzParam('-1000'), undefined);
  assert.equal(parseShareTzParam('180.5'), undefined);
  assert.equal(parseShareTzParam('abc'), undefined);
  assert.equal(parseShareTzParam('330'), 330);
  assert.equal(parseShareLongitudeParam('181'), undefined);
  assert.equal(parseShareLongitudeParam('-181'), undefined);
  assert.equal(parseShareLongitudeParam('abc'), undefined);
  assert.equal(parseShareLongitudeParam('-74.0'), -74.0);

  const tamperedParams = new URLSearchParams('y=2024&m=7&d=1&h=1&mi=30&p=海外 / 国际&c=纽约&tz=99999&lo=999');
  const tamperedRestored = searchParamsToForm(tamperedParams);
  assert.ok(tamperedRestored);
  assert.equal(tamperedRestored.utcOffsetMinutes, -240, 'invalid tz falls back to dynamic city timezone');
  assert.equal(tamperedRestored.longitude, -74.0, 'invalid lo falls back to city longitude');

  // 仅通过 URL 参数传自定义海外坐标与半小时时区（不依赖省市名）也能精确还原
  const customIndiaParams = new URLSearchParams('y=1992&m=8&d=10&h=14&mi=20&lo=77.2&tz=330&g=f');
  const customRestored = searchParamsToForm(customIndiaParams);
  assert.ok(customRestored);
  assert.equal(customRestored.longitude, 77.2);
  assert.equal(customRestored.utcOffsetMinutes, 330);
  const customInfo = formToBirthInfo(makeForm(customRestored));
  assert.equal(customInfo.utcOffsetMinutes, 330);
  assert.equal(customInfo.hour, calcTrueSolarBranch(14, 20, 77.2, { year: 1992, month: 8, day: 10, utcOffsetMinutes: 330 }));
}

// ── 5. 中国大陆历史夏令时表单提示（1935–1991 年提示，不静默修改时间） ──
{
  const cnDstForm = makeForm({ year: '1990', month: '5', day: '15', clockHour: '8', clockMinute: '30', province: '北京市', city: '北京', longitude: 116.4 });
  assert.ok(chinaDstNoteForForm(cnDstForm, 'zh').includes('4 月 15 日–9 月 16 日'));
  assert.ok(chinaDstNoteForForm(cnDstForm, 'ru').includes('1990-05-15'));

  const cnNonDstForm = makeForm({ year: '1992', month: '5', day: '15', clockHour: '8', clockMinute: '30', province: '北京市', city: '北京', longitude: 116.4 });
  assert.equal(chinaDstNoteForForm(cnNonDstForm, 'zh'), '');

  const cnUnknownForm = makeForm({ year: '1990', month: '5', day: '15', unknownTime: true });
  assert.equal(chinaDstNoteForForm(cnUnknownForm, 'zh'), '');

  const overseasDstDate = makeForm({ year: '1990', month: '5', day: '15', province: '海外 / 国际', city: '莫斯科', longitude: 37.6 });
  assert.equal(chinaDstNoteForForm(overseasDstDate, 'zh'), '');
}

console.log('✅ true-solar-time & timezone parameterization regression passed');
