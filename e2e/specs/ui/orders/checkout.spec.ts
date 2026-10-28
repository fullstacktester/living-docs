import { about } from '@fullstacktester/living-docs/annotations';
import { expect, test } from '../../../fixtures';

test(
  'a shopper buys a kettle',
  about('Buying from the checkout page places the order and shows its number.'),
  async ({ page }) => {
    await test.step('open the checkout', async () => {
      await page.goto('/checkout');
    });
    await test.step('buy', async () => {
      await test.step('press Buy', async () => {
        await page.getByRole('button', { name: 'Buy' }).click();
      });
      await expect(
        page.getByText('Order 42'),
        'the order number is shown',
      ).toBeVisible();
    });
  },
);
