/**
 * Bounded request body reader helpers to protect Route Handlers from oversized
 * JSON or raw text payloads (returns 413 PAYLOAD_TOO_LARGE before buffering).
 */

export const MAX_CHART_BODY_BYTES = 128 * 1024;
export const MAX_AI_BODY_BYTES = 128 * 1024;
export const MAX_BILLING_BODY_BYTES = 32 * 1024;

export type BodyReadFailure = {
  ok: false;
  status: 400 | 413;
  error: string;
  code: string;
  message: string;
};

export type BodyReadResult<T> = { ok: true; value: T } | BodyReadFailure;

function parseContentLengthHeader(req: Request): number | null {
  const raw = req.headers.get('content-length');
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function payloadTooLargeFailure(maxBytes: number): BodyReadFailure {
  return {
    ok: false,
    status: 413,
    error: 'payload_too_large',
    code: 'PAYLOAD_TOO_LARGE',
    message: `Request body exceeds maximum allowed size of ${maxBytes} bytes.`,
  };
}

/**
 * Read a request body as UTF-8 text while enforcing a hard `maxBytes` limit.
 * Fails fast on oversized `Content-Length` headers and cancels chunked streams
 * immediately once accumulated byte length exceeds `maxBytes`.
 */
export async function readTextBodyWithLimit(
  req: Request,
  maxBytes: number,
): Promise<BodyReadResult<string>> {
  const declaredLength = parseContentLengthHeader(req);
  if (declaredLength !== null && declaredLength > maxBytes) {
    return payloadTooLargeFailure(maxBytes);
  }

  if (req.body === null) {
    const raw = await req.text();
    if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
      return payloadTooLargeFailure(maxBytes);
    }
    return { ok: true, value: raw };
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return payloadTooLargeFailure(maxBytes);
      }
      chunks.push(value);
    }
  } catch {
    return {
      ok: false,
      status: 400,
      error: 'invalid_body',
      code: 'BAD_REQUEST',
      message: 'Failed to read request body.',
    };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore if reader is already closed or released.
    }
  }

  const merged = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)), totalBytes);
  return { ok: true, value: merged.toString('utf8') };
}

/**
 * Read and parse a JSON object request body with a hard `maxBytes` limit.
 */
export async function readJsonBodyWithLimit(
  req: Request,
  maxBytes: number,
  options?: { nonObjectError?: string; invalidJsonMessage?: string },
): Promise<BodyReadResult<Record<string, unknown>>> {
  const textResult = await readTextBodyWithLimit(req, maxBytes);
  if (!textResult.ok) {
    return textResult;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(textResult.value);
  } catch {
    return {
      ok: false,
      status: 400,
      error: 'invalid_json',
      code: 'BAD_REQUEST',
      message: options?.invalidJsonMessage ?? 'Request body must be valid JSON.',
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      status: 400,
      error: options?.nonObjectError ?? 'invalid_body',
      code: 'BAD_REQUEST',
      message: 'Request body must be a JSON object.',
    };
  }

  return { ok: true, value: parsed as Record<string, unknown> };
}
