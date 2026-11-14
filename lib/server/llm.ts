import Anthropic from '@anthropic-ai/sdk';
import type { ZiweiChart } from '../ziwei/types';
import {
  buildChartPromptPayload,
  type PatternSummary,
} from '../ziwei/chart-analyzer';
import {
  buildSynastryPromptPayload,
  type SynastryResult,
} from '../ziwei/heming';
import {
  getServerConfig,
  type AiProviderKind,
  type ServerConfig,
} from './env';

// ────────────────── SSE Constants & Cached Replay ──────────────────

export const SSE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
};

const SSE_DONE_EVENT = 'data: [DONE]\n\n';
const DEFAULT_CACHE_CHUNK_SIZE = 64;
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;

export function formatSseDelta(text: string): string {
  return `data: ${JSON.stringify({ delta: { text } })}\n\n`;
}

function sliceNextCodePoints(text: string, startIndex: number, maxCodePoints: number): number {
  let index = startIndex;
  let count = 0;
  while (index < text.length && count < maxCodePoints) {
    const code = text.charCodeAt(index);
    const isHighSurrogate = code >= 0xd800 && code <= 0xdbff;
    const nextCode = index + 1 < text.length ? text.charCodeAt(index + 1) : 0;
    const isSurrogatePair = isHighSurrogate && nextCode >= 0xdc00 && nextCode <= 0xdfff;
    index += isSurrogatePair ? 2 : 1;
    count += 1;
  }
  return index;
}

/**
 * Re-emit cached interpretation text as an SSE stream matching the wire protocol
 * consumed by `components/InsightPanel.tsx` and `app/heming/page.tsx`.
 */
export function createSseFromCachedText(
  text: string,
  chunkSize = DEFAULT_CACHE_CHUNK_SIZE,
): ReadableStream<Uint8Array> {
  const safeChunkSize =
    Number.isFinite(chunkSize) && chunkSize >= 1
      ? Math.trunc(chunkSize)
      : DEFAULT_CACHE_CHUNK_SIZE;
  const encoder = new TextEncoder();
  let cursor = 0;
  let doneSent = false;
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (cancelled || doneSent) return;

      if (cursor < text.length) {
        const nextCursor = sliceNextCodePoints(text, cursor, safeChunkSize);
        const slice = text.slice(cursor, nextCursor);
        cursor = nextCursor;
        if (slice.length > 0) {
          controller.enqueue(encoder.encode(formatSseDelta(slice)));
          return;
        }
      }

      doneSent = true;
      controller.enqueue(encoder.encode(SSE_DONE_EVENT));
      controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
}

// ────────────────── Compact System Prompt Builders ──────────────────

/**
 * Build a compact, deterministic system prompt for single-chart Zi Wei Dou Shu
 * interpretation using Stage 1 `< 3 KB` chart payload serialization.
 */
export function buildChartSystemPrompt(
  chart: ZiweiChart,
  options?: { targetYear?: number; patterns?: readonly PatternSummary[] },
): string {
  const payload = buildChartPromptPayload(chart, {
    targetYear: options?.targetYear,
    patterns: options?.patterns,
  });
  const payloadJson = JSON.stringify(payload);

  return [
    '你是一位精通传统紫微斗数（三合派与飞星四化体系）的专业命理分析顾问。请严格依据下方提供给你的结构化命盘 JSON 数据进行解析，严禁虚构 JSON 中不存在的星曜、宫位、亮度或四化。',
    '',
    '分析准则：',
    '1. 先看本命格局：结合五行局、命宫与身宫主星及亮度（庙旺平陷）、三方四正（命、财、官、迁）会照与六吉/六煞配置；若遇空宫（`borrowedFrom`），须结合对宫借星判断。',
    '2. 再追四化流向：综合生年四化、宫干自化（`selfSihua`）、当前大限四化（`daXian`）与流年四化（`liuNian`），重点阐释 `painPoints` 提示的叠忌、冲忌或煞星聚会风险，并呼应已识别的 `patterns` 格局特征。',
    '3. 表达与格式要求：使用清晰平实、可落地的简体中文回答，避免宿命论恐吓，给出具体可行的趋避建议。主要章节标题请单独占行并使用 `**【标题】**` 格式，关键结论可用 `**重点**` 强调。',
    '',
    '命盘结构化数据（JSON）：',
    payloadJson,
  ].join('\n');
}

/**
 * Build a compact, deterministic system prompt for two-chart synastry (合盘)
 * interpretation using Stage 1 `< 3 KB` synastry payload serialization.
 */
