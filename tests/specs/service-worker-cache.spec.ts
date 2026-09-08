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
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';
import { SecretsPage } from '../pages/SecretsPage';
import { trpcQuery } from '../utils/trpc';
import { setSecurityPreference } from '../utils/securityPreference';

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

/**
 * `serverShare` is one half of the master key; the passphrase derives the
 * other. Keeping both on one device is the margin the split exists to protect,
 * so the service worker never takes that response as a side effect of a fetch
 * — it is stored only when the account has opted in, and then by name, in
 * `lib/encryptionMaterialStore.ts`.
 */
test.describe('encryption material is never cached by the service worker', () => {
  test.use({ serviceWorkers: 'allow' });

  test('unlocking leaves no copy of serverShare in Cache Storage', async ({ page }) => {
    const account = makeAccount().account;
    await seedEncryptionProfile(account.address, SecretsPage.PASSPHRASE);
    await injectSession(page, await createTestSession(account.address));

    await page.goto('/secrets');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

    const model = new SecretsPage(page);
    await model.unlock();

    // Unlocking has just fetched the material, so this is the moment a
    // NetworkFirst rule would have written it.
    // Scoped to API responses: the /recover page's own JS chunk names the field
    // in its source, and a precached script is not a copy of anyone's key.
    const cached = await page.evaluate(async () => {
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          if (!request.url.includes('/api/')) continue;
          const hit = await cache.match(request);
          if (hit && (await hit.text()).includes('serverShare')) return request.url;
        }
      }
      return null;
    });

    expect(cached).toBeNull();
  });

  test('and no device copy either, until the account asks for one', async ({ page }) => {
    const account = makeAccount().account;
    await seedEncryptionProfile(account.address, SecretsPage.PASSPHRASE);
    await injectSession(page, await createTestSession(account.address));

    await page.goto('/secrets');
    const model = new SecretsPage(page);
    await model.unlock();

    const storedKeys = () =>
      page.evaluate(
        () =>
          new Promise<string[]>((resolve) => {
            const open = indexedDB.open('signote-encryption');
            open.onerror = () => resolve([]);
            open.onsuccess = () => {
              const db = open.result;
              if (!db.objectStoreNames.contains('material')) return resolve([]);
              const request = db.transaction('material', 'readonly').objectStore('material').getAllKeys();
              request.onerror = () => resolve([]);
              request.onsuccess = () => resolve(request.result.map(String));
            };
          }),
      );

    expect(await storedKeys()).toEqual([]);

    await page.goto('/profile');
    await setSecurityPreference(page, 'pref-cache-server-share', true);

    // Opting in fetches once so the setting is true immediately, rather than
    // only after the next unlock — a user who opts in and goes offline would
    // otherwise find the switch had done nothing.
    await expect.poll(storedKeys).toHaveLength(1);

    await setSecurityPreference(page, 'pref-cache-server-share', false);

    await expect.poll(storedKeys).toEqual([]);
  });
});
