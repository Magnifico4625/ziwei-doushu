# Zi Wei Dou Shu Backend & Engine API Reference

This document specifies the HTTP API routes, billing lifecycle, CORS configuration, persistence schema, and headless TypeScript/Node engine exports built into `Magnifico4625/ziwei-doushu`.

**Core Design Invariants**

1. **Zero-LLM Pre-Paywall (`$0.00` AI cost)**: `POST /api/chart` and `POST /api/heming` with `previewOnly: true` compute deterministic charts, classical patterns, Life Palace (`命宫`) free readings, and paywall teasers without importing `lib/server/llm.ts` or invoking any LLM.
2. **Strict Paywall Guard**: With `AI_PAYWALL_MODE=strict` (default), paid endpoints (`/api/interpret`, full `/api/heming`) verify entitlement (`accessToken` or DB `paid` order) **before** reading paid cache or calling any LLM, returning `402 PAYWALL_LOCKED` on unauthorized requests.
3. **Language-Agnostic Entitlements + Language-Isolated Caches**: Payment entitlements bind to canonical chart/pair hashes (`cacheKey` / `pairKey`), so switching UI `lang` after purchase keeps access valid, while Redis and PostgreSQL text caches are isolated per language (`ru`, `zh`, `en`).
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

## CORS & Preflight (`lib/server/cors.ts`)

All 7 `/api/*` routes export `OPTIONS` preflight handlers and wrap every response (JSON, errors, and `ReadableStream` SSE) with `withCors(request, response)`:

- **Allowed Methods**: `GET, POST, OPTIONS`
- **Allowed Request Headers**: `Content-Type, Authorization, X-Requested-With, X-Webhook-Signature, X-Signature`
- **Exposed Response Headers**: `X-Cache, Retry-After`
- **Preflight Behavior**:
  - Allowed `Origin` (matching `ALLOWED_ORIGINS` or `*`) or absent `Origin` -> `204 No Content`.
  - Disallowed `Origin` -> `403` JSON `{ "error": "cors_origin_denied", "code": "CORS_FORBIDDEN" }`.

---

## Localization (`lang`)

- Supported values: `'ru' | 'zh' | 'en'` (normalized via `normalizeLang` in `lib/ziwei/i18n.ts`).
- When `lang` is omitted (`undefined` or `null`) on HTTP API routes, it defaults to `'zh'` for backwards compatibility with existing clients. External localized frontends (such as Russian UIs) should pass `"lang": "ru"` explicitly.

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

#### Natal Mode Request

Accepts either `birthInfo` (numeric `hour` branch index `0..11`) or UI `form` (`BirthFormState` with clock `hour`/`minute`):

```json
{
  "lang": "ru",
  "lateZishi": "next-day",
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
  "cacheKey": "<sha256-chart-key>",
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
    "cacheKey": "<sha256-chart-key>",
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
  "pairKey": "<canonical-pair-key>",
  "chartA": { "...": "ZiweiChart" },
  "chartB": { "...": "ZiweiChart" },
  "synastry": { "...": "SynastryResult" },
  "teasers": { "...": "SynastryPaywallResult" },
  "hasCachedInterpretation": false
}
```

---

### 3. `POST /api/billing/checkout`

Creates a `'pending'` order record in `orders` and returns a checkout redirect descriptor.

**Request**

```json
{
  "scope": "interpret",
  "targetKey": "<cacheKey-or-pairKey>",
  "provider": "yookassa",
  "currency": "RUB",
  "amountMinor": 99000,
  "returnUrl": "/chart?unlocked=true"
}
```

- `scope`: `'interpret' | 'heming' | 'bundle'`
- `targetKey` (required, or aliases: `chartKey` for `'interpret'`, `pairKey` for `'heming'`, either for `'bundle'`)
- `amountMinor` (non-negative integer) or `amount` (number converted to minor units)

**Response (`201 Created`, `Cache-Control: no-store`)**

```json
{
  "ok": true,
  "orderId": "ord_...",
  "status": "pending",
  "provider": "yookassa",
  "scope": "interpret",
  "targetKey": "<cacheKey>",
  "checkoutUrl": "http://localhost:3000/checkout?orderId=ord_...&scope=interpret&targetKey=...&provider=yookassa",
  "createdAt": "2026-11-15T10:30:00.000Z",
  "amountMinor": 99000,
  "currency": "RUB"
}
```

---

### 4. `POST /api/billing/webhook`

Verifies HMAC-SHA256 webhook signature (`x-webhook-signature` or `x-signature`, formatted as `sha256=<hex>` or `<hex>`) using `PAYWALL_WEBHOOK_SECRET`, atomically updates `'pending'` orders to `'paid'` (or inserts new orders idempotently via `webhook_events`), and issues a signed HS256 `accessToken`.

**Request**

```json
{
  "eventId": "evt_123456",
  "orderId": "ord_...",
  "scope": "interpret",
  "targetKey": "<cacheKey>",
  "status": "paid",
  "amountMinor": 99000,
  "currency": "RUB",
  "provider": "yookassa"
}
```

**Response (`200 OK`)**

