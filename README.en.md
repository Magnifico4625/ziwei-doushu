<div align="center">

# Zi Wei Dou Shu · Open-Source Charting Engine

### Algorithms are openly shared traditional wisdom; they shouldn’t be locked behind walls.

[![CI](https://github.com/Magnifico4625/ziwei-doushu/actions/workflows/ci.yml/badge.svg)](https://github.com/Magnifico4625/ziwei-doushu/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/code-MIT-blue.svg)](./LICENSE)
[![Dataset: CC BY 4.0](https://img.shields.io/badge/dataset-CC%20BY%204.0-green.svg)](./DATASET-LICENSE)

[中文](./README.md) · **English** · [API Reference](./docs/API.md)

</div>

**1. Philosophy:** Zi Wei Dou Shu is a treasure of traditional Chinese astrology, and Ni Haixia laid out its authentic system in *Tian Ji* (《天纪》). We hope technology can bring more people to learn it.

We open-source the charting algorithm and the knowledge base because we believe **algorithms are openly shared traditional wisdom and shouldn’t be locked behind walls**. The real value lies in the depth of interpretation, a carefully polished user experience, and what we build up by running the service day after day.

**2. About the project:** A Zi Wei Dou Shu (紫微斗数, "Purple Star Astrology") charting engine following the teaching system of **Ni Haixia's *Tian Ji* (倪海厦《天纪》)**. It includes the full charting algorithm, the Four Transformations (四化), a pattern knowledge base, public-domain classical texts, and a **518,400-chart sample dataset**, plus a **674,976-chart × 13-topic interpretation dataset (v4.0, 2026-10-15): 8.77 million readings, about 20.4 billion characters of text, 56.6 GB uncompressed** — up from 518,400 charts and 33.1 GB in v3.0.

| Dataset | Charts | Readings | Uncompressed | Years | Characters per chart |
|---|---|---|---|---|---|
| **v4.0 interpretations** (2026-10-15) | **674,976** | **8,774,688** | **56.6 GB** | **1950–2026** (real dates only) | **~30,000** |
| v3.0 samples | 518,400 | 6,739,200 | 33.1 GB | 1924–1983 | ~21,000 |
| Change | +30% | +30% | **+71%** | +17 years | +44% |

<sub>v3.0 characters per chart estimated from a 2,160-chart sample; all other figures are full counts. Both versions have 13 topics per chart.</sub>

This repo is an open snapshot of the engine behind [metisziwei.com](https://metisziwei.com/?from=gh-readme-en), synced from production periodically.

> **Note: on readings of family relations**
>
> Zi Wei Dou Shu has known limits when it comes to family relations (parents, siblings, children and so on). In *Tian Ji*, Master Ni Haixia said that "Dou Shu has always been somewhat weaker at reading family relations" ([lecture 2, part 1 · 00:25:27](https://www.bilibili.com/video/BV1KJsLekEfA?p=3&t=1527)). Among traditional methods, Tie Ban Shen Shu has its own strengths in checking family relations ([00:03:15](https://www.bilibili.com/video/BV1KJsLekEfA?p=3&t=195)); Master Ni still kept Zi Wei Dou Shu at the core because it can be read together with geography, surroundings and human affairs, forming a complete system that knows the heavens above, the earth below and human affairs in between ([00:25:43](https://www.bilibili.com/video/BV1KJsLekEfA?p=3&t=1543)). Readings about family relations are therefore for reference only; the Parents, Siblings and Children sections on [metisziwei.com](https://metisziwei.com/?from=gh-readme-en) carry the same note.

## Commercial Backend & Engine Evolution (Stages 1–3)

Building on the upstream charting snapshot, this repository now ships a complete headless engine and commercial backend (see [**`docs/API.md`**](./docs/API.md) for exact HTTP and Node contracts):

- **Stage 1 (Headless Engine Decoupling & Global Timezones)**: Moved `BirthFormState` into `lib/ziwei/types.ts` with zero `@/components/*` imports in `lib/ziwei/`; added `heming.ts` (zero-LLM cross-chart synastry + `< 3 KB` payloads), `chart-analyzer.ts` (`getChartCacheKey`, `extractChartPainPoints`, `buildChartPromptPayload`), and IANA historical DST coverage across all 11 Russian standard time zones plus CIS and global hubs.
- **Stage 2 (Server Infrastructure & Paywall-Guarded AI APIs)**: Added `db/schema.sql`, `lib/server/` (PostgreSQL & Redis adapters with automatic in-memory fallback, HS256 token & HMAC webhook verification, IP rate limiting, multi-provider SSE streaming), plus `/api/health`, Zero-LLM `/api/chart`, `/api/billing/webhook`, and strict-paywalled `/api/interpret` & `/api/heming`.
- **Stage 3 (Multilingual `ru`/`zh`/`en`, Zero-LLM Free Tier & Teasers, License Hygiene, Billing & CORS)**: Added `lib/ziwei/i18n.ts` and multilingual city lookup `findCityByQuery` in `cities.ts`; populated deterministic `命宫` free readings (`db-analysis.ts`) and paywall teasers (`paywall-teasers.ts`); removed `server-only` from `patterns.ts` & `famous.ts` and stripped all `CC BY-NC-SA 4.0` / `ni_quote` lecture quotes from runtime modules (`lib/ziwei/*`, `lib/server/*`, `app/api/*`); added `POST /api/billing/checkout`, `GET /api/billing/order`, `ALLOWED_ORIGINS` CORS (`lib/server/cors.ts`), and language-isolated caches while keeping entitlements language-agnostic (20 regression suites + `tsc --noEmit` + `npm run build` passing).

## Upstream Baseline Update (2026-10-15)

![Update overview](./docs/update-20261015.png)

- **Interpretation dataset v4.0 released**: 674,976 charts (every real solar date 1950–2026 × 12 double-hours × male/female) × 13 topics = 8,774,688 readings; 161 MB compressed, 56.6 GB uncompressed (v3.0: 33.1 GB), 77 per-year files plus an all-years bundle. See [Release v4.0-13d](https://github.com/Renhuai123/ziwei-doushu/releases/tag/v4.0-13d) and the dataset section below.
- **The 13 topics were revised sentence by sentence** against the verbatim transcripts of Ni Haixia's *Tian Ji* and the original *Complete Book*: untraceable citations removed or replaced with verbatim quotes (with episode and timestamp), sentences about impossible transformations removed, conditions spelled out, two-sided sentences resolved per chart, and health now follows Master Ni's whole-chart method instead of mapping stars to organs by Five Element. (The judgment library itself stays closed; the results are in the v4.0 dataset.)
- **Engine sync** ([PR #39](https://github.com/Renhuai123/ziwei-doushu/pull/39)): `chinaDSTSpan(year)` in `dst-cn.ts`; longitudes for province-administered county-level cities in `cities.ts`.
- **License**: `DATASET-LICENSE` now covers v4.0; quotations from *Tian Ji* inside the readings are not covered by the dataset license.

## What the engine handles

| Feature | Notes |
|---|---|
| True solar time | Longitude offset plus the equation of time, with 58 international hubs in `cities.ts` (covering all 11 Russian standard time zones plus `Europe/Volgograd`, CIS, and major global cities) plus 18 additional RU/CIS/European hubs in `EXTRA_OVERSEAS_CITIES`, multilingual search (`findCityByQuery` / `getCityDisplayName` with `nameRu`, `nameEn`, `aliases`), historical IANA time zones (DST-aware), and manual UTC offsets (`UTC-12` to `UTC+14`, including `UTC+5:30`). A transition uses Temporal `compatible`: a nonexistent local time takes the offset after the transition; a repeated local time takes the earlier offset |
| China DST | The commonly used convention table in `dst-cn.ts` (not IANA) drives a birth-form warning and a one-click −1 hour control. The engine does not change the entered time. See the note below for how the table differs from IANA |
| Leap months | Four configurable conventions (previous month / next month / split by day / same month) |
| Late Zi hour | Determined by true solar time when a location/timezone is set (23:00–23:59 charts on the next day; 00:00–00:59 is early Zi on that solar day), or by clock hour when no location is given; switchable |
| Star brightness | 7 levels (庙 旺 得 利 平 不 陷); brightness tables of different schools are switchable, not hard-coded |
| Four Transformations | Natal, decade (大限) and annual (流年) transformations, plus flying-star self-transformations |
| Twelve spirits | Natal layer by year branch, annual layer by the annual branch |
| Patterns | 1,100+ lines of pattern rules (紫府同宫, 日月并明, 七杀朝斗, …), free of `server-only` for direct Node/`tsx` execution |
| Multilingual i18n | `i18n.ts` (`SupportedLang = 'ru' \| 'zh' \| 'en'`, `normalizeLang`, `translateChartSummary`): complete dictionaries for 12 palaces, all stars, SiHua, brightness, 5-element bureaus, stems/branches, 44+ classical patterns, and chart summaries |
| Zero-LLM Free Tier & teasers | `db-analysis.ts` (`generateFreeLifePalaceReading` covering all 14 major stars, 24 dual-star pairs, empty-palace opposite borrowing, brightness & natal SiHua in `ru`/`zh`/`en`) and `paywall-teasers.ts` (`generateChartTeasers`, `generateSynastryTeasers`) |
| Deterministic synastry | `heming.ts` (`analyzeSynastry`, `buildSynastryPromptPayload`): zero-LLM cross-chart Flying SiHua (`yearStem` + optional `mingStem`/`fuqiStem`), Life/Spouse palace & borrowed-star resonance, branch relations, optional annual overlay, 0–100 scoring, and `< 3 KB` compact LLM prompt payloads |
| Deterministic chart analyzer | `chart-analyzer.ts` (`getChartCacheKey`, `extractChartPainPoints`, `buildChartPromptPayload`): zero-LLM canonical chart cache keys, Natal/Self/DaXian/LiuNian HuaJi & Sha-cluster pain-point extraction, Life/Body/SanFangSiZheng summaries, and `< 3 KB` compact LLM payloads |
| Commercial license hygiene | Runtime modules (`lib/ziwei/*`, `lib/server/*`, `app/api/*`) contain zero `CC BY-NC-SA 4.0` text or `ni_quote` lecture quotes |

On an IANA transition there is one rule, independent of hemisphere and of the sign of longitude, matching Temporal `disambiguation: 'compatible'`. A nonexistent local time (the spring-forward gap) uses the offset after the transition. A repeated local time (the fall-back overlap) uses the earlier offset, the one from before the transition. Examples: New York 2024-03-10 02:30 (nonexistent) → UTC−4; London 2024-03-31 01:30 → UTC+1; Moscow 2011-03-27 02:30 → UTC+4; Sydney 2024-10-06 02:30 → UTC+11; New York 2024-11-03 01:30 (repeated) → the earlier UTC−4; London 2024-10-27 01:30 → UTC+1; Moscow 2014-10-26 01:30 → UTC+4; Sydney 2024-04-07 02:30 → UTC+11. The form names the offset it used and does not block the chart.

The China DST table is the commonly used national table. IANA `Asia/Shanghai` also has 1919; 1935–1939, 1950–1961, 1974, 1975 and 1979 are in the table and absent from IANA; the 1940s differ; 1988 starts on 10 April in the table and 17 April in IANA. The warning follows the table.

Engine code lives in `lib/ziwei/` (entry point: `generateChart()` in `algorithm.ts`) and is decoupled from UI components (`BirthFormState` lives in `lib/ziwei/types.ts`, with zero `@/components/*` imports in `lib/ziwei/`). `patterns.ts` and `famous.ts` no longer import `server-only`, so core charting, patterns, geo, `i18n.ts`, `db-analysis.ts`, `paywall-teasers.ts`, synastry (`heming.ts`), and chart analysis (`chart-analyzer.ts`) modules run headlessly in both Next.js and Node/`tsx` with zero `CC BY-NC-SA 4.0` runtime text. Inputs are a **Gregorian** date and an **hour branch index 0–11** (子 = 0 … 亥 = 11), not a clock hour.

## Quick start

```bash
git clone https://github.com/Magnifico4625/ziwei-doushu.git
cd ziwei-doushu
npm ci
npm run dev          # charting demo at http://localhost:3000/chart

npm run typecheck    # TypeScript check
npm test             # 20 regression suites (charting, DST, geo/cities, synastry, chart-analyzer, server-infra, api-routes, i18n/teasers/license, stage3-commercial)
npm run test:i18n-teasers-license
npm run test:stage3-commercial
npm run build        # Next.js production build verification
```

**No API key or database is needed for charting.** Backend API routes (`app/api/`) and server infrastructure (`lib/server/`, `db/schema.sql`) are now included (full JSON schemas in [`docs/API.md`](./docs/API.md)), with `'ru' | 'zh' | 'en'` localization and `ALLOWED_ORIGINS` CORS (`lib/server/cors.ts`, exporting `OPTIONS` and wrapping responses with `withCors` across all 7 `/api/*` routes):

- `GET /api/health` — checks PostgreSQL & Redis health (auto-falling back to in-memory mode when `DATABASE_URL` / `REDIS_URL` are unset) and exposes non-secret `aiProvider` / `paywallMode`.
- `POST /api/chart` — **Zero-LLM ($0 AI cost)** charting & pre-paywall analysis endpoint (`128 KiB` body limit -> `413 PAYLOAD_TOO_LARGE`; rejects invalid `?tz=`/`timeZone`/`tz` such as `Not/AZone` with `400 INVALID_INPUT`), supporting `lang: 'ru' | 'zh' | 'en'`, multilingual city lookup via `findCityByQuery` (e.g., `"Москва"`), direct synchronous `detectPatterns(chart)`, deterministic `freeLifePalace` (`命宫` free reading), localized `teasers`, `localizedSummary`/`localizedPatterns`, year-agnostic `entitlementKey` alongside `cacheKey`/`pairKey`, and cache lookup (`app/api/chart/route.ts` never imports `lib/server/llm.ts`).
- **Full billing lifecycle** (`/api/billing/*`, `32 KiB` body limit -> `413`, configured via `APP_PUBLIC_URL`, `BILLING_PROVIDER`, `BILLING_CHECKOUT_BASE_URL`):
  - `POST /api/billing/checkout` — validates `scope` (`'interpret' | 'heming' | 'bundle'`), positive amount (`amountMinor > 0` / `amount > 0`, `<= 0` -> `400`), and normalizes `targetKey` without `:y<targetYear>`, persists a `'pending'` order with `claim_token_hash`, and returns `201` with `orderId`, capability `orderToken`, and `checkoutUrl`.
  - `GET /api/billing/order?orderId=...` — requires caller authorization via `X-Order-Token` header or `orderToken` query parameter (`401 UNAUTHORIZED` when missing/invalid); returns `paid: false` (never exposing `accessToken`) while pending, and signs & returns a year-agnostic HS256 `accessToken` once `paid`.
  - `POST /api/billing/webhook` — verifies HMAC-SHA256 signatures (`timingSafeEqual`), rejects `amountMinor <= 0` (`400`), strips `:y<targetYear>` from `targetKey`, atomically marks `'pending'` orders `'paid'` while preserving `claim_token_hash`, and issues signed `accessToken`s.
- `POST /api/interpret` & `POST /api/heming` — enforce `128 KiB` body limits (`413`), validate embedded `timeZone` fields (`400`), support `lang: 'ru' | 'zh' | 'en'` with localized LLM system prompts (`lib/server/llm.ts`), and isolate Redis + PostgreSQL caches by `:y<targetYear>` (`chartKey`/`pairKey`) and language (`scopedTopicKey` / `scopedQuestionHash`), while verifying paywall `entitlementKey`s without `:y<targetYear>` or language suffixes so buying a chart with or without `targetYear` unlocks both variants. Under default `AI_PAYWALL_MODE=strict`, callers **must** pass a signed HS256 `accessToken` (`Authorization: Bearer` or `accessToken` field — bare-key access without a token returns `402 PAYWALL_LOCKED`), missing/invalid LLM configuration returns `503 LLM_CONFIG_ERROR`, and `POST /api/heming` (which imports `llm.ts` for paid SSE) short-circuits on `previewOnly: true` before rate limiting, paywall checks, or any LLM call to return Zero-LLM localized `overview` and `teasers`. Copy `.env.example` to `.env.local` and set `AI_PAYWALL_MODE=off` plus a provider key for local non-billed AI testing.

## What is not included

The proprietary 13-topic interpretation database (`STAR_DB` in `lib/ziwei/db-analysis.ts` remains empty, while deterministic Zero-LLM `命宫` free readings via `generateFreeLifePalaceReading` and `paywall-teasers.ts` are included), production commercial frontend UI, merchant payment-gateway credentials/user accounts, and production deployment secrets.

## Interpretation dataset v4.0 (674,976 charts × 13 topics, 2026-10-15)

Download from [Releases → v4.0-13d](https://github.com/Renhuai123/ziwei-doushu/releases/tag/v4.0-13d): 77 per-year files `year-YYYY.jsonl.zst` (161 MB compressed, 56.6 GB uncompressed (v3.0: 33.1 GB)), plus `SHA256SUMS.txt` and `MANIFEST.json`.

- Every solar date from 1950 to 2026 (only dates that actually exist) × 12 double-hours × male/female; one chart per line (JSON Lines).
- Fields: `k` key, `y`/`m`/`d` solar date, `h` double-hour index 0–11 (not clock hours), `g` gender, `ms` first major star of the Life Palace (`null` if empty), `t` character counts, `c` the 13 topic readings in Markdown.
- Generated deterministically by the charting engine and the 2026-10-15 judgment library (content version `ca268829f7a9`), no AI involved. The 13 topics were revised sentence by sentence against the verbatim transcripts of Ni Haixia's *Tian Ji* and the original *Complete Book of Zi Wei Dou Shu*.
- Natal-chart view only: age-based rewording, the appended Master Ni rule sections and AI readings shown on the website are not included. Charts use the double-hour index directly, without true-solar-time correction.
- Decompress with `zstd -d --long=27 year-1990.jsonl.zst` (`--long=27` is required).
- Quotations from Ni Haixia's *Tian Ji* inside the readings are **not covered by the dataset license**: they are short citations with episode and timestamp, and copyright in the original lectures remains with the rights holder; bulk reuse of those quotations falls under the [CC BY-NC-SA 4.0](./docs/tianji-ziwei/LICENSE.md) terms of chapter 5. The *Complete Book* is in the public domain.
- License: same as v3.0 — [CC BY 4.0](./DATASET-LICENSE), commercial use OK with attribution (except the quotations above).
- A single all-years bundle `ziwei-interp-v4-all.tar` is also provided.

## Sample dataset (518,400 charts)

Download from [Releases](https://github.com/Renhuai123/ziwei-doushu/releases/tag/v3.0-samples) (3 parts, 5.5 GB in total). Each sample is generated from `birthInfo`:

- `year` / `month` / `day`: **Gregorian** date, 1924–1983 (one full 60-year cycle). The published archive used days 1–30 of every month; nonexistent Gregorian dates are rejected by the engine and removed by the cleaner below
- `hour`: **hour branch index 0–11** (子 = 0 … 亥 = 11), *not* a clock hour; the `hHH` part of each file name is the same index
- `gender`: `male` / `female`; `longitude` is fixed at 120 (no local true-solar-time correction)

**Fixed: nonexistent Gregorian dates are rejected and can be stripped from the sample set.** The published archive was generated with days 1–30 of every month (518,400 rows). Feb 30 (60 years) and Feb 29 in non-leap years (45 years) do not exist: 105 dates × 12 double-hours × 2 genders = **2,520** rows (0.49%). The old engine passed them to iztro, which did not throw; lunar conversion landed on the next real day, so a non-leap Feb 29 duplicated Mar 1, a non-leap Feb 30 duplicated Mar 2, and a leap-year Feb 30 duplicated Mar 1.

- `generateChart` checks the Gregorian calendar before iztro. Feb 29 of 1900 and 2023 is rejected; Feb 29 of 2000 and 2024 is kept.
- The birth form and `formToBirthInfo` check first. The late-zi “add one day” rule runs only for a date that already exists.
- The archive is about 33 GB and is not in this repo. `npx tsx scripts/dataset/clean-v3-samples.ts` reprints the grid audit: **518,400 → remove 2,520 → 515,880**. With `--input` and `--output` it drops records whose declared Gregorian date does not exist. Real Mar 1 and Mar 2 rows are kept, once each.

Lunar dates are a separate calendar. A lunar month may have 30 days, and leap lunar months are valid. The cleaner reads only the Gregorian `birthInfo` (or the Gregorian date in the filename when `birthInfo` is absent). It does not drop a row because of lunar day 30 or a leap month.

## Ni Haixia's original words (*Tian Ji*, Zi Wei part)

[`docs/tianji-ziwei/`](./docs/tianji-ziwei/) holds **1,848 quotes** from the Zi Wei lectures of *Tian Ji* (14 lectures plus 2 supplements), each linked to the second it was said in the video. Taken from the sister repo [nihai-tianji-corpus](https://github.com/Renhuai123/nihai-tianji-corpus).

## License

| Part | License |
|---|---|
| Code (`lib/`, `app/`, `components/`, `db/` — zero `CC BY-NC-SA 4.0` runtime text; `server-only` removed from `patterns.ts` & `famous.ts`) | [MIT](./LICENSE) |
| Sample dataset (Releases) | [CC BY 4.0](./DATASET-LICENSE): commercial use OK with attribution |
| Classical texts | Public domain |
| Ni Haixia quotes (`docs/tianji-ziwei/`) | [CC BY-NC-SA 4.0](./docs/tianji-ziwei/LICENSE.md): **non-commercial only** |

Contributions are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) and the backend contract in [docs/API.md](./docs/API.md); upstream discussions live at [Renhuai123/ziwei-doushu/discussions](https://github.com/Renhuai123/ziwei-doushu/discussions).
