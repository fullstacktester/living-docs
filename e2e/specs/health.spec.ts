import { expect, test } from '../fixtures';

// Straight in testDir: level Other, feature Health.
test('the shop is up', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.ok(), 'the shop answers').toBe(true);
});
