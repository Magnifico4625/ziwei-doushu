/**
 * 服务端环境变量读取与校验模块。
 * 默认开启严格付费守卫（aiPaywallMode = 'strict'），仅在 AI_PAYWALL_MODE === 'off' 时关闭。
 */

export type AiProviderKind = 'deepseek' | 'anthropic' | 'mimo' | 'openai-compatible';
export type PaywallMode = 'strict' | 'off';

export interface ServerConfig {
  aiProvider: AiProviderKind;
  aiPaywallMode: PaywallMode;
  databaseUrl?: string;
  redisUrl?: string;
  accessTokenSecret?: string;
  paywallWebhookSecret?: string;
  deepseekApiKey?: string;
  anthropicApiKey?: string;
  anthropicModel: string;
  mimoApiKey?: string;
  mimoBaseUrl?: string;
  mimoModel?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
  deepseekBaseUrl: string;
  deepseekModel: string;
  interpretRateLimitPerMin: number;
  chartRateLimitPerMin: number;
  allowedOrigins: readonly string[];
  appPublicUrl: string;
  billingProvider: string;
  billingCheckoutBaseUrl?: string;
}

export type ServerEnvConfig = ServerConfig;

const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat';
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_INTERPRET_RATE_LIMIT_PER_MIN = 20;
const DEFAULT_CHART_RATE_LIMIT_PER_MIN = 60;
const DEFAULT_APP_PUBLIC_URL = 'http://localhost:3000';
const DEFAULT_LOCAL_ALLOWED_ORIGINS: readonly string[] = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];
const DEFAULT_BILLING_PROVIDER = 'manual';

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseAiProvider(raw: string | undefined): AiProviderKind {
  switch (raw?.trim().toLowerCase()) {
    case 'anthropic':
      return 'anthropic';
    case 'mimo':
      return 'mimo';
    case 'openai-compatible':
      return 'openai-compatible';
    case 'deepseek':
    default:
      return 'deepseek';
  }
}

function parsePaywallMode(raw: string | undefined): PaywallMode {
  return raw?.trim().toLowerCase() === 'off' ? 'off' : 'strict';
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = readOptionalEnv(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function normalizeOriginEntry(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed === '*') return '*';
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

function parseAllowedOrigins(
  rawAllowedOrigins: string | undefined,
  configuredPublicUrl: string | undefined,
): readonly string[] {
  if (rawAllowedOrigins !== undefined) {
    const parsed = new Set<string>();
    for (const part of rawAllowedOrigins.split(',')) {
      const normalized = normalizeOriginEntry(part);
      if (normalized === '*') {
        return ['*'];
      }
      if (normalized) {
        parsed.add(normalized);
      }
    }
    return [...parsed];
  }

  if (configuredPublicUrl) {
    const normalized = normalizeOriginEntry(configuredPublicUrl);
    if (normalized && normalized !== '*') {
      return [normalized];
    }
  }

  return [...DEFAULT_LOCAL_ALLOWED_ORIGINS];
}

/**
 * 动态读取当前 process.env 构造服务端配置。
 * 始终以最新环境变量为准，配合 resetServerConfigForTests 保证测试隔离。
 */
export function getServerConfig(): ServerConfig {
  const configuredPublicUrl =
    readOptionalEnv('APP_PUBLIC_URL') ?? readOptionalEnv('NEXT_PUBLIC_SITE_URL');
  const appPublicUrl = (configuredPublicUrl ?? DEFAULT_APP_PUBLIC_URL).replace(/\/+$/, '') || DEFAULT_APP_PUBLIC_URL;

  return {
    aiProvider: parseAiProvider(process.env.AI_PROVIDER),
    aiPaywallMode: parsePaywallMode(process.env.AI_PAYWALL_MODE),
    databaseUrl: readOptionalEnv('DATABASE_URL'),
    redisUrl: readOptionalEnv('REDIS_URL'),
    accessTokenSecret: readOptionalEnv('ACCESS_TOKEN_SECRET'),
    paywallWebhookSecret: readOptionalEnv('PAYWALL_WEBHOOK_SECRET'),
    deepseekApiKey: readOptionalEnv('DEEPSEEK_API_KEY'),
    anthropicApiKey: readOptionalEnv('ANTHROPIC_API_KEY'),
    anthropicModel: readOptionalEnv('ANTHROPIC_MODEL') ?? DEFAULT_ANTHROPIC_MODEL,
    mimoApiKey: readOptionalEnv('MIMO_API_KEY'),
    mimoBaseUrl: readOptionalEnv('MIMO_BASE_URL'),
    mimoModel: readOptionalEnv('MIMO_MODEL'),
    openaiApiKey: readOptionalEnv('OPENAI_API_KEY'),
    openaiBaseUrl: readOptionalEnv('OPENAI_BASE_URL'),
    openaiModel: readOptionalEnv('OPENAI_MODEL'),
    deepseekBaseUrl: readOptionalEnv('DEEPSEEK_BASE_URL') ?? DEFAULT_DEEPSEEK_BASE_URL,
    deepseekModel: readOptionalEnv('DEEPSEEK_MODEL') ?? DEFAULT_DEEPSEEK_MODEL,
    interpretRateLimitPerMin: readPositiveIntEnv(
      'INTERPRET_RATE_LIMIT_PER_MIN',
      DEFAULT_INTERPRET_RATE_LIMIT_PER_MIN,
    ),
    chartRateLimitPerMin: readPositiveIntEnv(
      'CHART_RATE_LIMIT_PER_MIN',
      DEFAULT_CHART_RATE_LIMIT_PER_MIN,
    ),
    allowedOrigins: parseAllowedOrigins(readOptionalEnv('ALLOWED_ORIGINS'), configuredPublicUrl),
    appPublicUrl,
    billingProvider: readOptionalEnv('BILLING_PROVIDER') ?? DEFAULT_BILLING_PROVIDER,
    billingCheckoutBaseUrl: readOptionalEnv('BILLING_CHECKOUT_BASE_URL'),
  };
}

/**
 * Alias for `getServerConfig()` matching `ServerEnvConfig` naming.
 */
export function getServerEnv(): ServerEnvConfig {
  return getServerConfig();
}

/**
 * 重置配置状态（测试辅助钩子；当前实现动态读取 process.env）。
 */
export function resetServerConfigForTests(): void {
  // 当前配置直接从 process.env 动态构建，保留此导出以维持测试重置契约。
}
