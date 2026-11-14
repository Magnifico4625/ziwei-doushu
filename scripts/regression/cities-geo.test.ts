/**
 * 回归：海外 / 国际城市目录扩展（俄罗斯全时区、独联体与全球主要城市）。
 *
 * 验证：
 *   1. 原有 23 座海外城市的名称、经度、标准冬令偏移与 IANA 时区完全保持不变；
 *   2. 新增俄罗斯全境 11 个标准时区、历史独立时区（萨马拉/伏尔加格勒）及独联体/全球枢纽均配置有效；
 *   3. 所有海外城市满足合法经度 [-180, 180]、合法整数 UTC 偏移与有效 IANA timeZone；
 *   4. `inferCityTimeZone(longitude, utcOffsetMinutes)` 在全表内零冲突且 100% 精确反查；
 *   5. 历史夏令时与时区改革抽检（萨马拉、伏尔加格勒、叶卡捷琳堡、加里宁格勒、奥克兰、迪拜、阿拉木图等）。
 *
 * 跑: npx tsx scripts/regression/cities-geo.test.ts
 */
import assert from 'node:assert/strict';
import { findCityInfo, inferCityTimeZone, PROVINCES, type CityInfo } from '../../lib/ziwei/cities';
import {
  calculateTrueSolarTime,
  isValidLongitude,
  isValidTimeZone,
  isValidUtcOffsetMinutes,
  resolveTimeZoneOffsetMinutes,
} from '../../lib/ziwei/true-solar-time';

interface ExpectedCitySpec {
  readonly name: string;
  readonly longitude: number;
  readonly utcOffsetMinutes: number;
  readonly timeZone: string;
}

const EXISTING_OVERSEAS_CITIES: readonly ExpectedCitySpec[] = [
  { name: '莫斯科', longitude: 37.6, utcOffsetMinutes: 180, timeZone: 'Europe/Moscow' },
  { name: '圣彼得堡', longitude: 30.3, utcOffsetMinutes: 180, timeZone: 'Europe/Moscow' },
  { name: '叶卡捷琳堡', longitude: 60.6, utcOffsetMinutes: 300, timeZone: 'Asia/Yekaterinburg' },
  { name: '新西伯利亚', longitude: 82.9, utcOffsetMinutes: 420, timeZone: 'Asia/Novosibirsk' },
  { name: '符拉迪沃斯托克', longitude: 131.9, utcOffsetMinutes: 600, timeZone: 'Asia/Vladivostok' },
  { name: '阿拉木图', longitude: 76.9, utcOffsetMinutes: 300, timeZone: 'Asia/Almaty' },
  { name: '明斯克', longitude: 27.6, utcOffsetMinutes: 180, timeZone: 'Europe/Minsk' },
  { name: '东京', longitude: 139.7, utcOffsetMinutes: 540, timeZone: 'Asia/Tokyo' },
  { name: '首尔', longitude: 127.0, utcOffsetMinutes: 540, timeZone: 'Asia/Seoul' },
  { name: '新加坡', longitude: 103.8, utcOffsetMinutes: 480, timeZone: 'Asia/Singapore' },
  { name: '吉隆坡', longitude: 101.7, utcOffsetMinutes: 480, timeZone: 'Asia/Kuala_Lumpur' },
  { name: '曼谷', longitude: 100.5, utcOffsetMinutes: 420, timeZone: 'Asia/Bangkok' },
  { name: '新德里', longitude: 77.2, utcOffsetMinutes: 330, timeZone: 'Asia/Kolkata' },
  { name: '孟买', longitude: 72.8, utcOffsetMinutes: 330, timeZone: 'Asia/Kolkata' },
  { name: '伦敦', longitude: -0.1, utcOffsetMinutes: 0, timeZone: 'Europe/London' },
  { name: '巴黎', longitude: 2.3, utcOffsetMinutes: 60, timeZone: 'Europe/Paris' },
  { name: '柏林', longitude: 13.4, utcOffsetMinutes: 60, timeZone: 'Europe/Berlin' },
  { name: '纽约', longitude: -74.0, utcOffsetMinutes: -300, timeZone: 'America/New_York' },
  { name: '洛杉矶', longitude: -118.2, utcOffsetMinutes: -480, timeZone: 'America/Los_Angeles' },
  { name: '多伦多', longitude: -79.4, utcOffsetMinutes: -300, timeZone: 'America/Toronto' },
  { name: '温哥华', longitude: -123.1, utcOffsetMinutes: -480, timeZone: 'America/Vancouver' },
  { name: '悉尼', longitude: 151.2, utcOffsetMinutes: 600, timeZone: 'Australia/Sydney' },
  { name: '墨尔本', longitude: 145.0, utcOffsetMinutes: 600, timeZone: 'Australia/Melbourne' },
];

