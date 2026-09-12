import { test, expect } from '@playwright/test';
import { RotationPage } from '../pages/RotationPage';
import { seedSecrets } from '../fixtures/seedSecrets';
import { getOrCreateUserId } from '../fixtures/getOrCreateUserId';
import { decryptSecretHead, mekFromPassphrase } from '../utils/vaultCrypto';

test.use({ serviceWorkers: 'allow' });
test.setTimeout(180_000);

test('the production worker purges inherited ciphertext and refuses stale offline responses', async ({
  page,
  context,
}) => {
  // JSON document establishes the origin without mounting the app's registration component.
  await page.goto('/api/auth/session');
  const paths = [
    '/api/trpc/rotation.status',
    '/api/trpc/notes.list,secrets.list?batch=1',
    '/api/trpc/encryption.profile',
    '/api/files/stale-file',
  ];
  const signed = 'https://storage.example.test/legacy/file.bin?X-Amz-Signature=stale';
  await page.evaluate(
    async ({ paths, signed }) => {
      const cache = await caches.open('apis');
      for (const url of [...paths, signed]) await cache.put(url, new Response('STALE-CIPHERTEXT'));
      await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
    },
    { paths, signed },
  );
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect.poll(() => page.evaluate(async () => (await (await caches.open('apis')).keys()).length)).toBe(0);
  // Even entries written after activation must never win over NetworkOnly.
  await page.evaluate(async (paths) => {
    const cache = await caches.open('apis');
    for (const url of paths) await cache.put(url, new Response('STALE-CIPHERTEXT'));
  }, paths);
  await context.setOffline(true);
  for (const path of paths) {
    expect(
      await page.evaluate(async (url) => {
        try {
          return await (await fetch(url)).text();
        } catch {
          return 'NETWORK-FAILED';
        }
      }, path),
    ).toBe('NETWORK-FAILED');
  }
});

test('a mixed-generation-sensitive flow rotates under a real controlling worker', async ({ page }) => {
  const wizard = new RotationPage(page);
  const { address, mekBytes } = await wizard.signInWithProfile({ navigate: false });
  const [secret] = await seedSecrets(address, mekBytes, [{ title: 'Worker', content: 'survives rotation' }]);
  await wizard.goto();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await wizard.runUntilActivation();
  await wizard.activate();
  const mek = await mekFromPassphrase(await getOrCreateUserId(address), RotationPage.NEW_PASSPHRASE);
  expect(await decryptSecretHead(secret.id, mek)).toBe('survives rotation');
  await expect(decryptSecretHead(secret.id, mekBytes)).rejects.toThrow();
});
