/**
 * What the recorders hide before a call reaches the report. Defaults cover
 * common credentials; a project adds its own names (a WAF bypass header, a
 * one-time code field) through `RedactionOptions`.
 */
export interface RedactionOptions {
  /** Extra header names to redact (case-insensitive). */
  headers?: string[];
  /** Extra JSON or form keys to redact in request and response bodies. */
  keys?: string[];
  /**
   * Extra keys to redact in request bodies only, for names a response uses
   * for something harmless (an error envelope's `code`, say).
   */
  requestKeys?: string[];
  /** Replace the default lists instead of adding to them. Default false. */
  replaceDefaults?: boolean;
  /** Longest body text kept, in characters. Default 200000. */
  maxBodyChars?: number;
}

export const DEFAULT_REDACTED_HEADERS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
];

export const DEFAULT_REDACTED_KEYS = [
  'password',
  'secret',
  'client_secret',
  'api_key',
  'code_verifier',
  'access_token',
  'id_token',
  'refresh_token',
  'token',
];

export const REDACTED = '[redacted]';

export interface Redactor {
  headers(headers: Record<string, string> | undefined): Record<string, string>;
  /** A request body as given to Playwright (object, string or Buffer). */
  requestBody(data: unknown, form?: Record<string, unknown>): unknown;
  /** Body text: parsed and redacted when JSON (or, for requests, a form). */
  text(text: string, side: 'request' | 'response'): unknown;
  /** Removes secret header lines from text holding Playwright's call log. */
  scrub(text: string): string;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createRedactor(options: RedactionOptions = {}): Redactor {
  const base = options.replaceDefaults ? [] : DEFAULT_REDACTED_HEADERS;
  const headerNames = new Set(
    [...base, ...(options.headers ?? [])].map((h) => h.toLowerCase()),
  );
  const keys = new Set(
    [
      ...(options.replaceDefaults ? [] : DEFAULT_REDACTED_KEYS),
      ...(options.keys ?? []),
    ].map((k) => k.toLowerCase()),
  );
  const requestKeys = new Set(
    [...(options.requestKeys ?? [])].map((k) => k.toLowerCase()),
  );
  const maxBodyChars = options.maxBodyChars ?? 200_000;
  const headerLine =
    headerNames.size > 0
      ? new RegExp(
          `^.*\\b(${[...headerNames].map(escapeRegExp).join('|')})\\b.*$`,
          'gim',
        )
      : undefined;

  const isSecret = (side: 'request' | 'response') => (key: string) => {
    const k = key.toLowerCase();
    return keys.has(k) || (side === 'request' && requestKeys.has(k));
  };

  const redactValue = (
    value: unknown,
    secret: (key: string) => boolean,
  ): unknown => {
    if (Array.isArray(value)) return value.map((v) => redactValue(v, secret));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, inner]) => [
          key,
          secret(key) ? REDACTED : redactValue(inner, secret),
        ]),
      );
    }
    return value;
  };

  const text = (raw: string, side: 'request' | 'response'): unknown => {
    const secret = isSecret(side);
    try {
      return redactValue(JSON.parse(raw), secret);
    } catch {
      // A request body that is not JSON may be form-encoded.
      if (side === 'request' && raw.includes('=')) {
        const pairs = [...new URLSearchParams(raw)];
        if (pairs.length > 0) {
          return redactValue(Object.fromEntries(pairs), secret);
        }
      }
      return raw.length > maxBodyChars
        ? `${raw.slice(0, maxBodyChars)}... [truncated]`
        : raw;
    }
  };

  return {
    headers: (headers) =>
      Object.fromEntries(
        Object.entries(headers ?? {}).map(([name, value]) => [
          name,
          headerNames.has(name.toLowerCase()) ? REDACTED : value,
        ]),
      ),
    requestBody: (data, form) => {
      if (data === undefined) {
        return form ? redactValue(form, isSecret('request')) : undefined;
      }
      if (Buffer.isBuffer(data)) return text(data.toString(), 'request');
      if (typeof data === 'string') return text(data, 'request');
      return redactValue(data, isSecret('request'));
    },
    text,
    scrub: (raw) =>
      headerLine ? raw.replace(headerLine, `  ${REDACTED}`) : raw,
  };
}
