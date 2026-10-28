import { about } from '@fullstacktester/living-docs/annotations';
import { expect, test } from '../../fixtures';

// Straight in a level folder with a long name: level Contract, and the spec is
// its own feature, Orders schema.
test(
  'an order has an id and an item',
  about('Clients rely on every order having these fields.'),
  async ({ request }) => {
    const response = await request.get('/api/orders');
    const { items } = await response.json();
    expect(items[0]).toEqual({
      id: expect.any(Number),
      item: expect.any(String),
    });
  },
);