const NEW_RUSSIAN_CITIES: readonly ExpectedCitySpec[] = [
  { name: '加里宁格勒', longitude: 20.5, utcOffsetMinutes: 120, timeZone: 'Europe/Kaliningrad' },
  { name: '喀山', longitude: 49.1, utcOffsetMinutes: 180, timeZone: 'Europe/Moscow' },
  { name: '下诺夫哥罗德', longitude: 44.0, utcOffsetMinutes: 180, timeZone: 'Europe/Moscow' },
  { name: '克拉斯诺达尔', longitude: 39.0, utcOffsetMinutes: 180, timeZone: 'Europe/Moscow' },
  { name: '索契', longitude: 39.72, utcOffsetMinutes: 180, timeZone: 'Europe/Moscow' },
  { name: '顿河畔罗斯托夫', longitude: 39.7, utcOffsetMinutes: 180, timeZone: 'Europe/Moscow' },
  { name: '伏尔加格勒', longitude: 44.5, utcOffsetMinutes: 180, timeZone: 'Europe/Volgograd' },
  { name: '萨马拉', longitude: 50.2, utcOffsetMinutes: 240, timeZone: 'Europe/Samara' },
  { name: '乌法', longitude: 56.0, utcOffsetMinutes: 300, timeZone: 'Asia/Yekaterinburg' },
  { name: '车里雅宾斯克', longitude: 61.4, utcOffsetMinutes: 300, timeZone: 'Asia/Yekaterinburg' },
  { name: '彼尔姆', longitude: 56.2, utcOffsetMinutes: 300, timeZone: 'Asia/Yekaterinburg' },
  { name: '鄂木斯克', longitude: 73.4, utcOffsetMinutes: 360, timeZone: 'Asia/Omsk' },
  { name: '克拉斯诺亚尔斯克', longitude: 92.9, utcOffsetMinutes: 420, timeZone: 'Asia/Krasnoyarsk' },
  { name: '伊尔库茨克', longitude: 104.3, utcOffsetMinutes: 480, timeZone: 'Asia/Irkutsk' },
  { name: '雅库茨克', longitude: 129.7, utcOffsetMinutes: 540, timeZone: 'Asia/Yakutsk' },
  { name: '哈巴罗夫斯克', longitude: 135.1, utcOffsetMinutes: 600, timeZone: 'Asia/Vladivostok' },
  { name: '南萨哈林斯克', longitude: 142.7, utcOffsetMinutes: 660, timeZone: 'Asia/Sakhalin' },
  { name: '堪察加彼得罗巴甫洛夫斯克', longitude: 158.6, utcOffsetMinutes: 720, timeZone: 'Asia/Kamchatka' },
];

