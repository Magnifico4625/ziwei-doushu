import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import { getChartCacheKey } from '../ziwei/chart-analyzer';
import type { ZiweiChart } from '../ziwei/types';
import { getServerConfig } from './env';

const DEFAULT_STREAM_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7;
const MAX_MEMORY_CACHE_ENTRIES = 2000;

interface MemoryCacheEntry {
  value: string;
  expiresAt: number;
}

const memoryCache = new Map<string, MemoryCacheEntry>();
let redisSingleton: Redis | null = null;
let redisUrlUsed: string | undefined;

function sha256Hex(input: string, length: number): string {
  return createHash('sha256').update(input, 'utf8').digest('hex').slice(0, length);
}

function pruneExpiredMemoryEntries(now: number): void {
  for (const [key, entry] of memoryCache.entries()) {
    if (entry.expiresAt <= now) {
      memoryCache.delete(key);
    }
  }
}

function readMemoryCache(key: string): string | null {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
}

function writeMemoryCache(key: string, text: string, ttlSeconds: number): void {
  const now = Date.now();
  if (ttlSeconds <= 0) {
    memoryCache.delete(key);
    return;
  }
  if (memoryCache.size >= MAX_MEMORY_CACHE_ENTRIES) {
    pruneExpiredMemoryEntries(now);
    while (memoryCache.size >= MAX_MEMORY_CACHE_ENTRIES) {
      const oldestKey = memoryCache.keys().next().value;
      if (oldestKey === undefined) break;
      memoryCache.delete(oldestKey);
    }
  }
  memoryCache.set(key, {
    value: text,
    expiresAt: now + ttlSeconds * 1000,
  });
}

function disconnectSafely(client: Redis): void {
  try {
    if (client.status === 'ready' || client.status === 'connect') {
      void client.quit().catch(() => {
        client.disconnect();
      });
    } else {
      client.disconnect();
    }
  } catch {
    // Ignore errors while tearing down offline or closed clients.
  }
}

export function getRedisClient(): Redis | null {
  const url = getServerConfig().redisUrl?.trim();
  if (!url) {
    return null;
  }
  if (redisSingleton && redisUrlUsed === url) {
    return redisSingleton;
  }
  if (redisSingleton) {
    const staleClient = redisSingleton;
    redisSingleton = null;
    redisUrlUsed = undefined;
    disconnectSafely(staleClient);
  }

  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    enableReadyCheck: true,
    retryStrategy(times: number): number | null {
      return times > 3 ? null : Math.min(times * 200, 1000);
    },
  });
  client.on('error', () => {
    // Prevent unhandled Redis socket errors from crashing Node when Redis is offline.
  });

  redisSingleton = client;
  redisUrlUsed = url;
  return redisSingleton;
}

export function resetMemoryCacheForTests(): void {
  memoryCache.clear();
}

export async function closeRedisForTests(): Promise<void> {
  if (!redisSingleton) return;
  const current = redisSingleton;
  redisSingleton = null;
  redisUrlUsed = undefined;
  try {
    if (current.status === 'ready' || current.status === 'connect') {
      await current.quit().catch(() => {
        current.disconnect();
      });
    } else {
      current.disconnect();
    }
  } catch {
    // Ignore close errors during test teardown.
  }
}

export function hashPromptMessages(
  messages: readonly { role: string; content: string }[],
): string {
  const normalized = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  return sha256Hex(JSON.stringify(normalized), 24);
}

export function hashQuestion(question?: string): string {
  const normalized = (question ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (!normalized) {
    return 'default';
  }
  return sha256Hex(normalized, 24);
}

export function buildInterpretRedisKey(
  chartKey: string,
  messagesHash: string,
): string {
  const hashPart = messagesHash.trim() || 'default';
  return `ziwei:cache:interpret:${chartKey}:${hashPart}`;
}

export function canonicalPairKey(
  chartA: ZiweiChart,
  chartB: ZiweiChart,
  targetYear?: number,
): string {
  if (targetYear !== undefined && !Number.isInteger(targetYear)) {
    throw new RangeError(`targetYear must be an integer; received ${targetYear}`);
  }
  const keyA = getChartCacheKey(chartA);
  const keyB = getChartCacheKey(chartB);
  const [first, second] = keyA <= keyB ? [keyA, keyB] : [keyB, keyA];
  const raw =
    targetYear !== undefined
      ? `${first}|${second}|y${targetYear}`
      : `${first}|${second}`;
  const digest = sha256Hex(raw, 32);
  return targetYear !== undefined
    ? `heming:v1:${digest}:y${targetYear}`
    : `heming:v1:${digest}`;
}

export function buildSynastryRedisKey(
  pairKey: string,
  questionHash: string,
): string {
  const hashPart = questionHash.trim() || 'default';
  return `ziwei:cache:synastry:${pairKey}:${hashPart}`;
}

export async function getCachedStreamText(key: string): Promise<string | null> {
  if (!key) return null;
  const client = getRedisClient();
  if (!client) {
    return readMemoryCache(key);
  }
  try {
    return await client.get(key);
  } catch {
    return readMemoryCache(key);
  }
}

export async function setCachedStreamText(
  key: string,
  text: string,
  ttlSeconds = DEFAULT_STREAM_CACHE_TTL_SECONDS,
): Promise<void> {
  if (!key) return;
  const ttl = Math.trunc(ttlSeconds);
  const client = getRedisClient();
  if (!client) {
    writeMemoryCache(key, text, ttl);
    return;
  }
  if (ttl <= 0) {
    try {
      await client.del(key);
    } catch {
      memoryCache.delete(key);
    }
    return;
  }
  try {
    await client.set(key, text, 'EX', ttl);
  } catch {
    writeMemoryCache(key, text, ttl);
  }
}

export async function checkRedisHealth(): Promise<{
  ok: boolean;
  mode: 'redis' | 'memory';
}> {
  const url = getServerConfig().redisUrl?.trim();
  if (!url) {
    return { ok: true, mode: 'memory' };
  }
  const client = getRedisClient();
  if (!client) {
    return { ok: false, mode: 'redis' };
  }
  try {
    const pong: string = await client.ping();
    return { ok: pong === 'PONG' || pong.length > 0, mode: 'redis' };
  } catch {
    return { ok: false, mode: 'redis' };
  }
}
