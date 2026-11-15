import { getServerConfig } from '@/lib/server/env';
import { checkDbHealth } from '@/lib/server/db';
import { checkRedisHealth } from '@/lib/server/cache';
import { handleCorsPreflight, withCors } from '@/lib/server/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS(req: Request): Promise<Response> {
  return handleCorsPreflight(req);
}

export async function GET(req?: Request): Promise<Response> {
  const cfg = getServerConfig();
  const [postgres, redis] = await Promise.all([
    checkDbHealth(),
    checkRedisHealth(),
  ]);

  const response = Response.json(
    {
      ok: postgres.ok && redis.ok,
      postgres,
      redis,
      aiProvider: cfg.aiProvider,
      paywallMode: cfg.aiPaywallMode,
    },
    { status: 200 },
  );

  return req
    ? withCors(req, response)
    : withCors(new Request('http://localhost/api/health'), response);
}
