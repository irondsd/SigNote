/**
 * Passphrase / lock-unlock tests
 *
 * These tests cover the shared encryption unlock flow used by both Secrets and
 * Seals. Keep encryption-lifecycle assertions here rather than duplicating them
 * in feature-specific spec files.
 */

import { test, expect } from '@playwright/test';
import { makeAccount } from '../utils/makeAccount';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';
import { SecretsPage } from '../pages/SecretsPage';
import { SealsPage } from '../pages/SealsPage';

test.describe.configure({ mode: 'parallel' });

const WRONG_PASSPHRASE = 'this-is-definitely-wrong-99';

// ─── Lock / Unlock State ─────────────────────────────────────────────────────

test.describe('lock / unlock state', () => {
  test('shows Locked badge when profile exists but session not unlocked', async ({ page }) => {
    const secretsPage = new SecretsPage(page);
    await secretsPage.signInDirectly();

    await expect(page.getByTestId('unlock-button')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('lock-button')).toHaveAttribute('aria-pressed', 'true');
  });

  test('Unlock button opens the passphrase modal', async ({ page }) => {
    const secretsPage = new SecretsPage(page);
    await secretsPage.signInDirectly();

    await page.getByRole('button', { name: 'Unlock' }).click();

    await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();
    await expect(page.getByText('Unlock encrypted notes')).toBeVisible();
  });

  test('correct passphrase unlocks and shows Unlocked badge', async ({ page }) => {
    const secretsPage = new SecretsPage(page);
    await secretsPage.signInDirectly();
    await secretsPage.unlock();

    await expect(page.getByTestId('unlock-button')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('lock-button')).toHaveAttribute('aria-pressed', 'false');
  });

  test('Lock button re-locks the session', async ({ page }) => {
    const secretsPage = new SecretsPage(page);
    await secretsPage.signInDirectly();
    await secretsPage.unlock();
    await expect(page.getByTestId('unlock-button')).toHaveAttribute('aria-pressed', 'true');

    await secretsPage.lock();

    await expect(page.getByTestId('unlock-button')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('lock-button')).toHaveAttribute('aria-pressed', 'true');
  });

  // A reload leaves the vault soft locked, exactly like switching away from the
  // tab: the document fires visibilitychange → hidden on its way out. What
  // survives the reload is the device share in sessionStorage, so unlocking is
  // one click and no passphrase — until the soft lock escalates to a hard one
  // after HARD_LOCK_MS, which is what auto-lock.spec covers.
  test('reload soft locks, and unlocking again needs no passphrase', async ({ page }) => {
    const secretsPage = new SecretsPage(page);
    await secretsPage.signInDirectly();
    await secretsPage.unlock();

    await page.reload();
    await expect(page.getByTestId('display-name').first()).toBeVisible({ timeout: 10000 });

    await expect(page.getByTestId('unlock-button')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('lock-button')).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('unlock-button').click();
    await expect(page.getByTestId('unlock-button')).toHaveAttribute('aria-pressed', 'true', { timeout: 10000 });
    await expect(page.getByPlaceholder('Your passphrase')).toBeHidden();
  });
});

// ─── Lock / Unlock State on Seals Page ───────────────────────────────────────

test.describe('lock / unlock state on seals page', () => {
  test('shows Locked badge on /seals when profile exists but session not unlocked', async ({ page }) => {
    const { account } = makeAccount();
    await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);

    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly(account.address);

    await expect(page.getByTestId('unlock-button')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('lock-button')).toHaveAttribute('aria-pressed', 'true');
  });

  test('Unlock button on /seals opens passphrase modal and correct passphrase unlocks', async ({ page }) => {
    const { account } = makeAccount();
    await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);

    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly(account.address);

    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();

    await page.getByPlaceholder('Your passphrase').fill(SealsPage.PASSPHRASE);
    await page.getByRole('button', { name: 'Unlock' }).last().click();

    await expect(page.getByTestId('unlock-button')).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 });
  });
});

// ─── Wrong Passphrase ────────────────────────────────────────────────────────

test.describe('wrong passphrase', () => {
  test('wrong passphrase shows error and stays locked', async ({ page }) => {
    const secretsPage = new SecretsPage(page);
    await secretsPage.signInDirectly();

    // Enter wrong passphrase — modal stays open, so don't wait for dismiss
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();
    await page.getByPlaceholder('Your passphrase').fill(WRONG_PASSPHRASE);
    await page.getByRole('button', { name: 'Unlock' }).last().click();

    await expect(page.getByText('Incorrect passphrase')).toBeVisible({ timeout: 20000 });
    // Modal still open (error shown) means session is still locked
    await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();
    await expect(page.getByTestId('lock-button')).toHaveAttribute('aria-pressed', 'true');
  });

  test('correct passphrase after wrong one succeeds', async ({ page }) => {
    const secretsPage = new SecretsPage(page);
    await secretsPage.signInDirectly();

    // Enter wrong passphrase first
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();
    await page.getByPlaceholder('Your passphrase').fill(WRONG_PASSPHRASE);
    await page.getByRole('button', { name: 'Unlock' }).last().click();
    await expect(page.getByText('Incorrect passphrase')).toBeVisible({ timeout: 20000 });

    await page.getByPlaceholder('Your passphrase').fill(SecretsPage.PASSPHRASE);
    await page.getByRole('button', { name: 'Unlock' }).last().click();

    await expect(page.getByTestId('unlock-button')).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 });
  });

  test('cancel passphrase modal keeps session locked', async ({ page }) => {
    const secretsPage = new SecretsPage(page);
    await secretsPage.signInDirectly();

    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByPlaceholder('Your passphrase')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible();
  });
});