- If `status === 'paid'`:
  ```json
  {
    "ok": true,
    "orderId": "ord_...",
    "scope": "interpret",
    "targetKey": "<cacheKey>",
    "idempotent": false,
    "accessToken": "<hs256-jwt>"
  }
  ```
- If `status !== 'paid'`: `{ "ok": true, "orderId": "...", "scope": "...", "targetKey": "...", "status": "...", "granted": false, "accessToken": null }`.
- Errors: `401 UNAUTHORIZED` (invalid signature), `400 INVALID_INPUT` / `BAD_REQUEST`, `503 WEBHOOK_UNCONFIGURED` / `TOKEN_UNCONFIGURED`.

---

### 5. `GET /api/billing/order?orderId=<orderId>`

Polls payment state for frontend return URLs. Never exposes `accessToken` until `status === 'paid'`.

**Responses (`Cache-Control: no-store`)**

- Pending / non-paid (`200 OK`):
  ```json
  {
    "ok": true,
    "orderId": "ord_...",
    "status": "pending",
    "paid": false,
    "scope": "interpret",
    "targetKey": "<cacheKey>",
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
    "targetKey": "<cacheKey>",
    "accessToken": "<hs256-jwt>",
    "provider": "yookassa",
    "createdAt": "2026-11-15T10:30:00.000Z",
    "paidAt": "2026-11-15T10:31:00.000Z"
  }
  ```
- Errors: `400 INVALID_INPUT` (missing `orderId`), `404 NOT_FOUND` (unknown order), `503 TOKEN_UNCONFIGURED`.

---

### 6. `POST /api/interpret` (Paid SSE Stream)

Streams full AI chart interpretations in `text/event-stream` format using language-specific system prompts (`lib/server/llm.ts`) and two-layer language-isolated caching (Redis + PostgreSQL).

**Headers**: optional `Authorization: Bearer <accessToken>` (takes precedence over body `accessToken`).

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
- `402 Payment Required`: `{ "error": "payment_required", "code": "PAYWALL_LOCKED", "cacheKey": "<chartKey>" }` (triggered when `AI_PAYWALL_MODE=strict` and neither valid token nor paid order exists).
- `429 Too Many Requests`: `{ "error": "rate_limit_exceeded", "code": "RATE_LIMITED" }` + `Retry-After` header.
- `502 LLM_UPSTREAM_ERROR` / `503 LLM_UNCONFIGURED` / `400 INVALID_INPUT`.

---

### 7. `POST /api/heming` (Preview Zero-LLM or Paid SSE Synastry)

Computes two-person synastry (`analyzeSynastry`) and either returns a Zero-LLM teaser preview (`previewOnly: true`) or streams a localized AI compatibility reading (`text/event-stream`).

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

- `previewOnly: true` (`200 OK`, `$0.00` LLM):
  ```json
  {
    "ok": true,
    "lang": "ru",
    "pairKey": "<pairKey>",
    "synastry": { "...": "SynastryResult" },
    "overview": "...",
    "teasers": { "...": "SynastryPaywallResult" }
  }
  ```
- Paid mode (`previewOnly` omitted or `false`):
  - `200 OK`: `Content-Type: text/event-stream; charset=utf-8`, `X-Cache: HIT | MISS`.
  - `402 Payment Required`: `{ "error": "payment_required", "code": "PAYWALL_LOCKED", "pairKey": "<pairKey>" }`.

---

## Database Persistence (`db/schema.sql`)

Apply `db/schema.sql` against PostgreSQL before enabling `DATABASE_URL`:

- `webhook_events` (`event_id`, `provider`, `order_id`, `processed_at`) — webhook replay idempotency.
- `orders` (`order_id`, `scope`, `target_key`, `status`, `amount_minor`, `currency`, `provider`, `checkout_url`, `meta`, `created_at`, `paid_at`, `updated_at`) — billing order lifecycle (`pending` -> `paid`).
- `chart_interpretations` (`PRIMARY KEY (cache_key, topic_key)`) — natal LLM cache (`topic_key` is unprefixed for `zh` and `<lang>:<topicKey>` for `ru`/`en`).
- `synastry_interpretations` (`PRIMARY KEY (pair_key, question_hash)`) — synastry LLM cache (`question_hash` is unprefixed for `zh` and `<lang>:<hash>` for `ru`/`en`).

---

## Headless Engine Usage (Node / TypeScript Workers)

All modules in `lib/ziwei/` run directly in Node/`tsx` without Next.js or `server-only`:

```ts
import { generateChart } from './lib/ziwei/algorithm';
import { findCityByQuery } from './lib/ziwei/cities';
import { detectPatterns } from './lib/ziwei/patterns';
import { analyzeChartSummary, getChartCacheKey } from './lib/ziwei/chart-analyzer';
import { generateChartTeasers } from './lib/ziwei/paywall-teasers';
import { translateChartSummary } from './lib/ziwei/i18n';

const match = findCityByQuery('Москва', 'ru');
const chart = generateChart({
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
});

const summary = analyzeChartSummary(chart, { targetYear: 2026 });
const patterns = detectPatterns(chart);
const teasers = generateChartTeasers(chart, summary, patterns, 'ru');
const localized = translateChartSummary(chart, summary, patterns, 'ru');
const chartKey = getChartCacheKey(chart, { targetYear: 2026 });
```