export function buildSynastrySystemPrompt(
  chartA: ZiweiChart,
  chartB: ZiweiChart,
  analysis: SynastryResult,
  question?: string,
): string {
  const payload = buildSynastryPromptPayload(chartA, chartB, analysis);
  const payloadJson = JSON.stringify(payload);
  const trimmedQuestion = question?.trim();

  const lines = [
    '你是一位精通紫微斗数合盘（三合共盘、宫位共振与双方飞星四化交互）的专业关系分析顾问。请严格依据下方提供给你的双方结构化合盘 JSON 数据展开综合解读，不得臆造 JSON 之外的星曜或四化。',
    '',
    '分析准则：',
    '1. 综合维度评估：结合总分（`score`）、四维分项（`dims`）、双方命宫/夫妻宫/福德宫基础与 `fuqiInsights` 星曜特性，说明两人的核心契合点与相处底色。',
    '2. 跨盘飞化与共振：解析甲方飞向乙方（`aToB`）与乙方飞向甲方（`bToA`）的四化落宫与冲照（含 `mutualJi`、天作之合 `tianZuo`、五行与地支关系 `branches`、经典星曜配对 `pairs`）。',
    '3. 亮点、摩擦与流年建议：围绕 `highlights` 与 `frictionPoints`（按 `sev` 轻重）说明优势与潜在磨合点，若包含 `annual` 数据则给出当年节奏提醒。用语客观温和、重在提供建设性相处策略。',
    '4. 排版要求：使用简体中文输出，主要章节标题单独占行并用 `**【标题】**` 格式，重点词句用 `**重点**` 标注。',
    '',
    '双方合盘结构化数据（JSON）：',
    payloadJson,
  ];

  if (trimmedQuestion) {
    lines.push('', '用户本次重点咨询问题：', trimmedQuestion);
  }

  return lines.join('\n');
}

// ────────────────── Errors & Public Streaming Types ──────────────────

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamLlmOptions {
  systemPrompt: string;
  messages: readonly ChatMessage[];
  maxTokens?: number;
  onComplete?: (fullText: string) => Promise<void> | void;
  signal?: AbortSignal;
}

export type LlmStreamAdapter = (
  opts: StreamLlmOptions,
  config: ServerConfig,
) => AsyncIterable<string>;

export class LlmConfigError extends Error {
  readonly code = 'LLM_CONFIG_ERROR';
  readonly provider: AiProviderKind;

  constructor(message: string, provider: AiProviderKind) {
    super(message);
    this.name = 'LlmConfigError';
    this.provider = provider;
  }
}

export class LlmUpstreamError extends Error {
  readonly code = 'LLM_UPSTREAM_ERROR';
  readonly provider: AiProviderKind;
  readonly status?: number;

  constructor(message: string, provider: AiProviderKind, status?: number) {
    super(message);
    this.name = 'LlmUpstreamError';
    this.provider = provider;
    this.status = status;
  }
}

// ────────────────── Test Adapter Hook ──────────────────

let testStreamAdapter: LlmStreamAdapter | null = null;

export function setLlmStreamAdapterForTests(adapter: LlmStreamAdapter | null): void {
  testStreamAdapter = adapter;
}

// ────────────────── Provider Resolution & Real Adapters ──────────────────

