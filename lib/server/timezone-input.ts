/**
 * Strict timeZone / tz validation helpers shared across API Route Handlers.
 * Ensures unknown zones like `Not/AZone` return HTTP 400 instead of silently
 * falling back to defaults.
 */
import {
  isValidTimeZone,
  isValidUtcOffsetMinutes,
} from '@/lib/ziwei/true-solar-time';

export type TimeZoneParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

export function parseIanaTimeZoneField(
  raw: unknown,
  fieldName: string,
): TimeZoneParseResult<string | undefined> {
  if (raw === undefined || raw === null) {
    return { ok: true, value: undefined };
  }
  if (typeof raw !== 'string') {
    return { ok: false, message: `${fieldName} must be a string` };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: `${fieldName} must be a valid IANA time zone` };
  }
  if (!isValidTimeZone(trimmed)) {
    return { ok: false, message: `Invalid ${fieldName}: ${trimmed}` };
  }
  return { ok: true, value: trimmed };
}

export interface ParsedTzAlias {
  timeZone?: string;
  utcOffsetMinutes?: number;
}

export function parseTzAliasField(
  raw: unknown,
  fieldName: string,
): TimeZoneParseResult<ParsedTzAlias> {
  if (raw === undefined || raw === null) {
    return { ok: true, value: {} };
  }
  if (typeof raw === 'number') {
    if (!isValidUtcOffsetMinutes(raw)) {
      return {
        ok: false,
        message: `${fieldName} offset must be an integer in [-720, 840]`,
      };
    }
    return { ok: true, value: { utcOffsetMinutes: raw } };
  }
  if (typeof raw !== 'string') {
    return {
      ok: false,
      message: `${fieldName} must be a valid IANA time zone or UTC offset in minutes`,
    };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: `${fieldName} must not be empty` };
  }
  if (/^[+-]?\d+$/.test(trimmed)) {
    const offset = Number(trimmed);
    if (!isValidUtcOffsetMinutes(offset)) {
      return {
        ok: false,
        message: `${fieldName} offset must be an integer in [-720, 840]`,
      };
    }
    return { ok: true, value: { utcOffsetMinutes: offset } };
  }
  if (!isValidTimeZone(trimmed)) {
    return { ok: false, message: `Invalid ${fieldName}: ${trimmed}` };
  }
  return { ok: true, value: { timeZone: trimmed } };
}

export function parseQueryTimezoneParams(req: Request): TimeZoneParseResult<ParsedTzAlias> {
  let searchParams: URLSearchParams;
  try {
    searchParams = new URL(req.url).searchParams;
  } catch {
    return { ok: true, value: {} };
  }

  let merged: ParsedTzAlias = {};
  const rawQueryTz = searchParams.get('tz');
  if (rawQueryTz !== null) {
    const parsedTz = parseTzAliasField(rawQueryTz, 'tz');
    if (!parsedTz.ok) return parsedTz;
    merged = { ...merged, ...parsedTz.value };
  }

  const rawQueryTimeZone = searchParams.get('timeZone');
  if (rawQueryTimeZone !== null) {
    const parsedTimeZone = parseIanaTimeZoneField(rawQueryTimeZone, 'timeZone');
    if (!parsedTimeZone.ok) return parsedTimeZone;
    if (parsedTimeZone.value !== undefined) {
      merged.timeZone = parsedTimeZone.value;
    }
  }

  return { ok: true, value: merged };
}

export function parseRequestTimezoneOverride(
  req: Request,
  rawBody: Record<string, unknown>,
): TimeZoneParseResult<ParsedTzAlias> {
  const queryZone = parseQueryTimezoneParams(req);
  if (!queryZone.ok) return queryZone;

  const bodyTz = parseTzAliasField(rawBody.tz, 'tz');
  if (!bodyTz.ok) return bodyTz;

  const bodyTimeZone = parseIanaTimeZoneField(rawBody.timeZone, 'timeZone');
  if (!bodyTimeZone.ok) return bodyTimeZone;

  return {
    ok: true,
    value: {
      ...queryZone.value,
      ...bodyTz.value,
      ...(bodyTimeZone.value !== undefined ? { timeZone: bodyTimeZone.value } : {}),
    },
  };
}
