# Dataset & Engine Calendar Alignment Contract (`v4.0-13d` + `XD2`)

This document records the agreed charting configuration and calendar conversion rules connecting the engine (`lib/ziwei/algorithm.ts`, `POST /api/chart`) with the 13-topic interpretation dataset `v4.0-13d`.

## 1. Per-Call Brightness School (`XD2` vs Default `QS`)

- **Engine API (`generateChart`)**: Accepts explicit per-call `brightnessSchool?: 'default' | 'QS' | 'XD1' | 'ZZ' | 'XD2'` without mutating global module state (`setBrightnessSchool`). Existing callers omitting `brightnessSchool` keep the global default (`QS`).
- **Dataset Helper (`generateDatasetChart`)**: Explicitly sets `brightnessSchool: 'XD2'` (`DATASET_BRIGHTNESS_SCHOOL`) and `leapMonth: 'split'` (`DATASET_LEAP_MONTH_POLICY`) per call.
- **HTTP API (`POST /api/chart`)**: Accepts optional `brightnessSchool` and validates it against `'default' | 'QS' | 'XD1' | 'ZZ' | 'XD2'` (`400 INVALID_INPUT` on invalid values). Dataset report flows pass `"brightnessSchool": "XD2"`.
- **Chart Output & Key Separation**: The resolved school (`'QS' | 'XD1' | 'ZZ' | 'XD2'`) is stored on `ZiweiChart.brightnessSchool` and returned by `POST /api/chart`. Cache keys (`getChartCacheKey` / `canonicalPairKey`) include the active school (`:default:` for `QS`, `:XD2:` for `XD2`, etc.) so cached text never overwrites across schools, while entitlement keys (`getChartEntitlementKey` / `canonicalPairEntitlementKey` / `normalizeEntitlementKey`) normalize the school to `:default:` (and strip `:y<targetYear>`) so paid access stays valid when switching schools (`QS` <-> `XD2`) without causing false `402` errors.

## 2. Dynamic Active Period (`DaXian` / `referenceDate` / `referenceYear`)

- Static 13-chapter report texts MUST NOT hardcode phrases such as *"current DaXian (32-41)"* because age advances every year.
- `generateChart` (and `POST /api/chart`) accept optional `referenceDate?: string` (`YYYY-MM-DD`) or `referenceYear?: number` so the backend deterministically calculates `currentAge`, `currentDaXianIndex`, and `palaces[].isCurrentDaXian` without relying on wall-clock `new Date()`. Dataset calibration checks always pass `referenceYear` explicitly (`2026`, `2020`, `2031`).

## 3. Calendar & Civil-Time Conversion Policy

1. **Year boundary**: Lunar New Year (`yearDivide: 'normal'`, 正月初一), matching mainstream Zi Wei Dou Shu software and `v4.0-13d`. Dates between LiChun (`立春`) and Lunar New Year belong to the preceding lunar year (`1990-01-01` -> lunar `1989-12-05`, `己巳` year).
2. **Leap month policy**: `DEFAULT_LEAP_MONTH = 'split'` (days `1..15` stay in the current month; days `>= 16` shift to the following month).
3. **Civil birth clock -> dataset key (`solarDate`, `hour 0..11`, `gender`)**:
   - In `v4.0-13d`, records only encode `(solarDate, doubleHourBranchIndex 0..11, gender)`; sub-hour late-Zi `23:xx` does not exist as a separate dataset index.
   - When civil birth time is converted via `formToBirthInfo` (`lib/ziwei/share.ts` + `lib/ziwei/true-solar-time.ts`), the engine applies IANA historical timezone DST (`disambiguation: 'compatible'`), longitude offset, equation of time, and the late-Zi rule (`next-day`: `23:00–23:59` true solar time shifts `solarDate` forward by `+1 day` with `hour = 0`), then matches the dataset by the resolved `(solarDate, hour 0..11, gender)`.

## 4. Verification Against the Three Reference 1990 Pilot Charts

| Pilot Record | Solar / Hour / Gender | Brightness (`XD2` parity) | Key Natal Positions (`split`) | Leap Month Observation |
|---|---|---|---|---|
| `1990-01-01-0-male` | `1990-01-01`, `h=0` (子), `male` | `命宫[丑] 天府[庙]`, `父母[寅] 太阴[陷]` (`QS`: `旺`), `福德[卯] 贪狼[旺]` (`QS`: `利`), `迁移[未] 廉贞[庙]` (`QS`: `利`) | `水二局`, `命=身=丑`, `文曲忌/武曲禄/贪狼权/天梁科`, `己巳 丙子 丙寅 戊子` | Not leap (`lunar 1989-12-05`) |
| `1990-01-26-6-female` | `1990-01-26`, `h=6` (午), `female` | `命宫[未] 紫微[庙]+破军[庙]`, `官禄[亥] 廉贞[陷]+贪狼[陷]` (`夫妻[巳]` empty borrows `廉贪`) | `土五局`, `命=身=未` | Not leap (`lunar 1989-12-30`) |
| `1990-07-21-11-male` | `1990-07-21`, `h=11` (亥), `male` | `XD2`, `水二局` | Empty `命宫[申]` + `禄存[庙]`, flanked by `擎羊` in `父母[酉]` and `陀罗` in `兄弟[未]` | **Known pilot quirk in `split` (`days > 15`)**: `lunarMonth: 6, lunarDay: 29, isLeapMonth: false` even on the last day of `闰五月` (`1990-07-21`), yet **actual palace stars match the pilot text** (*empty Life Palace + Lucun + Yang/Tuo flanking*). Kept intentionally for layout compatibility and covered by regression assertions. Under `origin-month` / `prev-month`, `isLeapMonth` is `true` and `命宫` shifts to non-empty `[未]` (`太阳+太阴`). |