const NEW_CIS_GLOBAL_CITIES: readonly ExpectedCitySpec[] = [
  { name: '阿斯塔纳', longitude: 71.4, utcOffsetMinutes: 300, timeZone: 'Asia/Almaty' },
  { name: '塔什干', longitude: 69.2, utcOffsetMinutes: 300, timeZone: 'Asia/Tashkent' },
  { name: '比什凯克', longitude: 74.6, utcOffsetMinutes: 360, timeZone: 'Asia/Bishkek' },
  { name: '第比利斯', longitude: 44.8, utcOffsetMinutes: 240, timeZone: 'Asia/Tbilisi' },
  { name: '埃里温', longitude: 44.5, utcOffsetMinutes: 240, timeZone: 'Asia/Yerevan' },
  { name: '巴库', longitude: 49.9, utcOffsetMinutes: 240, timeZone: 'Asia/Baku' },
  { name: '基辅', longitude: 30.5, utcOffsetMinutes: 120, timeZone: 'Europe/Kyiv' },
  { name: '华沙', longitude: 21.0, utcOffsetMinutes: 60, timeZone: 'Europe/Warsaw' },
  { name: '布拉格', longitude: 14.4, utcOffsetMinutes: 60, timeZone: 'Europe/Prague' },
  { name: '罗马', longitude: 12.5, utcOffsetMinutes: 60, timeZone: 'Europe/Rome' },
  { name: '马德里', longitude: -3.7, utcOffsetMinutes: 60, timeZone: 'Europe/Madrid' },
  { name: '迪拜', longitude: 55.3, utcOffsetMinutes: 240, timeZone: 'Asia/Dubai' },
  { name: '特拉维夫', longitude: 34.8, utcOffsetMinutes: 120, timeZone: 'Asia/Jerusalem' },
  { name: '伊斯坦布尔', longitude: 29.0, utcOffsetMinutes: 180, timeZone: 'Europe/Istanbul' },
  { name: '芝加哥', longitude: -87.6, utcOffsetMinutes: -360, timeZone: 'America/Chicago' },
  { name: '旧金山', longitude: -122.4, utcOffsetMinutes: -480, timeZone: 'America/Los_Angeles' },
  { name: '奥克兰', longitude: 174.8, utcOffsetMinutes: 720, timeZone: 'Pacific/Auckland' },
];

function assertCitySpec(spec: ExpectedCitySpec): void {
  const found = findCityInfo('海外 / 国际', spec.name);
  assert.ok(found, `missing overseas city: ${spec.name}`);
  assert.equal(found.longitude, spec.longitude, `${spec.name} longitude`);
  assert.equal(found.utcOffsetMinutes, spec.utcOffsetMinutes, `${spec.name} utcOffsetMinutes`);
  assert.equal(found.timeZone, spec.timeZone, `${spec.name} timeZone`);
}

// ── 1. 目录完整性与既有条目零回归 ────────────────────────────────────
const overseas = PROVINCES.find((p) => p.name === '海外 / 国际');
assert.ok(overseas, 'PROVINCES must contain 海外 / 国际');
assert.equal(overseas.cities[0]?.name, '莫斯科', 'default first overseas city must stay Moscow');

for (const spec of EXISTING_OVERSEAS_CITIES) {
  assertCitySpec(spec);
}
for (const spec of NEW_RUSSIAN_CITIES) {
  assertCitySpec(spec);
}
for (const spec of NEW_CIS_GLOBAL_CITIES) {
  assertCitySpec(spec);
}

const expectedTotal = EXISTING_OVERSEAS_CITIES.length + NEW_RUSSIAN_CITIES.length + NEW_CIS_GLOBAL_CITIES.length;
assert.equal(overseas.cities.length, expectedTotal, `expected ${expectedTotal} overseas cities`);

// 覆盖俄罗斯全部 11 个标准时区 + 历史独立伏尔加格勒时区
const allZones = new Set(overseas.cities.map((c) => c.timeZone));
for (const requiredRuZone of [
  'Europe/Kaliningrad',
  'Europe/Moscow',
  'Europe/Volgograd',
  'Europe/Samara',
  'Asia/Yekaterinburg',
  'Asia/Omsk',
  'Asia/Novosibirsk',
  'Asia/Krasnoyarsk',
  'Asia/Irkutsk',
  'Asia/Yakutsk',
  'Asia/Vladivostok',
  'Asia/Sakhalin',
  'Asia/Kamchatka',
]) {
  assert.ok(allZones.has(requiredRuZone), `missing Russian timeZone coverage: ${requiredRuZone}`);
}

