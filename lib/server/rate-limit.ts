/**
 * 分布式优先（Redis Lua / INCR+EXPIRE）+ 内存窗口兜底的限流器。
 * 不直接导入 cache.ts，避免模块循环依赖。
 */

export interface RateLimitRedisClient {
  eval?(...args: unknown[]): Promise<unknown>;
  incr?(key: string): Promise<number>;
  expire?(key: string, seconds: number): Promise<number>;
}

export interface RateLimitOptions {
  key: string;
  limit: number;
  windowSeconds: number;
  redis?: RateLimitRedisClient | null;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
  backend: 'redis' | 'memory';
}

interface MemoryBucket {
  count: number;
  resetAt: number;
}

const GLOBAL_REDIS_KEY = '__ziweiRateLimitRedisClient' as const;
const MAX_MEMORY_BUCKETS = 10_000;
const PRUNE_EVERY_N_WRITES = 64;

const FIXED_WINDOW_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
  ttl = tonumber(ARGV[1])
end
return { current, ttl }
`;

interface GlobalWithRateLimitRedis {
  [GLOBAL_REDIS_KEY]?: RateLimitRedisClient | null;
}

const memoryBuckets = new Map<string, MemoryBucket>();
let writeCounter = 0;

/**
 * 可选注册全局 Redis 客户端供未显式传 opts.redis 的调用方使用。
 */
export function setRateLimitRedisClient(client: RateLimitRedisClient | null): void {
  (globalThis as GlobalWithRateLimitRedis)[GLOBAL_REDIS_KEY] = client;
}

function resolveRedisClient(explicit: RateLimitOptions['redis']): RateLimitRedisClient | null {
  if (explicit !== undefined) {
    return explicit;
  }
  return (globalThis as GlobalWithRateLimitRedis)[GLOBAL_REDIS_KEY] ?? null;
}

function pruneExpiredBuckets(now: number): void {
  for (const [bucketKey, bucket] of memoryBuckets) {
    if (now >= bucket.resetAt) {
      memoryBuckets.delete(bucketKey);
    }
  }
  while (memoryBuckets.size >= MAX_MEMORY_BUCKETS) {
    const oldestKey = memoryBuckets.keys().next().value;
    if (oldestKey === undefined) break;
    memoryBuckets.delete(oldestKey);
  }
}

function checkMemoryRateLimit(
  key: string,
  limit: number,
  windowSec: number,
  now: number,
): RateLimitResult {
  writeCounter += 1;
  if (writeCounter >= PRUNE_EVERY_N_WRITES || memoryBuckets.size >= MAX_MEMORY_BUCKETS) {
    writeCounter = 0;
    pruneExpiredBuckets(now);
  }

  const existing = memoryBuckets.get(key);
  if (!existing || now >= existing.resetAt) {
    const resetAt = now + windowSec * 1000;
    memoryBuckets.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      remaining: Math.max(0, limit - 1),
      resetAt,
      retryAfterSeconds: 0,
      backend: 'memory',
    };
  }

  existing.count += 1;
  const allowed = existing.count <= limit;
  const remaining = Math.max(0, limit - existing.count);
  const retryAfterSeconds = allowed ? 0 : Math.max(1, Math.ceil((existing.resetAt - now) / 1000));

  return {
    allowed,
    remaining,
    resetAt: existing.resetAt,
    retryAfterSeconds,
    backend: 'memory',
  };
}

function parseEvalCounterResult(raw: unknown, fallbackWindowSec: number): { count: number; ttlSec: number } | null {
  if (Array.isArray(raw) && raw.length >= 2) {
    const count = Number(raw[0]);
    const ttl = Number(raw[1]);
    if (Number.isFinite(count) && count >= 1) {
      const ttlSec = Number.isFinite(ttl) && ttl > 0 ? Math.ceil(ttl) : fallbackWindowSec;
      return { count, ttlSec };
    }
    return null;
  }

  if (typeof raw === 'number' || typeof raw === 'string') {
    const count = Number(raw);
    if (Number.isFinite(count) && count >= 1) {
      return { count, ttlSec: fallbackWindowSec };
    }
  }

  return null;
}

async function tryRedisRateLimit(
  redis: RateLimitRedisClient,
  key: string,
  limit: number,
  windowSec: number,
  now: number,
): Promise<RateLimitResult | null> {
  if (typeof redis.eval === 'function') {
    const raw = await redis.eval(FIXED_WINDOW_LUA, 1, key, String(windowSec));
    const parsed = parseEvalCounterResult(raw, windowSec);
    if (!parsed) return null;

    const allowed = parsed.count <= limit;
    const remaining = Math.max(0, limit - parsed.count);
    const resetAt = now + parsed.ttlSec * 1000;
    const retryAfterSeconds = allowed ? 0 : Math.max(1, parsed.ttlSec);

    return {
      allowed,
      remaining,
      resetAt,
      retryAfterSeconds,
      backend: 'redis',
    };
  }

  if (typeof redis.incr === 'function') {
    const count = await redis.incr(key);
    if (!Number.isFinite(count) || count < 1) return null;
    if (count === 1 && typeof redis.expire === 'function') {
      await redis.expire(key, windowSec);
    }

    const allowed = count <= limit;
    const remaining = Math.max(0, limit - count);
    const resetAt = now + windowSec * 1000;
    const retryAfterSeconds = allowed ? 0 : Math.max(1, windowSec);

    return {
      allowed,
      remaining,
      resetAt,
      retryAfterSeconds,
      backend: 'redis',
    };
  }

  return null;
}

/**
 * 从代理请求头提取客户端 IP；缺失时回退为 'unknown'。
 */
export function extractClientIp(req: Request): string {
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor
      .split(',')
      .map((part) => part.trim())
      .find((part) => part.length > 0);
    if (first) return first;
  }

  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  return 'unknown';
}

/**
 * 执行固定窗口限流检查；Redis 不可用或异常时自动降级到进程内内存限流。
 */
export async function checkRateLimit(opts: RateLimitOptions): Promise<RateLimitResult> {
  const now = Date.now();
  const windowSec = Number.isFinite(opts.windowSeconds) && opts.windowSeconds > 0
    ? Math.ceil(opts.windowSeconds)
    : 60;
  const limit = Number.isFinite(opts.limit) ? Math.floor(opts.limit) : 0;
  const normalizedKey = opts.key.trim().length > 0 ? opts.key : 'default';

  if (limit <= 0) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: now + windowSec * 1000,
      retryAfterSeconds: windowSec,
      backend: 'memory',
    };
  }

  const redisClient = resolveRedisClient(opts.redis);
  if (redisClient) {
    try {
      const redisResult = await tryRedisRateLimit(redisClient, normalizedKey, limit, windowSec, now);
      if (redisResult) {
        return redisResult;
      }
    } catch {
      // Redis 异常时降级至内存限流，避免误放行或阻塞请求
    }
  }

  return checkMemoryRateLimit(normalizedKey, limit, windowSec, now);
}

/**
 * 清空进程内内存限流桶（仅用于测试）。
 */
export function resetMemoryRateLimiterForTests(): void {
  memoryBuckets.clear();
  writeCounter = 0;
}
