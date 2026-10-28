import type {
  APIRequestContext,
  APIResponse,
  TestInfo,
} from '@playwright/test';
import {
  createRedactor,
  type RedactionOptions,
  type Redactor,
} from './redaction.js';

export interface ApiAttachmentOptions {
  /**
   * Headers the context sends on every request (its `extraHTTPHeaders`), so
   * the report shows them too. Redacted like any other header.
   */
  extraHTTPHeaders?: Record<string, string>;
  redact?: RedactionOptions;
}

const VERBS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'fetch'];

interface CallOptions {
  headers?: Record<string, string>;
  data?: unknown;
  form?: Record<string, unknown>;
  method?: string;
}

function pathOf(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

async function attachCall(
  testInfo: TestInfo,
  redactor: Redactor,
  method: string,
  url: string,
  options: CallOptions,
  sentHeaders: Record<string, string>,
  outcome: { response: APIResponse } | { error: unknown },
): Promise<void> {
  const request = {
    method,
    url,
    headers: redactor.headers(sentHeaders),
    body: redactor.requestBody(options.data, options.form),
  };

  if ('error' in outcome) {
    // Playwright's call log lists every request header, so secret header
    // lines are scrubbed from the message.
    const message = redactor.scrub(
      outcome.error instanceof Error
        ? outcome.error.message
        : String(outcome.error),
    );
    await testInfo.attach(`${method} ${pathOf(url)} → no response`, {
      body: JSON.stringify(
        { source: 'test', request, error: message },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    return;
  }

  const { response } = outcome;
  // Playwright buffers the body, so reading it here leaves it readable for
  // the caller.
  const text = await response.text();
  await testInfo.attach(`${method} ${pathOf(url)} → ${response.status()}`, {
    body: JSON.stringify(
      {
        source: 'test',
        request,
        response: {
          status: response.status(),
          statusText: response.statusText(),
          headers: redactor.headers(response.headers()),
          body: redactor.text(text, 'response'),
        },
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
}

/**
 * Wraps an API request context so every call it makes is attached to the test
 * as a JSON attachment (request and response, secrets redacted), which the
 * living-docs reporter shows as a Test API step. Callers get the same
 * `APIResponse` back, so tests do not change.
 *
 * ```ts
 * request: async ({ request, extraHTTPHeaders }, use, testInfo) => {
 *   await use(withApiAttachments(request, testInfo, { extraHTTPHeaders }));
 * },
 * ```
 */
export function withApiAttachments(
  context: APIRequestContext,
  testInfo: TestInfo,
  options: ApiAttachmentOptions = {},
): APIRequestContext {
  const redactor = createRedactor(options.redact);
  return new Proxy(context, {
    get(target, prop) {
      const member = Reflect.get(target, prop, target) as unknown;
      if (typeof member !== 'function') return member;
      if (typeof prop !== 'string' || !VERBS.includes(prop)) {
        return member.bind(target);
      }

      return async (urlOrRequest: string | { url(): string }, opts = {}) => {
        const callOptions = opts as CallOptions;
        const rawUrl =
          typeof urlOrRequest === 'string' ? urlOrRequest : urlOrRequest.url();
        const method = (
          prop === 'fetch' ? (callOptions.method ?? 'GET') : prop
        ).toUpperCase();
        const sentHeaders = {
          ...options.extraHTTPHeaders,
          ...callOptions.headers,
        };
        try {
          const response = (await member.call(
            target,
            urlOrRequest,
            opts,
          )) as APIResponse;
          await attachCall(
            testInfo,
            redactor,
            method,
            response.url(),
            callOptions,
            sentHeaders,
            { response },
          );
          return response;
        } catch (error) {
          // A relative URL cannot be resolved without the base, so the raw
          // one is reported when the call never produced a response.
          const absolute = /^https?:/.test(rawUrl)
            ? rawUrl
            : new URL(rawUrl, 'http://unresolved.invalid/').href;
          await attachCall(
            testInfo,
            redactor,
            method,
            absolute,
            callOptions,
            sentHeaders,
            { error },
          );
          if (error instanceof Error) {
            error.message = redactor.scrub(error.message);
            if (error.stack) error.stack = redactor.scrub(error.stack);
          }
          throw error;
        }
      };
    },
  });
}
