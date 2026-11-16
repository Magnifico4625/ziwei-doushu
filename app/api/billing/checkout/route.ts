import { randomUUID } from 'node:crypto';
import { getServerEnv } from '@/lib/server/env';
import {
  generateOrderToken,
  hashOrderToken,
  type EntitlementScope,
} from '@/lib/server/access-token';
import { handleCorsPreflight, withCors } from '@/lib/server/cors';
import { createPendingOrder } from '@/lib/server/db';
import { MAX_BILLING_BODY_BYTES, readJsonBodyWithLimit } from '@/lib/server/request-body';
import { normalizeEntitlementKey } from '@/lib/ziwei/chart-analyzer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEntitlementScope(value: unknown): value is EntitlementScope {
  return value === 'interpret' || value === 'heming' || value === 'bundle';
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function jsonError(
  req: Request,
  status: number,
  error: string,
  code: string,
  message?: string,
): Response {
  return withCors(
    req,
    Response.json(
      {
        error,
        code,
        ...(message ? { message } : {}),
      },
      { status, headers: NO_STORE_HEADERS },
    ),
  );
}

function resolveTargetKey(
  scope: EntitlementScope,
  body: Record<string, unknown>,
): { ok: true; value: string } | { ok: false; message: string } {
  if (body.targetKey !== undefined && body.targetKey !== null) {
    const parsed = nonEmptyString(body.targetKey);
    if (!parsed) {
      return { ok: false, message: 'targetKey must be a non-empty string.' };
    }
    return { ok: true, value: parsed };
  }

  if (scope === 'interpret') {
    const chartKey = nonEmptyString(body.chartKey);
    if (!chartKey) {
      return { ok: false, message: 'targetKey or chartKey is required for interpret checkout.' };
    }
    return { ok: true, value: chartKey };
  }

  if (scope === 'heming') {
    const pairKey = nonEmptyString(body.pairKey);
    if (!pairKey) {
      return { ok: false, message: 'targetKey or pairKey is required for heming checkout.' };
    }
    return { ok: true, value: pairKey };
  }

  const bundleTarget = nonEmptyString(body.chartKey) ?? nonEmptyString(body.pairKey);
  if (!bundleTarget) {
    return { ok: false, message: 'targetKey, chartKey, or pairKey is required for bundle checkout.' };
  }
  return { ok: true, value: bundleTarget };
}

function isSafeReturnUrl(raw: string): boolean {
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    return true;
  }
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function buildCheckoutUrl(params: {
  baseUrl: string;
  orderId: string;
  scope: EntitlementScope;
  targetKey: string;
  provider: string;
  returnUrl?: string;
}): string {
  const url = new URL(params.baseUrl);
  url.searchParams.set('orderId', params.orderId);
  url.searchParams.set('scope', params.scope);
  url.searchParams.set('targetKey', params.targetKey);
  url.searchParams.set('provider', params.provider);
  if (params.returnUrl) {
    url.searchParams.set('returnUrl', params.returnUrl);
  }
  return url.toString();
}

export async function OPTIONS(req: Request): Promise<Response> {
  return handleCorsPreflight(req);
}

