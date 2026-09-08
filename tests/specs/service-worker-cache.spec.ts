/**
 * The production service worker caches API responses so the app works offline.
 * Those responses are account data — note bodies, and the `serverShare` half of
 * the encryption key — and Cache Storage outlives the cookie that fetched them,
 * so a signed-out device kept answering those reads from disk. Sign-out has to
 * take the caches with it, the same way it already takes the IndexedDB query
 * cache.
 *
 * These are the only tests that let the service worker run; everything else
 * blocks it (see playwright.config.ts).
 */
import { test, expect } from '@playwright/test';
import { makeAccount } from '../utils/makeAccount';
import { createTestSession } from '../utils/createTestSession';
import { injectSession } from '../utils/injectSession';
import { seedNotes } from '../fixtures/seedNotes';
import { trpcQuery } from '../utils/trpc';

test.describe.configure({ mode: 'parallel' });

const NOTES_URL = '/api/trpc/notes.list?input=%7B%7D';

test.describe('service worker cache', () => {
  test.use({ serviceWorkers: 'allow' });

  test('sign-out purges cached account data from Cache Storage', async ({ page, context }) => {
    const sentinel = `SW_CACHE_PROBE_${crypto.randomUUID()}`;
    const account = makeAccount().account;
    await seedNotes(account.address, [{ title: 'Cache probe', content: sentinel }]);
    await injectSession(page, await createTestSession(account.address));

    // Install and take control, then prime the runtime cache.
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await page.evaluate(async (url) => (await fetch(url)).json(), NOTES_URL);

    const cacheHolds = (needle: string) =>
      page.evaluate(async (probe) => {
        for (const name of await caches.keys()) {
          const cache = await caches.open(name);
          for (const request of await cache.keys()) {
            const hit = await cache.match(request);
            if (hit && (await hit.text()).includes(probe)) return true;
          }
        }
        return false;
      }, needle);

    await expect.poll(() => cacheHolds(sentinel)).toBe(true);

    const { csrfToken } = await (await page.request.get('/api/auth/csrf')).json();
    await page.request.post('/api/auth/signout', { form: { csrfToken, json: 'true' } });

    // The app has to observe the sign-out for its cleanup to run.
    await page.goto('/');
    await expect(page.getByTestId('sign-in-button').first()).toBeVisible();
    expect((await trpcQuery(page.request, 'notes.list', {})).status()).toBe(401);

    await expect.poll(() => cacheHolds(sentinel)).toBe(false);

    // …and the purge is real, not just invisible to `caches.match`: offline,
    // there is nothing left for the service worker to serve.
    await context.setOffline(true);
    const offlineBody = await page.evaluate(async (url) => {
      try {
        return await (await fetch(url)).text();
      } catch {
        return null;
      }
    }, NOTES_URL);
    await context.setOffline(false);

    expect(offlineBody ?? '').not.toContain(sentinel);
  });
});
