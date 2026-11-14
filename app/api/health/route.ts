import { getServerConfig } from '@/lib/server/env';
import { checkDbHealth } from '@/lib/server/db';
import { checkRedisHealth } from '@/lib/server/cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const cfg = getServerConfig();
  const [postgres, redis] = await Promise.all([
    checkDbHealth(),
    checkRedisHealth(),
  ]);

  return Response.json(
    {
      ok: postgres.ok && redis.ok,
      postgres,
      redis,
      aiProvider: cfg.aiProvider,
      paywallMode: cfg.aiPaywallMode,
    },
    { status: 200 },
  );
}
