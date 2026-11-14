/**
 * 无状态 HMAC-SHA256 访问令牌与支付 Webhook 签名校验模块。
 * 所有摘要比对均使用 node:crypto timingSafeEqual 防止时序侧信道。
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getServerConfig } from './env';

export type EntitlementScope = 'interpret' | 'heming' | 'bundle';

export interface AccessTokenPayload {
  scope: EntitlementScope;
  targetKey: string;
  orderId: string;
  issuedAt: number;
  expiresAt: number;
}

export type AccessTokenVerificationResult =
  | { valid: true; payload: AccessTokenPayload }
  | { valid: false; reason: string };

const DEFAULT_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const BASE64URL_SEGMENT_RE = /^[A-Za-z0-9_-]+$/;
const SHA256_HEX_RE = /^[0-9a-fA-F]{64}$/;

function isValidScope(value: unknown): value is EntitlementScope {
  return value === 'interpret' || value === 'heming' || value === 'bundle';
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAccessTokenPayload(value: unknown): value is AccessTokenPayload {
  if (!isPlainRecord(value)) return false;
  return (
    isValidScope(value.scope) &&
    typeof value.targetKey === 'string' &&
    value.targetKey.length > 0 &&
    typeof value.orderId === 'string' &&
    value.orderId.length > 0 &&
    typeof value.issuedAt === 'number' &&
    Number.isFinite(value.issuedAt) &&
    typeof value.expiresAt === 'number' &&
    Number.isFinite(value.expiresAt)
  );
}

function scopeMatches(tokenScope: EntitlementScope, expectedScope: EntitlementScope): boolean {
  if (tokenScope === expectedScope) return true;
  return tokenScope === 'bundle' && (expectedScope === 'interpret' || expectedScope === 'heming');
}

function resolveAccessTokenSecret(explicitSecret?: string): string | undefined {
  const candidate = explicitSecret ?? getServerConfig().accessTokenSecret;
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    return undefined;
  }
  return candidate;
}

function encodeJsonBase64Url(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeJsonBase64Url(segment: string): unknown {
  const raw = Buffer.from(segment, 'base64url').toString('utf8');
  return JSON.parse(raw) as unknown;
}

/**
 * 签发 HS256 base64url 访问令牌；缺少密钥或必填字段时显式抛出异常。
 */
