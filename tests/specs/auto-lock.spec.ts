/**
 * Auto-lock tests
 *
 * Tests for soft lock (tab visibility), hard lock (inactivity/sleep)
 */

import { test, expect, type Page } from '@playwright/test';
import { changeAccount } from '../utils/changeAccount';
import { makeAccount } from '../utils/makeAccount';
import { mockProvider } from '../utils/mockProvider';
import { signIn } from '../utils/signIn';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';
import { seedSecrets } from '../fixtures/seedSecrets';
import { seedSeals } from '../fixtures/seedSeals';

const sealCard = (page: Page, title: string) => page.getByTestId('secret-card').filter({ hasText: title });

test.describe.configure({ mode: 'parallel' });

const TEST_PASSPHRASE = 'correct-horse-battery-staple-42';

// Sign in with a fresh account that already has an encryption profile
const setup = async (page: Page, startUrl = '/secrets') => {
  const { privateKey, account } = makeAccount();
  const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);

  await mockProvider(page);
  await page.goto(startUrl);
  await changeAccount(page, privateKey);
  await signIn(page);

  return { privateKey, account, mekBytes };
};

// Unlock the session via PassphraseModal
const unlock = async (page: Page) => {
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();
  await page.getByPlaceholder('Your passphrase').fill(TEST_PASSPHRASE);
  await page.getByRole('button', { name: 'Unlock' }).last().click();
  await expect(page.getByRole('button', { name: 'Lock', exact: true })).toBeVisible({ timeout: 20000 });
};

// Simulate tab becoming hidden (soft lock trigger)
const simulateTabHidden = async (page: Page) => {
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

// ─── Soft Lock ──────────────────────────────────────────────────────────────

test.describe('soft lock', () => {
  test('hiding tab triggers soft lock — grid shows placeholders', async ({ page }) => {
    const { account, mekBytes } = await setup(page);
    await seedSecrets(account.address, mekBytes, [{ title: 'SoftLock Secret', content: 'classified info' }]);
    await page.reload();
    await unlock(page);

    // Verify decrypted preview is visible
    await expect(page.getByTestId('secret-card')).toBeVisible();
    await expect(page.getByText('classified info')).toBeVisible();

    // Simulate tab hidden
    await simulateTabHidden(page);

    // Should show Unlock button (soft locked) and encrypted placeholder
    await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('classified info')).not.toBeVisible();
  });

  test('clicking secret card after soft lock does not require passphrase', async ({ page }) => {
    const { account, mekBytes } = await setup(page);
    await seedSecrets(account.address, mekBytes, [{ title: 'CardClick Secret', content: 'card click test' }]);
    await page.reload();
    await unlock(page);

    // Soft lock
    await simulateTabHidden(page);
    await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible({ timeout: 5000 });

    // Click the card — should NOT show passphrase modal, modal opens directly
    await page.getByTestId('secret-card').click();
    await expect(page.getByPlaceholder('Your passphrase')).not.toBeVisible();
    await expect(page.getByTestId('tiptap-editor').getByText('card click test')).toBeVisible({ timeout: 10000 });
  });

  test('soft unlock does not require passphrase', async ({ page }) => {
    const { account, mekBytes } = await setup(page);
    await seedSecrets(account.address, mekBytes, [{ title: 'ReUnlock Secret', content: 'soft unlock test' }]);
    await page.reload();
    await unlock(page);

    // Soft lock
    await simulateTabHidden(page);
    await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible({ timeout: 5000 });

    // Click Unlock — should NOT show passphrase modal
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();

    // Should be unlocked without passphrase input
    await expect(page.getByRole('button', { name: 'Lock', exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('soft unlock test')).toBeVisible({ timeout: 10000 });
  });
});

// ─── Soft Lock — Seals ──────────────────────────────────────────────────────

test.describe('soft lock — seals', () => {
  test('soft lock re-encrypts an open decrypted seal', async ({ page }) => {
    const { account, mekBytes } = await setup(page, '/seals');
    await seedSeals(account.address, mekBytes, [{ title: 'SoftLock Seal', content: 'sealed secret' }]);
    await page.reload();
    await unlock(page);

    // Open the seal and decrypt it
    await sealCard(page, 'SoftLock Seal').click();
    await page.getByTestId('decrypt-btn').click();
    await expect(page.getByText('sealed secret')).toBeVisible({ timeout: 10000 });

    // Simulate tab hidden — soft lock fires
    await simulateTabHidden(page);

    // Modal should re-encrypt: content hidden, Decrypt button visible again
    await expect(page.getByTestId('decrypt-btn')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('sealed secret')).not.toBeVisible();
  });

  test('decrypt after soft lock does not require passphrase', async ({ page }) => {
    const { account, mekBytes } = await setup(page, '/seals');
    await seedSeals(account.address, mekBytes, [{ title: 'ReDecrypt Seal', content: 'soft decrypt test' }]);
    await page.reload();
    await unlock(page);

    // Open the seal and decrypt it
    await sealCard(page, 'ReDecrypt Seal').click();
    await page.getByTestId('decrypt-btn').click();
    await expect(page.getByText('soft decrypt test')).toBeVisible({ timeout: 10000 });

    // Simulate tab hidden — soft lock fires
    await simulateTabHidden(page);
    await expect(page.getByTestId('decrypt-btn')).toBeVisible({ timeout: 5000 });

    // Click Decrypt — should NOT show passphrase modal, content appears directly
    await page.getByTestId('decrypt-btn').click();
    await expect(page.getByPlaceholder('Your passphrase')).not.toBeVisible();
    await expect(page.getByText('soft decrypt test')).toBeVisible({ timeout: 10000 });
  });
});

// ─── Hard Lock ──────────────────────────────────────────────────────────────

test.describe('hard lock', () => {
  test('manual lock (hard lock) clears deviceShare and requires passphrase', async ({ page }) => {
    await setup(page);
    await unlock(page);

    // Lock via button (this is effectively a hard lock)
    await page.getByRole('button', { name: 'Lock', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible();

    // Unlock should now require passphrase
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();
  });

  test('after hard lock (Lock button), unlock requires passphrase', async ({ page }) => {
    await setup(page);
    await unlock(page);

    // Lock via button
    await page.getByRole('button', { name: 'Lock', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible();

    // Clicking Unlock should show passphrase modal (not silent rehydrate)
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();
  });
});
