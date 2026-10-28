import { about } from '@fullstacktester/living-docs/annotations';
import { expect, test } from '../../../fixtures';

test(
  'a shopper subscribes to the newsletter',
  about('Subscribing posts the form and thanks the shopper.', {
    tag: '@account',
  }),
  async ({ page }, testInfo) => {
    await test.step('open the newsletter page', async () => {
      // The stock check gets no response, so the report shows a failed call.
      await page.route('**/api/stock', (route) => route.abort());
      await page.goto('/newsletter');
      await expect(page.getByText('Stock unknown')).toBeVisible();
    });
    await test.step('subscribe', async () => {
      await page.getByLabel('Email').fill('sam@example.com');
      await testInfo.attach('subscriber', {
        body: 'sam@example.com',
        contentType: 'text/plain',
      });
      await page.getByRole('button', { name: 'Subscribe' }).click();
      await expect(
        page.getByRole('heading', { name: 'Thanks for subscribing' }),
      ).toBeVisible();
    });
  },
);