export function signAccessToken(
  input: {
    scope: EntitlementScope;
    targetKey: string;
    orderId: string;
    ttlSeconds?: number;
  },
  secret?: string,
): string {
  const resolvedSecret = resolveAccessTokenSecret(secret);
  if (!resolvedSecret) {
    throw new Error('ACCESS_TOKEN_SECRET is required to sign access tokens');
  }
  if (!isValidScope(input.scope)) {
    throw new Error('Invalid entitlement scope');
  }
  if (typeof input.targetKey !== 'string' || input.targetKey.trim().length === 0) {
    throw new Error('targetKey must be a non-empty string');
  }
  if (typeof input.orderId !== 'string' || input.orderId.trim().length === 0) {
    throw new Error('orderId must be a non-empty string');
  }

  const ttlSeconds = input.ttlSeconds ?? DEFAULT_TOKEN_TTL_SECONDS;
  if (typeof ttlSeconds !== 'number' || !Number.isFinite(ttlSeconds)) {
    throw new Error('ttlSeconds must be a finite number');
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + Math.floor(ttlSeconds);

  const payload: AccessTokenPayload = {
    scope: input.scope,
    targetKey: input.targetKey,
    orderId: input.orderId,
    issuedAt,
    expiresAt,
  };

  const encodedHeader = encodeJsonBase64Url({ alg: 'HS256', typ: 'JWT' });
  const encodedPayload = encodeJsonBase64Url(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', resolvedSecret).update(signingInput, 'utf8').digest('base64url');

  return `${signingInput}.${signature}`;
}

/**
 * 校验访问令牌签名、算法头、有效期、权限范围及可选 targetKey。
 */
export function verifyAccessToken(
  token: string,
  expectedScope: EntitlementScope,
  expectedKey?: string,
  secret?: string,
): AccessTokenVerificationResult {
  const resolvedSecret = resolveAccessTokenSecret(secret);
  if (!resolvedSecret) {
    return { valid: false, reason: 'missing_secret' };
  }
  if (typeof token !== 'string' || token.length === 0) {
    return { valid: false, reason: 'missing_token' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, reason: 'malformed_token' };
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (
    !BASE64URL_SEGMENT_RE.test(encodedHeader) ||
    !BASE64URL_SEGMENT_RE.test(encodedPayload) ||
    !BASE64URL_SEGMENT_RE.test(encodedSignature)
  ) {
    return { valid: false, reason: 'malformed_token' };
  }

  const expectedDigest = createHmac('sha256', resolvedSecret)
    .update(`${encodedHeader}.${encodedPayload}`, 'utf8')
    .digest();
  const actualDigest = Buffer.from(encodedSignature, 'base64url');

  if (
    actualDigest.length !== expectedDigest.length ||
    !timingSafeEqual(actualDigest, expectedDigest) ||
    actualDigest.toString('base64url') !== encodedSignature
  ) {
    return { valid: false, reason: 'invalid_signature' };
  }

  let parsedHeader: unknown;
  let parsedPayload: unknown;
  try {
    parsedHeader = decodeJsonBase64Url(encodedHeader);
    parsedPayload = decodeJsonBase64Url(encodedPayload);
  } catch {
    return { valid: false, reason: 'invalid_json' };
  }

  if (!isPlainRecord(parsedHeader) || parsedHeader.alg !== 'HS256') {
    return { valid: false, reason: 'unsupported_algorithm' };
  }
  if (!isAccessTokenPayload(parsedPayload)) {
    return { valid: false, reason: 'invalid_payload' };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds >= parsedPayload.expiresAt) {
    return { valid: false, reason: 'token_expired' };
  }

  if (!scopeMatches(parsedPayload.scope, expectedScope)) {
    return { valid: false, reason: 'scope_mismatch' };
  }

  if (expectedKey !== undefined && parsedPayload.targetKey !== expectedKey) {
    return { valid: false, reason: 'target_key_mismatch' };
  }

  return { valid: true, payload: parsedPayload };
}

/**
 * 对原始 Webhook 请求体计算小写十六进制 HMAC-SHA256 签名。
 */
export function signWebhookSignature(rawBody: string, secret: string): string {
  if (typeof rawBody !== 'string') {
    throw new Error('rawBody must be a string');
  }
  if (typeof secret !== 'string' || secret.trim().length === 0) {
    throw new Error('PAYWALL_WEBHOOK_SECRET is required to sign webhook payloads');
  }
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

/**
 * 常量时间校验 Webhook 签名，支持 `sha256=<hex>` 或纯 `<hex>` 格式。
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (
    typeof rawBody !== 'string' ||
    typeof signatureHeader !== 'string' ||
    typeof secret !== 'string' ||
    secret.trim().length === 0
  ) {
    return false;
  }

  let hexSignature = signatureHeader.trim();
  if (hexSignature.toLowerCase().startsWith('sha256=')) {
    hexSignature = hexSignature.slice('sha256='.length).trim();
  }

  if (!SHA256_HEX_RE.test(hexSignature)) {
    return false;
  }

  const expectedDigest = createHmac('sha256', secret).update(rawBody, 'utf8').digest();
  const actualDigest = Buffer.from(hexSignature, 'hex');

  if (actualDigest.length !== expectedDigest.length) {
    return false;
  }

  return timingSafeEqual(actualDigest, expectedDigest);
}

/**
 * 按 Authorization Bearer 优先、请求体 token 兜底的顺序提取访问令牌。
 */
export function extractBearerToken(req: Request, bodyToken?: unknown): string | null {
  const authHeader = req.headers.get('authorization');
  if (authHeader) {
    const match = authHeader.match(/^\s*Bearer\s+(\S+)\s*$/i);
    if (match && match[1]) {
      return match[1];
    }
  }

  if (typeof bodyToken === 'string') {
    const trimmed = bodyToken.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return null;
}
