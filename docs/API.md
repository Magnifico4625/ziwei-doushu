# Zi Wei Dou Shu Backend & Engine API Reference

This document specifies the HTTP API routes, billing lifecycle, CORS configuration, request limits, key semantics, persistence schema, and headless TypeScript/Node engine exports built into `Magnifico4625/ziwei-doushu`.

## Core Design Invariants

1. **Zero-LLM Endpoints (`$0.00` AI cost)**:
   - `app/api/chart/route.ts` (`POST /api/chart`) **never imports `lib/server/llm.ts`** and computes natal charts, synastry comparisons, patterns (`detectPatterns`), free Life Palace (`命宫`) readings, and paywall teasers purely deterministically.
   - `app/api/heming/route.ts` imports `lib/server/llm.ts` for its paid SSE branch, while requests with `previewOnly: true` short-circuit and return before rate limiting, paywall verification, or any LLM call (`$0.00` AI cost).
2. **Strict Token-Based Paywall Guard**: With `AI_PAYWALL_MODE=strict` (default), paid endpoints (`POST /api/interpret`, paid `POST /api/heming`) **always** require a valid HMAC-signed `accessToken` (`Authorization: Bearer <accessToken>` or JSON body `accessToken`) **before** reading paid cache or invoking any LLM, returning `402 PAYWALL_LOCKED` otherwise (never granting access from a bare `cacheKey` or `pairKey` alone).
3. **Year-, School- & Language-Agnostic Entitlements + Isolated Caches**: Purchases bind to the canonical base `entitlementKey` (`:default:` school, without `:y<targetYear>` or `lang`), so a report bought under `QS` (`default`) or `XD2`, with or without a target year, authorizes queries across schools (`'QS' | 'XD1' | 'ZZ' | 'XD2'`), years, and languages (`'ru' | 'zh' | 'en'`). Meanwhile, cached texts in Redis and PostgreSQL remain isolated per resolved `brightnessSchool` (`cacheKey` / `pairKey`), `:y<targetYear>`, and language.
4. **Commercial MIT Runtime Cleanliness**: Runtime modules (`lib/ziwei/*`, `lib/server/*`, `app/api/*`) contain zero `CC BY-NC-SA 4.0` lecture quotes (`ni_quote` / `docs/tianji-ziwei/`), and core modules (`lib/ziwei/patterns.ts`, `lib/ziwei/famous.ts`) have zero `server-only` dependencies.

---

## Environment Variables (`.env.example`)

