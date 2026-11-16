import { getServerEnv } from './env';

const CORS_ALLOW_METHODS = 'GET, POST, OPTIONS';
const CORS_ALLOW_HEADERS =
  'Content-Type, Authorization, X-Order-Token, X-Requested-With, X-Webhook-Signature, X-Signature';
const CORS_EXPOSE_HEADERS = 'X-Cache, Retry-After';
const CORS_MAX_AGE_SECONDS = '86400';

function normalizeRequestOrigin(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === 'null') {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Check whether an incoming `Origin` header is permitted by `ALLOWED_ORIGINS`.
 * Requests without an `Origin` header (`null`) are treated as non-CORS / same-origin calls.
 */
export function isOriginAllowed(origin: string | null): boolean {
  if (origin === null) {
    return true;
  }

  const normalized = normalizeRequestOrigin(origin);
  if (!normalized) {
    return false;
  }

  const { allowedOrigins } = getServerEnv();
  if (allowedOrigins.includes('*')) {
    return true;
  }

  return allowedOrigins.includes(normalized);
}

/**
 * Build CORS response headers for a request based on `ALLOWED_ORIGINS`.
 */
export function buildCorsHeaders(request: Request): Record<string, string> {
  const { allowedOrigins } = getServerEnv();
  const origin = request.headers.get('origin');
  const isWildcard = allowedOrigins.includes('*');

  if (isWildcard) {
    if (origin === null || isOriginAllowed(origin)) {
      return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': CORS_ALLOW_METHODS,
        'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
        'Access-Control-Expose-Headers': CORS_EXPOSE_HEADERS,
        'Access-Control-Max-Age': CORS_MAX_AGE_SECONDS,
        Vary: 'Origin',
      };
    }
    return { Vary: 'Origin' };
  }

  if (origin !== null && isOriginAllowed(origin)) {
    return {
      'Access-Control-Allow-Origin': origin.trim(),
      'Access-Control-Allow-Methods': CORS_ALLOW_METHODS,
      'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
      'Access-Control-Expose-Headers': CORS_EXPOSE_HEADERS,
      'Access-Control-Max-Age': CORS_MAX_AGE_SECONDS,
      Vary: 'Origin',
    };
  }

  return { Vary: 'Origin' };
}

function mergeVaryHeader(headers: Headers, value: string): void {
  const existing = headers.get('Vary');
  if (!existing) {
    headers.set('Vary', value);
    return;
  }
  const tokens = existing
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (!tokens.includes(value.toLowerCase())) {
    headers.set('Vary', `${existing}, ${value}`);
  }
}

/**
 * Clone CORS headers onto a Response while preserving status, headers, and ReadableStream SSE bodies.
 */
export function withCors(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  const corsHeaders = buildCorsHeaders(request);

  for (const [key, value] of Object.entries(corsHeaders)) {
    if (key.toLowerCase() === 'vary') {
      mergeVaryHeader(headers, value);
    } else {
      headers.set(key, value);
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Handle HTTP `OPTIONS` CORS preflight requests: `204` when allowed, `403` for disallowed `Origin`.
 */
export function handleCorsPreflight(request: Request): Response {
  const origin = request.headers.get('origin');
  if (origin !== null && !isOriginAllowed(origin)) {
    return Response.json(
      {
        error: 'cors_origin_denied',
        code: 'CORS_FORBIDDEN',
        message: 'Origin is not allowed by CORS policy.',
      },
      {
        status: 403,
        headers: { Vary: 'Origin' },
      },
    );
  }

  const corsHeaders = buildCorsHeaders(request);
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': CORS_ALLOW_METHODS,
      'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
      'Access-Control-Max-Age': CORS_MAX_AGE_SECONDS,
      ...corsHeaders,
    },
  });
}
