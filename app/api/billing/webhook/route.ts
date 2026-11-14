import { getServerConfig } from '@/lib/server/env';
import {
  signAccessToken,
  verifyWebhookSignature,
  type EntitlementScope,
} from '@/lib/server/access-token';
import { recordWebhookOrderIfNew } from '@/lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

function jsonError(status: number, error: string, code: string, message?: string): Response {
  return Response.json(
    {
      error,
      code,
      ...(message ? { message } : {}),
    },
    { status },
  );
}

export async function POST(req: Request): Promise<Response> {
  const cfg = getServerConfig();
  if (!cfg.paywallWebhookSecret) {
    return jsonError(
      503,
      'webhook_not_configured',
      'WEBHOOK_UNCONFIGURED',
      'Payment webhook verification is not configured on the server.',
    );
  }

  const rawBody = await req.text();
  const signatureHeader =
    req.headers.get('x-webhook-signature')?.trim() ||
    req.headers.get('x-signature')?.trim() ||
    null;

  if (!verifyWebhookSignature(rawBody, signatureHeader, cfg.paywallWebhookSecret)) {
    return jsonError(401, 'invalid_signature', 'UNAUTHORIZED', 'Invalid webhook signature.');
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return jsonError(400, 'invalid_json', 'BAD_REQUEST', 'Webhook body must be valid JSON.');
  }

  if (!isPlainRecord(parsedBody)) {
    return jsonError(400, 'invalid_payload', 'BAD_REQUEST', 'Webhook body must be a JSON object.');
  }

  const eventId = nonEmptyString(parsedBody.eventId);
  const orderId = nonEmptyString(parsedBody.orderId);
  const targetKey = nonEmptyString(parsedBody.targetKey);
  const status = nonEmptyString(parsedBody.status);
  const scope = parsedBody.scope;

  if (!eventId || !orderId || !targetKey || !status || !isEntitlementScope(scope)) {
    return jsonError(
      400,
      'invalid_webhook_fields',
      'INVALID_INPUT',
      'Required fields: eventId, orderId, scope (interpret|heming|bundle), targetKey, status.',
    );
  }

  let amountMinor: number | undefined;
  if (parsedBody.amountMinor !== undefined && parsedBody.amountMinor !== null) {
    if (
      typeof parsedBody.amountMinor !== 'number' ||
      !Number.isInteger(parsedBody.amountMinor) ||
      parsedBody.amountMinor < 0
    ) {
      return jsonError(400, 'invalid_amount', 'INVALID_INPUT', 'amountMinor must be a non-negative integer.');
    }
    amountMinor = parsedBody.amountMinor;
  }

  let currency: string | undefined;
  if (parsedBody.currency !== undefined && parsedBody.currency !== null) {
    const parsedCurrency = nonEmptyString(parsedBody.currency);
    if (!parsedCurrency) {
      return jsonError(400, 'invalid_currency', 'INVALID_INPUT', 'currency must be a non-empty string.');
    }
    currency = parsedCurrency;
  }

  let provider: string | undefined;
  if (parsedBody.provider !== undefined && parsedBody.provider !== null) {
    const parsedProvider = nonEmptyString(parsedBody.provider);
    if (!parsedProvider) {
      return jsonError(400, 'invalid_provider', 'INVALID_INPUT', 'provider must be a non-empty string.');
    }
    provider = parsedProvider;
  }

  let meta: Record<string, unknown> | undefined;
  if (parsedBody.meta !== undefined && parsedBody.meta !== null) {
    if (!isPlainRecord(parsedBody.meta)) {
      return jsonError(400, 'invalid_meta', 'INVALID_INPUT', 'meta must be a plain object.');
    }
    meta = parsedBody.meta;
  }

  if (status !== 'paid') {
    return Response.json(
      {
        ok: true,
        orderId,
        scope,
        targetKey,
        status,
        granted: false,
        accessToken: null,
      },
      { status: 200 },
    );
  }

  if (!cfg.accessTokenSecret) {
    return jsonError(
      503,
      'access_token_not_configured',
      'TOKEN_UNCONFIGURED',
      'Access token signing is not configured on the server.',
    );
  }

  const { inserted, order } = await recordWebhookOrderIfNew({
    eventId,
    orderId,
    scope,
    targetKey,
    status: 'paid',
    amountMinor,
    currency,
    provider,
    meta,
  });

  const accessToken = signAccessToken(
    {
      scope: order.scope,
      targetKey: order.targetKey,
      orderId: order.orderId,
    },
    cfg.accessTokenSecret,
  );

  return Response.json(
    {
      ok: true,
      orderId: order.orderId,
      scope: order.scope,
      targetKey: order.targetKey,
      idempotent: !inserted,
      accessToken,
    },
    { status: 200 },
  );
}