// ── 2. 经度、标准偏移、IANA 有效性 & 零碰撞反查 ──────────────────────────
const seenNames = new Set<string>();
const entries: readonly CityInfo[] = overseas.cities;

for (const city of entries) {
  assert.equal(seenNames.has(city.name), false, `duplicate overseas city name: ${city.name}`);
  seenNames.add(city.name);

  assert.equal(isValidLongitude(city.longitude), true, `invalid longitude for ${city.name}: ${city.longitude}`);
  assert.equal(
    isValidUtcOffsetMinutes(city.utcOffsetMinutes),
    true,
    `invalid utcOffsetMinutes for ${city.name}: ${String(city.utcOffsetMinutes)}`,
  );
  assert.equal(isValidTimeZone(city.timeZone), true, `invalid IANA timeZone for ${city.name}: ${String(city.timeZone)}`);
  assert.equal(
    inferCityTimeZone(city.longitude, city.utcOffsetMinutes!),
    city.timeZone,
    `inferCityTimeZone mismatch for ${city.name}`,
  );
}

for (let i = 0; i < entries.length; i += 1) {
  for (let j = i + 1; j < entries.length; j += 1) {
    const a = entries[i];
    const b = entries[j];
    const sameOffset = a.utcOffsetMinutes === b.utcOffsetMinutes;
    const sameLon = Math.abs(a.longitude - b.longitude) < 1e-6;
    assert.equal(
      sameOffset && sameLon,
      false,
      `(longitude, utcOffsetMinutes) collision between ${a.name} (${a.timeZone}) and ${b.name} (${b.timeZone})`,
    );
  }
}

// 近经度 / 同经度跨时区显式校验
{
  const sochi = findCityInfo('海外 / 国际', '索契');
  const rostov = findCityInfo('海外 / 国际', '顿河畔罗斯托夫');
  assert.ok(sochi && rostov);
  assert.ok(Math.abs(sochi.longitude - rostov.longitude) >= 1e-2, 'Sochi and Rostov-on-Don longitudes must stay distinct');

  assert.equal(inferCityTimeZone(44.5, 180), 'Europe/Volgograd');
  assert.equal(inferCityTimeZone(44.5, 240), 'Asia/Yerevan');
}

// 国内城市不带 IANA / utcOffsetMinutes，不参与 inferCityTimeZone
for (const prov of PROVINCES) {
  if (prov.name === '海外 / 国际') continue;
  for (const city of prov.cities) {
    assert.equal(city.timeZone, undefined, `domestic city should not set timeZone: ${prov.name}/${city.name}`);
    assert.equal(city.utcOffsetMinutes, undefined, `domestic city should not set utcOffsetMinutes: ${prov.name}/${city.name}`);
  }
}
assert.equal(inferCityTimeZone(116.4, 480), undefined);