| Variable | Default / Required | Description |
|---|---|---|
| `AI_PROVIDER` | `deepseek` | LLM backend: `deepseek` \| `anthropic` \| `mimo` \| `openai-compatible` |
| `DEEPSEEK_API_KEY` / `ANTHROPIC_API_KEY` / `MIMO_API_KEY` / `OPENAI_API_KEY` | Required for paid SSE | Provider API credentials (kept strictly server-side) |
| `AI_PAYWALL_MODE` | `strict` | `strict` enforces payment gate; set `off` only for local dev |
| `ACCESS_TOKEN_SECRET` | Required to issue/verify tokens | Secret for signing HS256 JWT `accessToken` (30-day TTL) |
| `PAYWALL_WEBHOOK_SECRET` | Required for `/api/billing/webhook` | Shared secret for HMAC-SHA256 webhook verification |
| `BILLING_PROVIDER` | `manual` | Default provider tag recorded on checkout orders (e.g. `yookassa`, `stripe`, `manual`) |
| `BILLING_CHECKOUT_BASE_URL` | `<APP_PUBLIC_URL>/checkout` | Optional external checkout page base URL |
| `ALLOWED_ORIGINS` | `APP_PUBLIC_URL` or localhost | Comma-separated allowed CORS `Origin` URLs or `*` |
| `DATABASE_URL` | Optional (in-memory fallback) | PostgreSQL connection URL (`db/schema.sql`) |
| `REDIS_URL` | Optional (in-memory fallback) | Redis connection URL for SSE cache and rate limits |
| `INTERPRET_RATE_LIMIT_PER_MIN` | `20` | Per-IP 60s window limit for `/api/interpret` and `/api/heming` |
| `CHART_RATE_LIMIT_PER_MIN` | `60` | Per-IP 60s window limit for `/api/chart` |
| `APP_PUBLIC_URL` / `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | Public site origin fallback |

---

## CORS, Body Size Limits & Localization

### CORS & Preflight (`lib/server/cors.ts`)

All 7 `/api/*` routes export `OPTIONS` preflight handlers and wrap every response (JSON, errors, and `ReadableStream` SSE) with `withCors(request, response)`:

- **Allowed Methods**: `GET, POST, OPTIONS`
- **Allowed Request Headers**: `Content-Type, Authorization, X-Order-Token, X-Requested-With, X-Webhook-Signature, X-Signature`
- **Exposed Response Headers**: `X-Cache, Retry-After`
- **Preflight Behavior**:
  - Allowed `Origin` (matching `ALLOWED_ORIGINS` or `*`) or absent `Origin` -> `204 No Content`.
  - Disallowed `Origin` -> `403` JSON `{ "error": "cors_origin_denied", "code": "CORS_FORBIDDEN" }`.

### Request Body Size Limits (`lib/server/request-body.ts`)

Every JSON/webhook `POST` route enforces hard byte caps (checking both `Content-Length` and incremental stream bytes, canceling oversized streams with `413 PAYLOAD_TOO_LARGE` before JSON parsing):

- `/api/chart`, `/api/interpret`, `/api/heming`: **`128 KiB` (`131072` bytes)**
- `/api/billing/checkout`, `/api/billing/webhook`: **`32 KiB` (`32768` bytes)**

### Localization (`lang`)

- Supported values: `'ru' | 'zh' | 'en'` (normalized via `normalizeLang` in `lib/ziwei/i18n.ts`).
- When `lang` is omitted (`undefined` or `null`) on HTTP API routes, it defaults to `'zh'` for backwards compatibility with existing clients. External localized frontends (such as Russian UIs) should pass `"lang": "ru"` explicitly.

---

## Canonical Keys, Schools & Year Suffixes (`cacheKey` / `pairKey` vs `entitlementKey`)

- **Natal chart cache key** (`getChartCacheKey(chart, { targetYear })`):
  - Without year: `ziwei:v1:<solarDate>:<hour>:<gender>:<brightnessSchool>:<leapMonthPolicy>` (`:default:` for `QS`, `:XD2:` for `XD2`, etc.)
  - With `targetYear`: `<base>:y<targetYear>` (for example `ziwei:v1:1990-05-15:4:male:XD2:split:y2026`)
- **Natal entitlement key** (`getChartEntitlementKey(chart)`):
  - Always normalized to `:default:` without `:y<targetYear>` (`ziwei:v1:<solarDate>:<hour>:<gender>:default:<leapMonthPolicy>`), so purchasing under `QS` or `XD2` unlocks both schools.
- **Synastry cache key** (`canonicalPairKey(chartA, chartB, targetYear)`):
  - Hashes sorted `getChartCacheKey` values (isolating `XD2` vs `QS` caches): `heming:v1:<sha256_32(first|second)>[:y<targetYear>]`
- **Synastry entitlement key** (`canonicalPairEntitlementKey(chartA, chartB)`):
  - Hashes sorted school-agnostic `getChartEntitlementKey` values (no `:y<targetYear>` suffix), keeping pair purchases valid across school switches.
- **Why both keys exist**:
  - `brightnessSchool` and `:y<targetYear>` in `cacheKey` / `pairKey` isolate school-specific and annual interpretations in Redis and PostgreSQL (`chart_interpretations`, `synastry_interpretations`) so `XD2` and `QS` never overwrite each other.
  - Billing (`checkout`, `webhook`, `verifyAccessToken`, `hasPaidEntitlement`) normalizes both `:y<targetYear>` and natal brightness school (`QS`, `XD1`, `ZZ`, `XD2` -> `:default:`) via `normalizeEntitlementKey`, so buying once unlocks timeless/annual queries across schools without `402`.

---

## HTTP Endpoints

### 1. `GET /api/health`

Checks PostgreSQL and Redis connectivity (reports in-memory fallback when unconfigured) and exposes non-sensitive server mode flags.

**Response (`200 OK`)**

```json
{
  "ok": true,
  "postgres": { "ok": true, "mode": "memory" },
  "redis": { "ok": true, "mode": "memory" },
  "aiProvider": "deepseek",
  "paywallMode": "strict"
}
```

---

### 2. `POST /api/chart` (`$0.00` Zero-LLM)

Generates deterministic natal charts or synastry comparisons, computes true solar time / historical IANA DST / CN DST warnings, detects patterns synchronously via `detectPatterns(chart)`, generates localized `freeLifePalace` readings (`命宫`), and returns localized pre-paywall teasers (`teasers`). Resolves localized city names via `findCityByQuery` (e.g., `"Москва"`, `"Moscow"`, `"莫斯科"`).

- **Time zone validation**: Any supplied `tz` query param (`?tz=...`), `timeZone` query param (`?timeZone=...`), top-level `tz`/`timeZone`, or nested `birthInfo.{tz,timeZone}` / `form.{tz,timeZone}` / `chart*.birthInfo.{tz,timeZone}` is strictly validated with `isValidTimeZone` / `[-720, 840]` offset bounds. Unknown zones or empty strings (such as `tz=Not/AZone`, `timeZone: "Not/AZone"`, or `form.timeZone: ""`) immediately return **`400 INVALID_INPUT`** (`invalid_timezone` / `invalid_birth_input` / `invalid_synastry_input`). Omit `timeZone` (and pass `utcOffsetMinutes` / numeric `tz`) when applying a manual fixed UTC offset.
- **Brightness school & active DaXian (`brightnessSchool`, `leapMonthPolicy`, `referenceDate` / `referenceYear`)**:
  - `brightnessSchool`: optional per-request school (`'default' | 'QS' | 'XD1' | 'ZZ' | 'XD2'`; invalid -> `400 INVALID_INPUT`). Defaults to `'default'` (`'QS'`) for backward compatibility. Dataset `v4.0-13d` report workflows must pass `"brightnessSchool": "XD2"` explicitly (does not mutate any global school state). The resolved school (`'QS' | 'XD1' | 'ZZ' | 'XD2'`) is returned on both `response.brightnessSchool` and `chart.brightnessSchool` and automatically scopes `cacheKey` / `entitlementKey`. See [`docs/DATASET-CALENDAR-CONTRACT.md`](./DATASET-CALENDAR-CONTRACT.md).
  - `leapMonthPolicy`: optional `'split' | 'next-month' | 'prev-month' | 'origin-month'` (defaults to `'split'`).
  - `referenceDate` (`YYYY-MM-DD`) / `referenceYear` (integer `100..9999`): optional calculation reference for deterministic `chart.currentAge` / `chart.currentDaXianIndex` / active `DaXian` period.
- **Body limit**: `128 KiB` (`413 PAYLOAD_TOO_LARGE` when exceeded).

#### Natal Mode Request

Accepts either `birthInfo` (numeric `hour` branch index `0..11`) or UI `form` (`BirthFormState` with clock `hour`/`minute`):

```json
{
  "lang": "ru",
  "lateZishi": "next-day",
  "brightnessSchool": "XD2",
  "referenceDate": "2026-06-15",
  "targetYear": 2026,
  "birthInfo": {
    "year": 1992,
    "month": 6,
    "day": 15,
    "hour": 6,
    "gender": "male",
    "city": "Москва"
  }
}
```

#### Natal Mode Response (`200 OK`)

```json
{
  "ok": true,
  "mode": "natal",
  "lang": "ru",
  "brightnessSchool": "XD2",
  "leapMonthPolicy": "split",
  "cacheKey": "ziwei:v1:1992-06-15:6:male:XD2:split:y2026",
  "entitlementKey": "ziwei:v1:1992-06-15:6:male:XD2:split",
  "chart": { "...": "ZiweiChart" },
  "summary": { "...": "ChartAnalysisSummary" },
  "patterns": [ { "...": "Pattern" } ],
  "freeLifePalace": {
    "lang": "ru",
    "palaceName": "...",
    "archetypeTitle": "...",
    "paragraphs": ["..."],
    "reading": "...",
    "keywords": ["..."]
  },
  "teasers": {
    "lang": "ru",
    "cacheKey": "ziwei:v1:1992-06-15:6:male:default:split:y2026",
    "freeLifePalace": { "...": "FreeLifePalaceReading" },
    "patterns": { "count": 2, "headline": "...", "items": [] },
    "lockedTeasers": [
      {
        "id": "...",
        "palaceKey": "财帛",
        "palaceName": "...",
        "category": "...",
        "severity": "high",
        "hookHeadline": "...",
        "teaser": "...",
        "unlockCta": "..."
      }
    ],
    "unlockCta": "..."
  },
  "localizedSummary": { "...": "TranslatedChartSummary" },
  "localizedPatterns": [ { "...": "TranslatedPatternSummary" } ],
  "hasCachedInterpretation": false
}
```

#### Synastry Mode Request & Response (`200 OK`)

Send pairs using `chartA`/`birthInfoA`/`formA` and `chartB`/`birthInfoB`/`formB` plus optional `lang` and `targetYear`. Returns:

```json
{
  "ok": true,
  "mode": "synastry",
  "lang": "ru",
  "brightnessSchool": "QS",
  "leapMonthPolicy": "split",
  "pairKey": "heming:v1:<32-hex>:y2026",
  "entitlementKey": "heming:v1:<32-hex>",
  "chartA": { "...": "ZiweiChart" },
  "chartB": { "...": "ZiweiChart" },
  "synastry": { "...": "SynastryResult" },
  "teasers": { "...": "SynastryPaywallResult" },
  "hasCachedInterpretation": false
}
```

---

### 3. `POST /api/billing/checkout`

Creates a `'pending'` order record in `orders`, generates a cryptographic `orderToken` capability secret (storing only its SHA-256 hash `claim_token_hash` in DB, never in `checkoutUrl`), and returns a checkout redirect descriptor.

- **Body limit**: `32 KiB` (`413 PAYLOAD_TOO_LARGE` when exceeded).

**Request**

```json
{
  "scope": "interpret",
  "targetKey": "ziwei:v1:1992-06-15:6:male:default:split",
  "provider": "yookassa",
  "currency": "RUB",
  "amountMinor": 99000,
  "returnUrl": "/chart?unlocked=true"
}
```

- `scope`: `'interpret' | 'heming' | 'bundle'`
- `targetKey` (required, or aliases: `chartKey` for `'interpret'`, `pairKey` for `'heming'`, either for `'bundle'`; any `:y<targetYear>` suffix and natal brightness school `QS|XD1|ZZ|XD2` are normalized to the canonical `entitlementKey` via `normalizeEntitlementKey`)
- `amountMinor` or `amount` (**required**; one of the two must be provided): `amountMinor` must be a **positive integer `> 0`**, or `amount` must be a **positive finite number** resolving to at least `1` minor unit. Missing, zero, or negative amounts are rejected with `400 INVALID_INPUT`.

**Response (`201 Created`, `Cache-Control: no-store`)**

```json
{
  "ok": true,
  "orderId": "ord_...",
  "orderToken": "<24-byte-base64url-capability-token>",
  "status": "pending",
  "provider": "yookassa",
  "scope": "interpret",
  "targetKey": "ziwei:v1:1992-06-15:6:male:default:split",
  "checkoutUrl": "http://localhost:3000/checkout?orderId=ord_...&scope=interpret&targetKey=...&provider=yookassa",
  "createdAt": "2026-11-15T10:30:00.000Z",
  "amountMinor": 99000,
  "currency": "RUB"
}
```

- Store `orderToken` on the initiating client session (or server backend) and pass it via `Authorization: Bearer <orderToken>` or `x-order-token` headers when polling `GET /api/billing/order` (`?orderToken=` in query URLs is intentionally unsupported to prevent secret leakage into URL logs).
- Errors: `400 INVALID_INPUT` / `BAD_REQUEST`, `413 PAYLOAD_TOO_LARGE`, `503 BILLING_UNCONFIGURED`.

---

### 4. `POST /api/billing/webhook`

Verifies HMAC-SHA256 webhook signature (`x-webhook-signature` or `x-signature`, formatted as `sha256=<hex>` or `<hex>`) using `PAYWALL_WEBHOOK_SECRET`, atomically updates `'pending'` orders to `'paid'` (preserving `claim_token_hash`, or inserts new orders idempotently via `webhook_events`), and issues a signed HS256 `accessToken`.

- **Body limit**: `32 KiB` (`413 PAYLOAD_TOO_LARGE` when exceeded).

**Request**

```json
{
  "eventId": "evt_123456",
  "orderId": "ord_...",
  "scope": "interpret",
  "targetKey": "ziwei:v1:1992-06-15:6:male:default:split",
  "status": "paid",
  "amountMinor": 99000,
  "currency": "RUB",
  "provider": "yookassa"
}
```

- If `amountMinor` is included, it must be a positive integer (`> 0`). Any `:y<targetYear>` suffix and natal brightness school in `targetKey` are normalized cleanly via `normalizeEntitlementKey`.

**Response (`200 OK`)**

- If `status === 'paid'`:
  ```json
  {
    "ok": true,
    "orderId": "ord_...",
    "scope": "interpret",
    "targetKey": "ziwei:v1:1992-06-15:6:male:default:split",
    "idempotent": false,
    "accessToken": "<hs256-jwt>"
  }
  ```
- If `status !== 'paid'`: `{ "ok": true, "orderId": "...", "scope": "...", "targetKey": "...", "status": "...", "granted": false, "accessToken": null }`.
- Errors: `401 UNAUTHORIZED` (invalid signature), `400 INVALID_INPUT` / `BAD_REQUEST`, `413 PAYLOAD_TOO_LARGE`, `503 WEBHOOK_UNCONFIGURED` / `TOKEN_UNCONFIGURED`.

---

### 5. `GET /api/billing/order?orderId=<orderId>`

Polls payment state for frontend return URLs. **Requires authorization** via `orderToken` issued by `POST /api/billing/checkout` (passed strictly via HTTP headers, never as a query param, and never exposing `accessToken` until `status === 'paid'`). Returns a uniform `401 UNAUTHORIZED` response for missing/invalid `orderToken` **and** for unknown `orderId`s so attackers cannot enumerate existing orders.

**Headers (Required)**: `Authorization: Bearer <orderToken>` or `x-order-token: <orderToken>` (query param `?orderToken=` is ignored)

**Responses (`Cache-Control: no-store`)**

- Pending / non-paid (`200 OK`):
  ```json
  {
    "ok": true,
    "orderId": "ord_...",
    "status": "pending",
    "paid": false,
    "scope": "interpret",
    "targetKey": "ziwei:v1:1992-06-15:6:male:default:split",
    "provider": "yookassa",
    "createdAt": "2026-11-15T10:30:00.000Z"
  }
  ```
- Paid (`200 OK`):
  ```json
  {
    "ok": true,
    "orderId": "ord_...",
    "status": "paid",
    "paid": true,
    "scope": "interpret",
    "targetKey": "ziwei:v1:1992-06-15:6:male:default:split",
    "accessToken": "<hs256-jwt>",
    "provider": "yookassa",
    "createdAt": "2026-11-15T10:30:00.000Z",
    "paidAt": "2026-11-15T10:31:00.000Z"
  }
  ```
- Errors: `400 INVALID_INPUT` (missing `orderId`), `401 UNAUTHORIZED` (uniformly returned for missing/invalid `orderToken` and unknown `orderId`), `503 TOKEN_UNCONFIGURED`.

---

### 6. `POST /api/interpret` (Paid SSE Stream)

Streams full AI chart interpretations in `text/event-stream` format using language-specific system prompts (`lib/server/llm.ts`) and two-layer language- & year-isolated caching (Redis + PostgreSQL).

- **Headers**: in `AI_PAYWALL_MODE=strict`, requires `Authorization: Bearer <accessToken>` (or JSON body `accessToken`).
- **Body limit**: `128 KiB` (`413 PAYLOAD_TOO_LARGE` when exceeded).

**Request**

```json
{
  "lang": "ru",
  "targetYear": 2026,
  "chart": { "...": "ZiweiChart" },
  "messages": [
    { "role": "user", "content": "Разбери карьеру и финансы на 2026 год." }
  ],
  "accessToken": "<optional-hs256-jwt-if-not-in-header>"
}
```

**Responses**

- `200 OK`: `Content-Type: text/event-stream; charset=utf-8`, `X-Cache: HIT | MISS`.
- `400 INVALID_INPUT` / `BAD_REQUEST` (including invalid/empty `?tz=`, `?timeZone=`, `tz`, `timeZone`, or `chart.birthInfo.{tz,timeZone}`).
- `402 Payment Required`: `{ "error": "payment_required", "code": "PAYWALL_LOCKED", "cacheKey": "<chartKey>", "entitlementKey": "<baseChartKey>" }`.
- `413 PAYLOAD_TOO_LARGE`: body exceeds `128 KiB`.
- `429 Too Many Requests`: `{ "error": "rate_limit_exceeded", "code": "RATE_LIMITED" }` + `Retry-After` header.
- `502 LLM_UPSTREAM_ERROR` / `503 LLM_CONFIG_ERROR`.

---

### 7. `POST /api/heming` (Preview Zero-LLM or Paid SSE Synastry)

Computes two-person synastry (`analyzeSynastry`) and either returns a Zero-LLM teaser preview (`previewOnly: true`) or streams a localized AI compatibility reading (`text/event-stream`).

- **Body limit**: `128 KiB` (`413 PAYLOAD_TOO_LARGE` when exceeded).

**Request**

```json
{
  "lang": "ru",
  "previewOnly": true,
  "targetYear": 2026,
  "chartA": { "...": "ZiweiChart" },
  "chartB": { "...": "ZiweiChart" },
  "question": "Совместимость в браке и общих проектах",
  "accessToken": "<optional-for-paid-mode>"
}
```

**Responses**

- `previewOnly: true` (`200 OK`, `$0.00` LLM; still validates `?tz=`/`?timeZone=` and `chartA/chartB.birthInfo.{tz,timeZone}` -> `400`):
  ```json
  {
    "ok": true,
    "lang": "ru",
    "pairKey": "heming:v1:<32-hex>:y2026",
    "entitlementKey": "heming:v1:<32-hex>",
    "synastry": { "...": "SynastryResult" },
    "overview": "...",
    "teasers": { "...": "SynastryPaywallResult" }
  }
  ```
- Paid mode (`previewOnly` omitted or `false`, requires valid `accessToken` in `AI_PAYWALL_MODE=strict`):
  - `200 OK`: `Content-Type: text/event-stream; charset=utf-8`, `X-Cache: HIT | MISS`.
  - `400 INVALID_INPUT` / `BAD_REQUEST` (including invalid/empty `?tz=`, `?timeZone=`, `tz`, `timeZone`, or `chartA/chartB.birthInfo.{tz,timeZone}`).
  - `402 Payment Required`: `{ "error": "payment_required", "code": "PAYWALL_LOCKED", "pairKey": "<pairKey>", "entitlementKey": "<basePairKey>" }`.
  - `413 PAYLOAD_TOO_LARGE` / `429 RATE_LIMITED` / `502 LLM_UPSTREAM_ERROR` / `503 LLM_CONFIG_ERROR`.

---

## Error Code Reference (`503` & Security Status Codes)

| Status | Endpoint(s) | `code` | `error` | Meaning |
|---|---|---|---|---|
| `400` | All POST/order | `BAD_REQUEST` / `INVALID_INPUT` | `invalid_*` / `missing_order_id` | Malformed JSON/body, invalid/empty date or zone (`tz=Not/AZone`, `form.timeZone: ""`), or missing/non-positive checkout amount |
| `401` | `/api/billing/webhook`, `/api/billing/order` | `UNAUTHORIZED` | `invalid_signature` / `unauthorized` | Missing/bad webhook HMAC, missing/bad `orderToken`, or unknown `orderId` (uniform response) |
| `402` | `/api/interpret`, `/api/heming` | `PAYWALL_LOCKED` | `payment_required` | Missing, expired, wrong-scope, or mismatched `accessToken` |
| `403` | All `OPTIONS` | `CORS_FORBIDDEN` | `cors_origin_denied` | Disallowed `Origin` header on preflight |
| `413` | All `POST` | `PAYLOAD_TOO_LARGE` | `payload_too_large` | Body exceeds `128 KiB` (`/chart`, `/interpret`, `/heming`) or `32 KiB` (`/billing/*`) |
| `429` | `/chart`, `/interpret`, `/heming` | `RATE_LIMITED` | `rate_limit_exceeded` | Per-IP rate limit exceeded (`Retry-After` set) |
| `502` | `/interpret`, `/heming` | `LLM_UPSTREAM_ERROR` | `llm_upstream_error` | Upstream LLM provider error |
| `503` | `/interpret`, `/heming` | `LLM_CONFIG_ERROR` | `llm_not_configured` | Missing/invalid AI provider API key, model, or base URL |
| `503` | `/billing/checkout` | `BILLING_UNCONFIGURED` | `billing_checkout_unconfigured` | Invalid `BILLING_CHECKOUT_BASE_URL` / `APP_PUBLIC_URL` configuration |
| `503` | `/billing/order`, `/billing/webhook` | `TOKEN_UNCONFIGURED` | `access_token_not_configured` | Missing `ACCESS_TOKEN_SECRET` |
| `503` | `/billing/webhook` | `WEBHOOK_UNCONFIGURED` | `webhook_not_configured` | Missing `PAYWALL_WEBHOOK_SECRET` |

---

## Database Persistence (`db/schema.sql`)

Apply `db/schema.sql` against PostgreSQL before enabling `DATABASE_URL`:

- `webhook_events` (`event_id`, `provider`, `order_id`, `processed_at`) — webhook replay idempotency.
- `orders` (`order_id`, `scope`, `target_key`, `status`, `amount_minor`, `currency`, `provider`, `checkout_url`, `claim_token_hash`, `meta`, `created_at`, `paid_at`, `updated_at`) — billing order lifecycle (`pending` -> `paid`) with hashed capability token verification.
- `chart_interpretations` (`PRIMARY KEY (cache_key, topic_key)`) — natal LLM cache (`cache_key` carries optional `:y<targetYear>`, `topic_key` is unprefixed for `zh` and `<lang>:<topicKey>` for `ru`/`en`).
- `synastry_interpretations` (`PRIMARY KEY (pair_key, question_hash)`) — synastry LLM cache (`pair_key` carries optional `:y<targetYear>`, `question_hash` is unprefixed for `zh` and `<lang>:<hash>` for `ru`/`en`).

---

## Headless Engine Usage (Node / TypeScript Workers)

All modules in `lib/ziwei/` run directly in Node/`tsx` without Next.js or `server-only`:

```ts
import { generateChart, generateDatasetChart } from './lib/ziwei/algorithm';
import { findCityByQuery } from './lib/ziwei/cities';
import { detectPatterns } from './lib/ziwei/patterns';
import {
  analyzeChartSummary,
  getChartCacheKey,
  getChartEntitlementKey,
} from './lib/ziwei/chart-analyzer';
import { generateChartTeasers } from './lib/ziwei/paywall-teasers';
import { translateChartSummary } from './lib/ziwei/i18n';

const match = findCityByQuery('Москва', 'ru');
const chart = generateDatasetChart(
  {
    year: 1992,
    month: 6,
    day: 15,
    hour: 6,
    gender: 'male',
    province: match?.provinceName,
    city: match?.city.name,
    longitude: match?.city.longitude,
    utcOffsetMinutes: match?.city.utcOffsetMinutes,
    timeZone: match?.city.timeZone,
  },
  { referenceDate: '2026-06-15' },
);
// Or explicitly: generateChart(birthInfo, { brightnessSchool: 'XD2', referenceYear: 2026 })

const summary = analyzeChartSummary(chart, { targetYear: 2026 });
const patterns = detectPatterns(chart);
const teasers = generateChartTeasers(chart, summary, patterns, 'ru');
const localized = translateChartSummary(chart, summary, patterns, 'ru');
const cacheKey = getChartCacheKey(chart, { targetYear: 2026 });       // ziwei:v1:...:XD2:split:y2026
const entitlementKey = getChartEntitlementKey(chart);                  // ziwei:v1:...:default:split (school- & year-agnostic)
```