interface OpenAiProviderSettings {
  kind: 'deepseek' | 'mimo' | 'openai-compatible';
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface AnthropicProviderSettings {
  kind: 'anthropic';
  apiKey: string;
  model: string;
}

type ResolvedProviderSettings = OpenAiProviderSettings | AnthropicProviderSettings;

function resolveProviderSettings(config: ServerConfig): ResolvedProviderSettings {
  switch (config.aiProvider) {
    case 'anthropic': {
      const apiKey = config.anthropicApiKey?.trim();
      if (!apiKey) {
        throw new LlmConfigError(
          'Missing ANTHROPIC_API_KEY for provider "anthropic".',
          'anthropic',
        );
      }
      const model = config.anthropicModel.trim();
      if (!model) {
        throw new LlmConfigError(
          'Missing ANTHROPIC_MODEL for provider "anthropic".',
          'anthropic',
        );
      }
      return { kind: 'anthropic', apiKey, model };
    }
    case 'deepseek': {
      const apiKey = config.deepseekApiKey?.trim();
      if (!apiKey) {
        throw new LlmConfigError(
          'Missing DEEPSEEK_API_KEY for provider "deepseek".',
          'deepseek',
        );
      }
      const baseUrl = config.deepseekBaseUrl.trim();
      const model = config.deepseekModel.trim();
      if (!baseUrl || !model) {
        throw new LlmConfigError(
          'Missing DEEPSEEK_BASE_URL or DEEPSEEK_MODEL for provider "deepseek".',
          'deepseek',
        );
      }
      return { kind: 'deepseek', apiKey, baseUrl, model };
    }
    case 'mimo': {
      const apiKey = config.mimoApiKey?.trim();
      if (!apiKey) {
        throw new LlmConfigError(
          'Missing MIMO_API_KEY for provider "mimo".',
          'mimo',
        );
      }
      const baseUrl = config.mimoBaseUrl?.trim();
      const model = config.mimoModel?.trim();
      if (!baseUrl) {
        throw new LlmConfigError(
          'Missing MIMO_BASE_URL for provider "mimo".',
          'mimo',
        );
      }
      if (!model) {
        throw new LlmConfigError(
          'Missing MIMO_MODEL for provider "mimo".',
          'mimo',
        );
      }
      return { kind: 'mimo', apiKey, baseUrl, model };
    }
    case 'openai-compatible': {
      const apiKey = config.openaiApiKey?.trim();
      if (!apiKey) {
        throw new LlmConfigError(
          'Missing OPENAI_API_KEY for provider "openai-compatible".',
          'openai-compatible',
        );
      }
      const baseUrl = config.openaiBaseUrl?.trim();
      const model = config.openaiModel?.trim();
      if (!baseUrl) {
        throw new LlmConfigError(
          'Missing OPENAI_BASE_URL for provider "openai-compatible".',
          'openai-compatible',
        );
      }
      if (!model) {
        throw new LlmConfigError(
          'Missing OPENAI_MODEL for provider "openai-compatible".',
          'openai-compatible',
        );
      }
      return { kind: 'openai-compatible', apiKey, baseUrl, model };
    }
  }
}

function normalizeUpstreamError(err: unknown, provider: AiProviderKind): Error {
  if (err instanceof LlmConfigError || err instanceof LlmUpstreamError) {
    return err;
  }
  const message = err instanceof Error ? err.message : String(err);
  const status =
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    typeof (err as { status?: unknown }).status === 'number'
      ? (err as { status: number }).status
      : undefined;
  return new LlmUpstreamError(`LLM stream error (${provider}): ${message}`, provider, status);
}

interface OpenAiStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
}

async function openAnthropicStream(
  opts: StreamLlmOptions,
  settings: AnthropicProviderSettings,
): Promise<AsyncIterable<string>> {
  if (opts.messages.length === 0) {
    throw new LlmConfigError('At least one chat message is required.', 'anthropic');
  }

  const client = new Anthropic({ apiKey: settings.apiKey });
  const maxTokens =
    opts.maxTokens !== undefined && Number.isFinite(opts.maxTokens) && opts.maxTokens >= 1
      ? Math.trunc(opts.maxTokens)
      : DEFAULT_MAX_TOKENS;

  const stream = client.messages.stream(
    {
      model: settings.model,
      max_tokens: maxTokens,
      system: opts.systemPrompt,
      messages: opts.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    },
    opts.signal ? { signal: opts.signal } : undefined,
  );

  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<string, void, undefined> {
      let finished = false;
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            if (event.delta.text.length > 0) {
              yield event.delta.text;
            }
          }
        }
        finished = true;
      } catch (err) {
        throw normalizeUpstreamError(err, 'anthropic');
      } finally {
        if (!finished) {
          stream.abort();
        }
      }
    },
  };
}