// ── 3. 历史 IANA 时区抽检 ──────────────────────────────────────────
{
  const historicalCases: ReadonlyArray<readonly [string, number, number, number, number, string]> = [
    // 萨马拉：2009 夏令时 UTC+5、2011 归并莫斯科冬令 UTC+3、2012/2020 稳定 UTC+4
    ['Europe/Samara', 2009, 7, 1, 300, 'Samara 2009-07-01 SAMST UTC+5'],
    ['Europe/Samara', 2011, 1, 15, 180, 'Samara 2011-01-15 MSK UTC+3'],
    ['Europe/Samara', 2012, 7, 1, 240, 'Samara 2012-07-01 permanent DST UTC+4'],
    ['Europe/Samara', 2020, 7, 1, 240, 'Samara 2020-07-01 SAMT UTC+4'],
    // 伏尔加格勒：2012 永久夏令时 UTC+4、2015 莫斯科时间 UTC+3、2018-2020 UTC+4、2021 调回 UTC+3
    ['Europe/Volgograd', 2012, 7, 1, 240, 'Volgograd 2012-07-01 UTC+4'],
    ['Europe/Volgograd', 2015, 7, 1, 180, 'Volgograd 2015-07-01 UTC+3'],
    ['Europe/Volgograd', 2020, 7, 1, 240, 'Volgograd 2020-07-01 UTC+4'],
    ['Europe/Volgograd', 2021, 7, 1, 180, 'Volgograd 2021-07-01 UTC+3'],
    // 叶卡捷琳堡：2011-2014 永久夏令时 UTC+6 vs 2014 后 UTC+5
    ['Asia/Yekaterinburg', 2012, 1, 15, 360, 'Yekaterinburg 2012-01-15 UTC+6'],
    ['Asia/Yekaterinburg', 2020, 1, 15, 300, 'Yekaterinburg 2020-01-15 UTC+5'],
    // 加里宁格勒：2011-2014 永久夏令时 UTC+3 vs 2014 后 UTC+2
    ['Europe/Kaliningrad', 2012, 1, 15, 180, 'Kaliningrad 2012-01-15 UTC+3'],
    ['Europe/Kaliningrad', 2020, 1, 15, 120, 'Kaliningrad 2020-01-15 UTC+2'],
    // 俄罗斯其余时区 2012 永久夏令时 vs 2020 标准时
    ['Asia/Omsk', 2012, 1, 15, 420, 'Omsk 2012-01-15 UTC+7'],
    ['Asia/Omsk', 2020, 1, 15, 360, 'Omsk 2020-01-15 UTC+6'],
    ['Asia/Krasnoyarsk', 2012, 1, 15, 480, 'Krasnoyarsk 2012-01-15 UTC+8'],
    ['Asia/Krasnoyarsk', 2020, 1, 15, 420, 'Krasnoyarsk 2020-01-15 UTC+7'],
    ['Asia/Irkutsk', 2012, 1, 15, 540, 'Irkutsk 2012-01-15 UTC+9'],
    ['Asia/Irkutsk', 2020, 1, 15, 480, 'Irkutsk 2020-01-15 UTC+8'],
    ['Asia/Yakutsk', 2012, 1, 15, 600, 'Yakutsk 2012-01-15 UTC+10'],
    ['Asia/Yakutsk', 2020, 1, 15, 540, 'Yakutsk 2020-01-15 UTC+9'],
    ['Asia/Kamchatka', 2012, 1, 15, 720, 'Kamchatka 2012-01-15 UTC+12'],
    ['Asia/Kamchatka', 2020, 1, 15, 720, 'Kamchatka 2020-01-15 UTC+12'],
    // 哈萨克斯坦 2024-03-01 统一为 UTC+5
    ['Asia/Almaty', 2020, 1, 15, 360, 'Almaty 2020-01-15 UTC+6'],
    ['Asia/Almaty', 2024, 2, 29, 360, 'Almaty 2024-02-29 pre-unification UTC+6'],
    ['Asia/Almaty', 2024, 3, 1, 300, 'Almaty 2024-03-01 unified UTC+5'],
    // 土耳其 2016 年起永久 UTC+3
    ['Europe/Istanbul', 2016, 1, 15, 120, 'Istanbul 2016-01-15 UTC+2'],
    ['Europe/Istanbul', 2024, 1, 15, 180, 'Istanbul 2024-01-15 permanent UTC+3'],
    // 奥克兰：南半球夏季 UTC+13 vs 冬季 UTC+12
    ['Pacific/Auckland', 2024, 1, 15, 780, 'Auckland 2024-01-15 NZDT UTC+13'],
    ['Pacific/Auckland', 2024, 7, 1, 720, 'Auckland 2024-07-01 NZST UTC+12'],
    // 迪拜：全年无夏令时 UTC+4
    ['Asia/Dubai', 1990, 1, 15, 240, 'Dubai 1990-01-15 UTC+4'],
    ['Asia/Dubai', 2024, 7, 1, 240, 'Dubai 2024-07-01 UTC+4'],
    // 欧美及中东常规夏冬令时
    ['Europe/Kyiv', 2024, 1, 15, 120, 'Kyiv 2024-01-15 UTC+2'],
    ['Europe/Kyiv', 2024, 7, 1, 180, 'Kyiv 2024-07-01 UTC+3'],
    ['Europe/Warsaw', 2024, 1, 15, 60, 'Warsaw 2024-01-15 UTC+1'],
    ['Europe/Warsaw', 2024, 7, 1, 120, 'Warsaw 2024-07-01 UTC+2'],
    ['Europe/Prague', 2024, 1, 15, 60, 'Prague 2024-01-15 UTC+1'],
    ['Europe/Prague', 2024, 7, 1, 120, 'Prague 2024-07-01 UTC+2'],
    ['Europe/Rome', 2024, 1, 15, 60, 'Rome 2024-01-15 UTC+1'],
    ['Europe/Rome', 2024, 7, 1, 120, 'Rome 2024-07-01 UTC+2'],
    ['Europe/Madrid', 2024, 1, 15, 60, 'Madrid 2024-01-15 UTC+1'],
    ['Europe/Madrid', 2024, 7, 1, 120, 'Madrid 2024-07-01 UTC+2'],
    ['Asia/Jerusalem', 2024, 1, 15, 120, 'Jerusalem 2024-01-15 UTC+2'],
    ['Asia/Jerusalem', 2024, 7, 1, 180, 'Jerusalem 2024-07-01 UTC+3'],
    ['America/Chicago', 2024, 1, 15, -360, 'Chicago 2024-01-15 UTC-6'],
    ['America/Chicago', 2024, 7, 1, -300, 'Chicago 2024-07-01 UTC-5'],
    ['America/Los_Angeles', 2024, 1, 15, -480, 'Los Angeles / SF 2024-01-15 UTC-8'],
    ['America/Los_Angeles', 2024, 7, 1, -420, 'Los Angeles / SF 2024-07-01 UTC-7'],
  ];

  for (const [zone, year, month, day, expectedOffset, label] of historicalCases) {
    assert.equal(resolveTimeZoneOffsetMinutes(zone, year, month, day, 12, 0), expectedOffset, label);
  }
}

