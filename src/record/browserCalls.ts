import type {
  BrowserContext,
  Request,
  Response,
  TestInfo,
} from '@playwright/test';
import {
  createRedactor,
  type RedactionOptions,
  type Redactor,
} from './redaction.js';

export interface BrowserApiCallOptions {
  /**
   * Which requests count as API calls: a URL prefix (or several), or a
   * function. Any resource type is recorded: fetch, form posts, navigations.
   */
  match: string | string[] | ((url: string) => boolean);
  redact?: RedactionOptions;
}

function matcher(
  match: BrowserApiCallOptions['match'],
): (url: string) => boolean {
  if (typeof match === 'function') return match;
  const prefixes = [match].flat();
  // A prefix built from an unset baseURL is "undefined/api/", which matches
  // nothing; fail rather than record nothing.
  for (const prefix of prefixes) {
    if (typeof prefix !== 'string' || !/^https?:\/\/[^/]/.test(prefix)) {
      throw new Error(
        `living-docs: recordBrowserApiCalls: "match" must be a full URL prefix such as https://shop.example.com/api/, or a function; got ${JSON.stringify(prefix)}. Is baseURL set in the Playwright config?`,
      );
    }
  }
  if (prefixes.length === 0) {
    throw new Error(
      'living-docs: recordBrowserApiCalls: "match" lists no URL prefixes',
    );
  }
  return (url) => prefixes.some((prefix) => url.startsWith(prefix));
}

function pathOf(url: string): string {
  const { pathname, search } = new URL(url);
  return `${pathname}${search}`;
}

/**
 * Marks a call as the browser's, with when it started and how long it took,
 * so the report can place it under the step that was running. The attachment
 * itself lands later, when the response arrives.
 */
function browserOrigin(request: Request, seenAt?: number) {
  // responseEnd is milliseconds after startTime, or -1 when not available. A
  // request that got no response has no startTime, so the time it was seen
  // stands in.
  const { startTime, responseEnd } = request.timing();
  const started = startTime > 0 ? startTime : seenAt;
  return {
    source: 'browser' as const,
    startedAt: started ? new Date(started).toISOString() : undefined,
    durationMs: responseEnd >= 0 ? Math.round(responseEnd) : undefined,
  };
}

async function describeRequest(redactor: Redactor, request: Request) {
  // `allHeaders()` includes cookies; the redactor covers them by default.
  const headers = await request.allHeaders().catch(() => request.headers());
  const post = request.postData();
  return {
    method: request.method(),
    url: request.url(),
    headers: redactor.headers(headers),
    body: post === null ? undefined : redactor.text(post, 'request'),
  };
}

async function attachResponse(
  testInfo: TestInfo,
  redactor: Redactor,
  response: Response,
): Promise<void> {
  const request = response.request();
  const described = await describeRequest(redactor, request);
  // A redirect or an aborted response has no body to read.
  const text = await response.text().catch(() => undefined);
  const headers = await response.allHeaders().catch(() => response.headers());
  await testInfo.attach(
    `${described.method} ${pathOf(described.url)} → ${response.status()} (browser)`,
    {
      body: JSON.stringify(
        {
          ...browserOrigin(request),
          request: described,
          response: {
            status: response.status(),
            statusText: response.statusText(),
            headers: redactor.headers(headers),
            body:
              text === undefined ? undefined : redactor.text(text, 'response'),
          },
        },
        null,
        2,
      ),
      contentType: 'application/json',
    },
  );
}

async function attachFailure(
  testInfo: TestInfo,
  redactor: Redactor,
  request: Request,
  seenAt: number | undefined,
): Promise<void> {
  const described = await describeRequest(redactor, request);
  await testInfo.attach(
    `${described.method} ${pathOf(described.url)} → no response (browser)`,
    {
      body: JSON.stringify(
        {
          ...browserOrigin(request, seenAt),
          request: described,
          error: redactor.scrub(
            request.failure()?.errorText ?? 'request failed',
          ),
        },
        null,
        2,
      ),
      contentType: 'application/json',
    },
  );
}

/**
 * Records the API calls the page makes in the browser as JSON attachments,
 * which the living-docs reporter shows as Browser API steps under the step
 * that was running. Calls a server makes (SSR) never pass through the
 * browser, so they cannot be seen.
 *
 * Returns a function that waits for every pending attachment: call it before
 * the test ends, or an attachment is lost.
 *
 * ```ts
 * context: async ({ context }, use, testInfo) => {
 *   const settle = recordBrowserApiCalls(context, testInfo, { match: 'https://example.com/api/' });
 *   await use(context);
 *   await settle();
 * },
 * ```
 */
export function recordBrowserApiCalls(
  context: BrowserContext,
  testInfo: TestInfo,
  options: BrowserApiCallOptions,
): () => Promise<void> {
  const redactor = createRedactor(options.redact);
  const isApiCall = matcher(options.match);
  const pending = new Set<Promise<void>>();
  const seenAt = new WeakMap<Request, number>();

  const track = (work: Promise<void>): void => {
    const tracked = work.catch(() => {
      // Recording is best effort: a page closing mid-read must not fail a test.
    });
    pending.add(tracked);
    void tracked.finally(() => pending.delete(tracked));
  };

  context.on('request', (request) => {
    if (isApiCall(request.url())) seenAt.set(request, Date.now());
  });
  context.on('response', (response) => {
    if (isApiCall(response.url())) {
      track(attachResponse(testInfo, redactor, response));
    }
  });
  context.on('requestfailed', (request) => {
    if (isApiCall(request.url())) {
      track(attachFailure(testInfo, redactor, request, seenAt.get(request)));
    }
  });

  return async () => {
    // Waiting can let more responses arrive, so loop until none are left.
    while (pending.size > 0) await Promise.all([...pending]);
  };
}
