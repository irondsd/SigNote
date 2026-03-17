/**
 * Passphrase / lock-unlock tests
 *
 * These tests cover the shared encryption unlock flow used by both Secrets and
 * Seals. Keep encryption-lifecycle assertions here rather than duplicating them
 * in feature-specific spec files.
 */

import { test, expect, type Page } from '@playwright/test';
import { changeAccount } from '../utils/changeAccount';
import { makeAccount } from '../utils/makeAccount';
import { mockProvider } from '../utils/mockProvider';
import { signIn } from '../utils/signIn';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';

test.describe.configure({ mode: 'parallel' });

const TEST_PASSPHRASE = 'correct-horse-battery-staple-42';
const WRONG_PASSPHRASE = 'this-is-definitely-wrong-99';

// Full sign-in setup with an existing encryption profile
const setup = async (page: Page) => {
  const { privateKey, account } = makeAccount();
  const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);

  await mockProvider(page);
  await page.goto('/secrets');
  await changeAccount(page, privateKey);
  await signIn(page);

  return { privateKey, account, mekBytes };
};

// Unlock via PassphraseModal — waits for modal to close before returning
const unlock = async (page: Page) => {
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();
  await page.getByPlaceholder('Your passphrase').fill(TEST_PASSPHRASE);
  await page.getByRole('button', { name: 'Unlock' }).last().click();
  // Wait for modal to dismiss — PBKDF2 at 600k iterations can be slow
  await expect(page.getByPlaceholder('Your passphrase')).not.toBeVisible({ timeout: 20000 });
};

// ─── Lock / Unlock State ─────────────────────────────────────────────────────

test.describe('lock / unlock state', () => {
  test('shows Locked badge when profile exists but session not unlocked', async ({ page }) => {
    await setup(page);

    await expect(page.getByText('Locked', { exact: true })).toBeVisible();
    await expect(page.getByText('Unlocked')).not.toBeVisible();
  });

  test('Unlock button opens the passphrase modal', async ({ page }) => {
    await setup(page);

    await page.getByRole('button', { name: 'Unlock' }).click();

    await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();
    await expect(page.getByText('Unlock encrypted notes')).toBeVisible();
  });

  test('correct passphrase unlocks and shows Unlocked badge', async ({ page }) => {
    await setup(page);

    await unlock(page);

    await expect(page.getByText('Unlocked')).toBeVisible();
    await expect(page.getByText('Locked', { exact: true })).not.toBeVisible();
  });

  test('Lock button re-locks the session', async ({ page }) => {
    await setup(page);

    await unlock(page);
    await expect(page.getByText('Unlocked')).toBeVisible();

    await page.getByRole('button', { name: 'Lock' }).click();

    await expect(page.getByText('Locked', { exact: true })).toBeVisible();
    await expect(page.getByText('Unlocked')).not.toBeVisible();
  });

  test('session persists across page reload', async ({ page }) => {
    await setup(page);

    await unlock(page);
    await expect(page.getByText('Unlocked')).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('wallet-address').first()).toBeVisible({ timeout: 10000 });

    // Should still be unlocked (sessionStorage rehydration)
    await expect(page.getByText('Unlocked')).toBeVisible();
  });
});

// ─── Lock / Unlock State on Seals Page ───────────────────────────────────────

test.describe('lock / unlock state on seals page', () => {
  test('shows Locked badge on /seals when profile exists but session not unlocked', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    await seedEncryptionProfile(account.address, TEST_PASSPHRASE);

    await mockProvider(page);
    await page.goto('/seals');
    await changeAccount(page, privateKey);
    await signIn(page);

    await expect(page.getByText('Locked', { exact: true })).toBeVisible();
    await expect(page.getByText('Unlocked')).not.toBeVisible();
  });

  test('Unlock button on /seals opens passphrase modal and correct passphrase unlocks', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    await seedEncryptionProfile(account.address, TEST_PASSPHRASE);

    await mockProvider(page);
    await page.goto('/seals');
    await changeAccount(page, privateKey);
    await signIn(page);

    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();

    await page.getByPlaceholder('Your passphrase').fill(TEST_PASSPHRASE);
    await page.getByRole('button', { name: 'Unlock' }).last().click();

    await expect(page.getByText('Unlocked')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Locked', { exact: true })).not.toBeVisible();
  });
});

// ─── Wrong Passphrase ────────────────────────────────────────────────────────

test.describe('wrong passphrase', () => {
  test('wrong passphrase shows error and stays locked', async ({ page }) => {
    await setup(page);

    // Enter wrong passphrase — modal stays open, so don't wait for dismiss
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();
    await page.getByPlaceholder('Your passphrase').fill(WRONG_PASSPHRASE);
    await page.getByRole('button', { name: 'Unlock' }).last().click();

    await expect(page.getByText('Incorrect passphrase')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Locked', { exact: true })).toBeVisible();
    await expect(page.getByText('Unlocked')).not.toBeVisible();
  });

  test('correct passphrase after wrong one succeeds', async ({ page }) => {
    await setup(page);

    // Enter wrong passphrase first
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();
    await page.getByPlaceholder('Your passphrase').fill(WRONG_PASSPHRASE);
    await page.getByRole('button', { name: 'Unlock' }).last().click();
    await expect(page.getByText('Incorrect passphrase')).toBeVisible({ timeout: 20000 });

    await page.getByPlaceholder('Your passphrase').fill(TEST_PASSPHRASE);
    await page.getByRole('button', { name: 'Unlock' }).last().click();

    await expect(page.getByText('Unlocked')).toBeVisible({ timeout: 20000 });
  });

  test('cancel passphrase modal keeps session locked', async ({ page }) => {
    await setup(page);

    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByPlaceholder('Your passphrase')).not.toBeVisible();
    await expect(page.getByText('Locked', { exact: true })).toBeVisible();
  });
});