async function openOpenAiCompatibleStream(
  opts: StreamLlmOptions,
  settings: OpenAiProviderSettings,
): Promise<AsyncIterable<string>> {
  if (opts.messages.length === 0) {
    throw new LlmConfigError('At least one chat message is required.', settings.kind);
  }

  const endpoint = `${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const maxTokens =
    opts.maxTokens !== undefined && Number.isFinite(opts.maxTokens) && opts.maxTokens >= 1
      ? Math.trunc(opts.maxTokens)
      : DEFAULT_MAX_TOKENS;

  const controller = new AbortController();
  const onExternalAbort = () => {
    controller.abort(opts.signal?.reason);
  };
  if (opts.signal) {
    if (opts.signal.aborted) {
      throw new LlmUpstreamError('Request aborted before upstream fetch.', settings.kind);
    }
    opts.signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  let timedOut = false;
  const connectTimer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('Upstream connection timeout'));
  }, DEFAULT_CONNECT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        stream: true,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: opts.systemPrompt },
          ...opts.messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(connectTimer);
    opts.signal?.removeEventListener('abort', onExternalAbort);
    const reason = timedOut
      ? `Upstream ${settings.kind} timed out after ${DEFAULT_CONNECT_TIMEOUT_MS}ms`
      : err instanceof Error
        ? err.message
        : String(err);
    throw new LlmUpstreamError(reason, settings.kind);
  }

  clearTimeout(connectTimer);

  if (!response.ok) {
    opts.signal?.removeEventListener('abort', onExternalAbort);
    const detail = (await response.text().catch(() => '')).slice(0, 400).trim();
    throw new LlmUpstreamError(
      `Upstream ${settings.kind} returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
      settings.kind,
      response.status,
    );
  }

  if (!response.body) {
    opts.signal?.removeEventListener('abort', onExternalAbort);
    throw new LlmUpstreamError(
      `Upstream ${settings.kind} returned an empty response body.`,
      settings.kind,
      response.status,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  const extractDeltaFromLine = (rawLine: string): { delta?: string; done?: boolean } => {
    const line = rawLine.trim();
    if (!line || line.startsWith(':') || !line.startsWith('data:')) {
      return {};
    }
    const payload = line.slice(5).trim();
    if (!payload) return {};
    if (payload === '[DONE]') return { done: true };

    let parsed: OpenAiStreamChunk;
    try {
      parsed = JSON.parse(payload) as OpenAiStreamChunk;
    } catch {
      return {};
    }
    if (parsed.error?.message) {
      throw new LlmUpstreamError(
        `Upstream ${settings.kind} stream error: ${parsed.error.message}`,
        settings.kind,
      );
    }
    const content = parsed.choices?.[0]?.delta?.content;
    return typeof content === 'string' && content.length > 0 ? { delta: content } : {};
  };

  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<string, void, undefined> {
      let buffer = '';
      let streamClosed = false;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            streamClosed = true;
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const parsed = extractDeltaFromLine(line);
            if (parsed.done) {
              streamClosed = true;
              return;
            }
            if (parsed.delta) {
              yield parsed.delta;
            }
          }
        }

        const trailing = buffer + decoder.decode();
        if (trailing.trim()) {
          for (const line of trailing.split(/\r?\n/)) {
            const parsed = extractDeltaFromLine(line);
            if (parsed.done) return;
            if (parsed.delta) {
              yield parsed.delta;
            }
          }
        }
      } catch (err) {
        throw normalizeUpstreamError(err, settings.kind);
      } finally {
        opts.signal?.removeEventListener('abort', onExternalAbort);
        if (!streamClosed) {
          await reader.cancel().catch(() => undefined);
        }
        try {
          reader.releaseLock();
        } catch {
          // ignore if already released
        }
      }
    },
  };
}

// ────────────────── Public SSE Streaming Entrypoint ──────────────────

/**
 * Resolve configured AI provider (or active test adapter), validate credentials
 * before starting, and return an SSE `ReadableStream<Uint8Array>` compatible with
 * `InsightPanel.tsx` and `app/heming/page.tsx`.
 */
export async function streamLlmSse(
  opts: StreamLlmOptions,
): Promise<ReadableStream<Uint8Array>> {
  const config = getServerConfig();

  if (opts.signal?.aborted) {
    throw new LlmUpstreamError('Request aborted before LLM stream started.', config.aiProvider);
  }

  let iterable: AsyncIterable<string>;
  if (testStreamAdapter !== null) {
    iterable = testStreamAdapter(opts, config);
  } else {
    const settings = resolveProviderSettings(config);
    if (settings.kind === 'anthropic') {
      iterable = await openAnthropicStream(opts, settings);
    } else {
      iterable = await openOpenAiCompatibleStream(opts, settings);
    }
  }

  const encoder = new TextEncoder();
  const iterator = iterable[Symbol.asyncIterator]();
  let fullText = '';
  let finished = false;
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (cancelled || finished) return;
      try {
        while (true) {
          if (opts.signal?.aborted) {
            throw new LlmUpstreamError('LLM stream aborted by signal.', config.aiProvider);
          }
          const step = await iterator.next();
          if (cancelled) return;
          if (step.done) {
            finished = true;
            await opts.onComplete?.(fullText);
            if (cancelled) return;
            controller.enqueue(encoder.encode(SSE_DONE_EVENT));
            controller.close();
            return;
          }
          const delta = step.value;
          if (typeof delta === 'string' && delta.length > 0) {
            fullText += delta;
            controller.enqueue(encoder.encode(formatSseDelta(delta)));
            return;
          }
        }
      } catch (err) {
        finished = true;
        await iterator.return?.().catch(() => undefined);
        if (!cancelled) {
          controller.error(normalizeUpstreamError(err, config.aiProvider));
        }
      }
    },
    async cancel() {
      cancelled = true;
      finished = true;
      await iterator.return?.().catch(() => undefined);
    },
  });
}