export async function POST(req: Request): Promise<Response> {
  const bodyResult = await readJsonBodyWithLimit(req, MAX_BILLING_BODY_BYTES);
  if (!bodyResult.ok) {
    return jsonError(req, bodyResult.status, bodyResult.error, bodyResult.code, bodyResult.message);
  }
  const rawBody = bodyResult.value;

  const scope = rawBody.scope;
  if (!isEntitlementScope(scope)) {
    return jsonError(
      req,
      400,
      'invalid_scope',
      'INVALID_INPUT',
      "scope must be one of 'interpret', 'heming', or 'bundle'.",
    );
  }

  const targetResult = resolveTargetKey(scope, rawBody);
  if (!targetResult.ok) {
    return jsonError(req, 400, 'invalid_target_key', 'INVALID_INPUT', targetResult.message);
  }
  const targetKey = normalizeEntitlementKey(targetResult.value);
  if (targetKey.length > 512) {
    return jsonError(req, 400, 'invalid_target_key', 'INVALID_INPUT', 'targetKey exceeds maximum length.');
  }

  const cfg = getServerEnv();

  let provider = cfg.billingProvider;
  if (rawBody.provider !== undefined && rawBody.provider !== null) {
    const parsedProvider = nonEmptyString(rawBody.provider);
    if (!parsedProvider) {
      return jsonError(req, 400, 'invalid_provider', 'INVALID_INPUT', 'provider must be a non-empty string.');
    }
    provider = parsedProvider;
  }

  let currency: string | undefined;
  if (rawBody.currency !== undefined && rawBody.currency !== null) {
    const parsedCurrency = nonEmptyString(rawBody.currency);
    if (!parsedCurrency) {
      return jsonError(req, 400, 'invalid_currency', 'INVALID_INPUT', 'currency must be a non-empty string.');
    }
    currency = parsedCurrency.toUpperCase();
  }

  let amountMinor: number;
  if (rawBody.amountMinor !== undefined && rawBody.amountMinor !== null) {
    if (
      typeof rawBody.amountMinor !== 'number' ||
      !Number.isInteger(rawBody.amountMinor) ||
      rawBody.amountMinor <= 0
    ) {
      return jsonError(
        req,
        400,
        'invalid_amount',
        'INVALID_INPUT',
        'amountMinor must be a positive integer.',
      );
    }
    amountMinor = rawBody.amountMinor;
  } else if (rawBody.amount !== undefined && rawBody.amount !== null) {
    if (
      typeof rawBody.amount !== 'number' ||
      !Number.isFinite(rawBody.amount) ||
      rawBody.amount <= 0
    ) {
      return jsonError(
        req,
        400,
        'invalid_amount',
        'INVALID_INPUT',
        'amount must be a positive finite number.',
      );
    }
    const converted = Number.isInteger(rawBody.amount)
      ? rawBody.amount
      : Math.round(rawBody.amount * 100);
    if (!Number.isSafeInteger(converted) || converted <= 0) {
      return jsonError(
        req,
        400,
        'invalid_amount',
        'INVALID_INPUT',
        'amount must resolve to a positive integer minor amount.',
      );
    }
    amountMinor = converted;
  } else {
    return jsonError(
      req,
      400,
      'invalid_amount',
      'INVALID_INPUT',
      'amountMinor or amount is required and must be positive.',
    );
  }

  let returnUrl: string | undefined;
  if (rawBody.returnUrl !== undefined && rawBody.returnUrl !== null) {
    const parsedReturnUrl = nonEmptyString(rawBody.returnUrl);
    if (!parsedReturnUrl || !isSafeReturnUrl(parsedReturnUrl)) {
      return jsonError(
        req,
        400,
        'invalid_return_url',
        'INVALID_INPUT',
        'returnUrl must be a relative path or http(s) URL.',
      );
    }
    returnUrl = parsedReturnUrl;
  }

  let meta: Record<string, unknown> | undefined;
  if (rawBody.meta !== undefined && rawBody.meta !== null) {
    if (!isPlainRecord(rawBody.meta)) {
      return jsonError(req, 400, 'invalid_meta', 'INVALID_INPUT', 'meta must be a plain object.');
    }
    meta = { ...rawBody.meta };
  }
  if (returnUrl) {
    meta = { ...(meta ?? {}), returnUrl };
  }

  const checkoutBase =
    cfg.billingCheckoutBaseUrl ?? `${cfg.appPublicUrl.replace(/\/+$/, '')}/checkout`;
  const orderId = `ord_${randomUUID().replace(/-/g, '')}`;
  const orderToken = generateOrderToken();
  const claimTokenHash = hashOrderToken(orderToken);

  let checkoutUrl: string;
  try {
    checkoutUrl = buildCheckoutUrl({
      baseUrl: checkoutBase,
      orderId,
      scope,
      targetKey,
      provider,
      returnUrl,
    });
  } catch {
    return jsonError(
      req,
      503,
      'billing_checkout_unconfigured',
      'BILLING_UNCONFIGURED',
      'Billing checkout URL configuration is invalid.',
    );
  }

  const order = await createPendingOrder({
    orderId,
    scope,
    targetKey,
    amountMinor,
    currency,
    provider,
    checkoutUrl,
    claimTokenHash,
    meta,
  });

  return withCors(
    req,
    Response.json(
      {
        ok: true,
        orderId: order.orderId,
        orderToken,
        status: order.status,
        provider: order.provider ?? provider,
        scope: order.scope,
        targetKey: order.targetKey,
        checkoutUrl,
        createdAt: order.createdAt.toISOString(),
        ...(order.amountMinor !== undefined ? { amountMinor: order.amountMinor } : {}),
        ...(order.currency !== undefined ? { currency: order.currency } : {}),
      },
      { status: 201, headers: NO_STORE_HEADERS },
    ),
  );
}
