import { getServerEnv } from '@/lib/server/env';
import {
  extractOrderToken,
  signAccessToken,
  verifyOrderToken,
} from '@/lib/server/access-token';
import { handleCorsPreflight, withCors } from '@/lib/server/cors';
import { getOrder } from '@/lib/server/db';
import { stripYearSuffixFromKey } from '@/lib/ziwei/chart-analyzer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
};

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

export async function OPTIONS(req: Request): Promise<Response> {
  return handleCorsPreflight(req);
}

const UNAUTHORIZED_MESSAGE = 'Valid order authorization token is required.';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const orderId = url.searchParams.get('orderId')?.trim() ?? '';
  if (!orderId) {
    return jsonError(
      req,
      400,
      'missing_order_id',
      'INVALID_INPUT',
      'Query parameter orderId is required.',
    );
  }

  const orderToken = extractOrderToken(req);
  if (!orderToken) {
    return jsonError(
      req,
      401,
      'unauthorized',
      'UNAUTHORIZED',
      UNAUTHORIZED_MESSAGE,
    );
  }

  const order = await getOrder(orderId);
  if (!order || !verifyOrderToken(orderToken, order.claimTokenHash)) {
    return jsonError(
      req,
      401,
      'unauthorized',
      'UNAUTHORIZED',
      UNAUTHORIZED_MESSAGE,
    );
  }

  if (order.status !== 'paid') {
    return withCors(
      req,
      Response.json(
        {
          ok: true,
          orderId: order.orderId,
          status: order.status,
          paid: false,
          scope: order.scope,
          targetKey: order.targetKey,
          ...(order.provider !== undefined ? { provider: order.provider } : {}),
          createdAt: order.createdAt.toISOString(),
        },
        { status: 200, headers: NO_STORE_HEADERS },
      ),
    );
  }

  const cfg = getServerEnv();
  if (!cfg.accessTokenSecret) {
    return jsonError(
      req,
      503,
      'access_token_not_configured',
      'TOKEN_UNCONFIGURED',
      'Access token signing is not configured on the server.',
    );
  }

  const normalizedTargetKey = stripYearSuffixFromKey(order.targetKey);
  const accessToken = signAccessToken(
    {
      scope: order.scope,
      targetKey: normalizedTargetKey,
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
        status: 'paid',
        paid: true,
        scope: order.scope,
        targetKey: order.targetKey,
        accessToken,
        ...(order.provider !== undefined ? { provider: order.provider } : {}),
        createdAt: order.createdAt.toISOString(),
        ...(order.paidAt !== undefined ? { paidAt: order.paidAt.toISOString() } : {}),
      },
      { status: 200, headers: NO_STORE_HEADERS },
    ),
  );
}
