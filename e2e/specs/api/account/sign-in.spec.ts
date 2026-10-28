import { about } from '@fullstacktester/living-docs/annotations';
import { expect, test } from '../../../fixtures';

// One test of each outcome the report shows: passed, failed, flaky and
// skipped. The failing and flaky ones fail on purpose; run.mjs expects them.
test.describe('signing in', () => {
  test(
    'a shopper with the right password gets a session',
    about('A shopper who signs in can carry on where they left off.', {
      tag: ['@smoke', '@account'],
      issue: [
        'SHOP-7',
        'https://tracker.example.com/browse/SHOP-8',
        'Raised in the sprint review',
      ],
    }),
    async ({ request }) => {
      await test.step('sign in', async () => {
        await test.step('send the credentials', async () => {
          await test.step('with a one-time code', async () => {
            const response = await request.post('/api/sign-in', {
              data: { user: 'sam', password: 'right', otp: '123456' },
            });
            expect(response.status(), 'status is 200').toBe(200);
          });
        });
        await test.step('check the session', async () => {
          const response = await request.get('/api/session');
          expect(await response.json()).toEqual({ active: true });
        });
      });
    },
  );

  test(
    'a shopper with a wrong password is told why',
    about('A refused sign-in says what was wrong. Fails on purpose.'),
    async ({ request }) => {
      await test.step('sign in', async () => {
        await test.step('send a wrong password', async () => {
          const response = await request.post('/api/sign-in', {
            data: { user: 'sam', password: 'wrong' },
          });
          expect(await response.json(), 'the reason is given').toEqual({
            error: 'wrong password',
          });
        });
      });
    },
  );

  test(
    'the session is found on retry',
    about('Passes on its second attempt, on purpose.'),
    async ({ request }, testInfo) => {
      await test.step('look up the session', async () => {
        const response = await request.get('/api/session');
        expect(response.status(), 'status is 200').toBe(200);
        expect(testInfo.retry, 'this is a retry').toBeGreaterThan(0);
      });
    },
  );

  test.fixme(
    'a shopper signs in with a passkey',
    about('Passkeys are not built yet.'),
    async () => {},
  );
});
