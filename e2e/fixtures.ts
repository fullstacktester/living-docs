import { test as base } from '@playwright/test';
// The package's own published entry points, resolved through `exports`.
import {
  recordBrowserApiCalls,
  withApiAttachments,
} from '@fullstacktester/living-docs/record';

const redact = { headers: ['x-shop-secret'], requestKeys: ['otp'] };

export const test = base.extend({
  request: async ({ request, extraHTTPHeaders }, use, testInfo) => {
    await use(
      withApiAttachments(request, testInfo, { extraHTTPHeaders, redact }),
    );
  },
  context: async ({ context, baseURL }, use, testInfo) => {
    const settle = recordBrowserApiCalls(context, testInfo, {
      match: `${baseURL}/api/`,
      redact,
    });
    await use(context);
    await settle();
  },
});

export { expect } from '@playwright/test';
