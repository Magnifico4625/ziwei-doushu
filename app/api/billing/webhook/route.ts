import { getServerConfig } from '@/lib/server/env';
import {
  signAccessToken,
  verifyWebhookSignature,
  type EntitlementScope,
} from '@/lib/server/access-token';
import { handleCorsPreflight, withCors } from '@/lib/server/cors';
import { recordWebhookOrderIfNew } from '@/lib/server/db';
import { MAX_BILLING_BODY_BYTES, readTextBodyWithLimit } from '@/lib/server/request-body';
import { stripYearSuffixFromKey } from '@/lib/ziwei/chart-analyzer';

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
      { status },
    ),
  );
}

export async function OPTIONS(req: Request): Promise<Response> {
  return handleCorsPreflight(req);
}

export async function POST(req: Request): Promise<Response> {
  const cfg = getServerConfig();
  if (!cfg.paywallWebhookSecret) {
    return jsonError(
      req,
      503,
      'webhook_not_configured',
      'WEBHOOK_UNCONFIGURED',
      'Payment webhook verification is not configured on the server.',
    );
  }

  const bodyResult = await readTextBodyWithLimit(req, MAX_BILLING_BODY_BYTES);
  if (!bodyResult.ok) {
    return jsonError(req, bodyResult.status, bodyResult.error, bodyResult.code, bodyResult.message);
  }
  const rawBody = bodyResult.value;
  const signatureHeader =
    req.headers.get('x-webhook-signature')?.trim() ||
    req.headers.get('x-signature')?.trim() ||
    null;

  if (!verifyWebhookSignature(rawBody, signatureHeader, cfg.paywallWebhookSecret)) {
    return jsonError(req, 401, 'invalid_signature', 'UNAUTHORIZED', 'Invalid webhook signature.');
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return jsonError(req, 400, 'invalid_json', 'BAD_REQUEST', 'Webhook body must be valid JSON.');
  }

  if (!isPlainRecord(parsedBody)) {
    return jsonError(req, 400, 'invalid_payload', 'BAD_REQUEST', 'Webhook body must be a JSON object.');
  }

  const eventId = nonEmptyString(parsedBody.eventId);
  const orderId = nonEmptyString(parsedBody.orderId);
  const rawTargetKey = nonEmptyString(parsedBody.targetKey);
  const status = nonEmptyString(parsedBody.status);
  const scope = parsedBody.scope;

  if (!eventId || !orderId || !rawTargetKey || !status || !isEntitlementScope(scope)) {
    return jsonError(
      req,
      400,
      'invalid_webhook_fields',
      'INVALID_INPUT',
      'Required fields: eventId, orderId, scope (interpret|heming|bundle), targetKey, status.',
    );
  }
  const targetKey = stripYearSuffixFromKey(rawTargetKey);

  let amountMinor: number | undefined;
  if (parsedBody.amountMinor !== undefined && parsedBody.amountMinor !== null) {
    if (
      typeof parsedBody.amountMinor !== 'number' ||
      !Number.isInteger(parsedBody.amountMinor) ||
      parsedBody.amountMinor <= 0
    ) {
      return jsonError(req, 400, 'invalid_amount', 'INVALID_INPUT', 'amountMinor must be a positive integer.');
    }
    amountMinor = parsedBody.amountMinor;
  }

  let currency: string | undefined;
  if (parsedBody.currency !== undefined && parsedBody.currency !== null) {
    const parsedCurrency = nonEmptyString(parsedBody.currency);
    if (!parsedCurrency) {
      return jsonError(req, 400, 'invalid_currency', 'INVALID_INPUT', 'currency must be a non-empty string.');
    }
    currency = parsedCurrency;
  }

  let provider: string | undefined;
  if (parsedBody.provider !== undefined && parsedBody.provider !== null) {
    const parsedProvider = nonEmptyString(parsedBody.provider);
    if (!parsedProvider) {
      return jsonError(req, 400, 'invalid_provider', 'INVALID_INPUT', 'provider must be a non-empty string.');
    }
    provider = parsedProvider;
  }

  let meta: Record<string, unknown> | undefined;
  if (parsedBody.meta !== undefined && parsedBody.meta !== null) {
    if (!isPlainRecord(parsedBody.meta)) {
      return jsonError(req, 400, 'invalid_meta', 'INVALID_INPUT', 'meta must be a plain object.');
    }
    meta = parsedBody.meta;
  }

  if (status !== 'paid') {
    return withCors(
      req,
      Response.json(
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
      ),
    );
  }

  if (!cfg.accessTokenSecret) {
    return jsonError(
      req,
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

  return withCors(
    req,
    Response.json(
      {
        ok: true,
        orderId: order.orderId,
        scope: order.scope,
        targetKey: order.targetKey,
        idempotent: !inserted,
        accessToken,
      },
      { status: 200 },
    ),
  );
}
