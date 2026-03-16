import { test, expect, type Page } from '@playwright/test';
import { mockProvider } from '../utils/mockProvider';
import { changeAccount } from '../utils/changeAccount';
import { makeAccount } from '../utils/makeAccount';
import { signIn } from '../utils/signIn';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';

const TEST_PASSPHRASE = 'correct-horse-battery-staple-42';
const TEST_NEW_PASSPHRASE = 'different-horse-new-staple-1337';

// Helper: full sign-in setup for a fresh test account
const setup = async (page: Page, startUrl = '/secrets') => {
  const { privateKey, account } = makeAccount();
  await mockProvider(page);
  await page.goto(startUrl);
  await changeAccount(page, privateKey);
  await signIn(page);
  return { privateKey, account };
};

test.describe('encryption profile', () => {
  test('should see encryption profile setup', async ({ page }) => {
    await setup(page);

    await expect(page.locator('#enc-passphrase')).toBeVisible();
    await expect(page.getByText('Set up encrypted notes')).toBeVisible();
  });

  test('should not see encryption profile setup if already setup', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    await seedEncryptionProfile(account.address, TEST_PASSPHRASE);

    await mockProvider(page);
    await page.goto('/secrets');
    await changeAccount(page, privateKey);
    await signIn(page);

    await expect(page.locator('#enc-passphrase')).not.toBeVisible();
    await expect(page.getByText('Locked')).toBeVisible();
  });

  test('should setup encryption profile', async ({ page }) => {
    await setup(page);

    await expect(page.locator('#enc-passphrase')).toBeVisible();

    await page.locator('#enc-passphrase').fill(TEST_PASSPHRASE);
    await page.locator('#enc-confirm').fill(TEST_PASSPHRASE);

    const postPromise = page.waitForResponse(
      (r) => r.url().includes('/api/encryption/profile') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Create encryption keys' }).click();
    const postResponse = await postPromise;

    expect(postResponse.status()).toBe(201);
    await expect(page.locator('#enc-passphrase')).not.toBeVisible();

    const profileRes = await page.request.get('/api/encryption/profile');
    const profile = await profileRes.json();
    expect(profile.exists).toBe(true);
  });

  test('should change passphrase', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);

    await mockProvider(page);
    await page.goto('/secrets');
    await changeAccount(page, privateKey);
    await signIn(page);
    await page.goto('/change-passphrase');

    await expect(page.locator('#cp-old')).toBeVisible();

    await page.locator('#cp-old').fill(TEST_PASSPHRASE);
    await page.locator('#cp-new').fill(TEST_NEW_PASSPHRASE);
    await page.locator('#cp-confirm').fill(TEST_NEW_PASSPHRASE);
    await page.locator('#cp-old').blur();

    // Wait for passphrase verification to succeed (all conditions met → button enabled)
    await expect(page.getByRole('button', { name: 'Change passphrase' })).toBeEnabled({ timeout: 15000 });

    const patchPromise = page.waitForResponse(
      (r) => r.url().includes('/api/encryption/profile') && r.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: 'Change passphrase' }).click();
    const patchResponse = await patchPromise;

    expect(patchResponse.status()).toBe(200);
    await expect(page.getByText('Passphrase changed')).toBeVisible();

    // Verify MEK did not change: derive MEK from new passphrase + new material,
    // compare byte-for-byte to the original mekBytes
    const materialRes = await page.request.get('/api/encryption/material');
    const newMaterial = await materialRes.json();
    const originalMekArray = Array.from(mekBytes);

    const mekMatch = await page.evaluate(
      async ({ newPassphrase, newMaterial, originalMekArray }) => {
        const subtle = crypto.subtle;
        const decode = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

        const keyMaterial = await subtle.importKey('raw', new TextEncoder().encode(newPassphrase), 'PBKDF2', false, [
          'deriveBits',
        ]);
        const bits = await subtle.deriveBits(
          {
            name: 'PBKDF2',
            hash: newMaterial.kdf.hash,
            salt: decode(newMaterial.salt),
            iterations: newMaterial.kdf.iterations,
          },
          keyMaterial,
          newMaterial.kdf.length * 8,
        );
        const newDeviceShare = new Uint8Array(bits);
        const newServerShare = decode(newMaterial.serverShare);
        const newMekBytes = new Uint8Array(32);
        for (let i = 0; i < 32; i++) newMekBytes[i] = newDeviceShare[i] ^ newServerShare[i];

        return originalMekArray.every((b: number, i: number) => newMekBytes[i] === b);
      },
      { newPassphrase: TEST_NEW_PASSPHRASE, newMaterial, originalMekArray },
    );

    expect(mekMatch).toBe(true);
  });
});
