import { about } from '@fullstacktester/living-docs/annotations';
import { expect, test } from '../../../fixtures';

test(
  'lists orders',
  about('A shopper can see the orders they have placed.', {
    tag: '@smoke',
    issue: 'SHOP-1',
  }),
  async ({ request }) => {
    const response = await request.get('/api/orders', {
      headers: { 'x-shop-secret': 'api-secret' },
    });
    expect(response.status(), 'status is 200').toBe(200);
  },
);

test(
  'places an order',
  about('Placing an order returns its number.'),
  async ({ request }) => {
    await test.step('send the order', async () => {
      const response = await request.post('/api/orders', {
        data: { item: 'kettle', password: 'api-pass' },
      });
      expect(response.status(), 'status is 201').toBe(201);
    });
  },
);