// ── 4. 真太阳时集成：反查推断与显式 timeZone 在冬夏两季结果一致 ────────────
{
  const aucklandSummer = calculateTrueSolarTime({
    year: 2024,
    month: 1,
    day: 15,
    clockHour: 12,
    clockMinute: 0,
    longitude: 174.8,
    utcOffsetMinutes: 720,
    includeEquationOfTime: false,
  });
  assert.equal(aucklandSummer.timeZone, 'Pacific/Auckland');
  assert.equal(aucklandSummer.utcOffsetMinutes, 780);
  assert.equal(aucklandSummer.standardMeridian, -165);
  assert.equal(aucklandSummer.dayOffset, 0);

  for (const city of entries) {
    for (const [year, month, day] of [[2020, 1, 15], [2024, 7, 15]] as const) {
      const inferred = calculateTrueSolarTime({
        year,
        month,
        day,
        clockHour: 12,
        clockMinute: 0,
        longitude: city.longitude,
        utcOffsetMinutes: city.utcOffsetMinutes,
      });
      const explicit = calculateTrueSolarTime({
        year,
        month,
        day,
        clockHour: 12,
        clockMinute: 0,
        longitude: city.longitude,
        utcOffsetMinutes: city.utcOffsetMinutes,
        timeZone: city.timeZone,
      });
      assert.equal(inferred.timeZone, city.timeZone, `${city.name} inferred timeZone (${year}-${month})`);
      assert.deepEqual(inferred, explicit, `${city.name} inferred vs explicit solar result (${year}-${month})`);
    }
  }
}

console.log(`✅ cities-geo regression passed (${entries.length} overseas cities verified)`);
