import { test, expect } from '@playwright/test';
import { makeAccount } from '../utils/makeAccount';
import { createTestSession } from '../utils/createTestSession';
import { injectSession } from '../utils/injectSession';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';
import { buildRecoveryFile } from '../fixtures/buildRecoveryFile';
import { getOrCreateUserId } from '../fixtures/getOrCreateUserId';
import { SecretsPage } from '../pages/SecretsPage';

test.describe.configure({ mode: 'parallel' });

const PASSPHRASE = SecretsPage.PASSPHRASE;
const NEW_PASSPHRASE = 'brand-new-passphrase-for-recovery-2026';

// ─── Access control ───────────────────────────────────────────────────────────

test.describe('access control', () => {
  test('redirects unauthenticated users from /backup-recovery', async ({ page }) => {
    await page.goto('/backup-recovery');
    await expect(page).toHaveURL('/');
  });

  test('redirects unauthenticated users from /recover', async ({ page }) => {
    await page.goto('/recover');
    await expect(page).toHaveURL('/');
  });
});

// ─── Backup download page ─────────────────────────────────────────────────────

test.describe('backup download page', () => {
  test('opens passphrase modal when vault is locked', async ({ page }) => {
    const secretsPage = new SecretsPage(page);
    await secretsPage.signInDirectly();
    await page.goto('/backup-recovery');

    await page.getByRole('button', { name: 'Download backup file' }).click();

    await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();
  });

  test('downloads file and shows success screen after unlocking via modal', async ({ page }) => {
    const secretsPage = new SecretsPage(page);
    await secretsPage.signInDirectly();
    await page.goto('/backup-recovery');

    // Vault is locked — click download to open the passphrase modal
    await page.getByRole('button', { name: 'Download backup file' }).click();
    await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();

    // After successful unlock, onSuccess calls performDownload() directly —
    // bypassing the phase check that caused the intermittent race condition.
    await page.getByPlaceholder('Your passphrase').fill(PASSPHRASE);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Unlock' }).last().click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^signote-recovery-.*\.json$/);
    await expect(page.getByRole('heading', { name: 'Backup saved' })).toBeVisible();
  });
});

// ─── Recovery page — error cases ──────────────────────────────────────────────

test.describe('recovery page — error cases', () => {
  test('shows error for an invalid JSON file', async ({ page }) => {
    const { account } = makeAccount();
    await seedEncryptionProfile(account.address, PASSPHRASE);
    const token = await createTestSession(account.address);
    await injectSession(page, token);
    await page.goto('/recover');

    await page.locator('input[type="file"]').setInputFiles({
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from('not valid json {{{'),
    });

    await expect(page.getByText("doesn't look like a SigNote recovery file")).toBeVisible();
  });

  test('shows error when recovery file belongs to a different account', async ({ page }) => {
    const { account } = makeAccount();
    await seedEncryptionProfile(account.address, PASSPHRASE);
    const token = await createTestSession(account.address);
    await injectSession(page, token);
    await page.goto('/recover');

    // Build a file for a different (nonexistent) user ID
    const fakeDeviceShare = new Uint8Array(32).fill(42);
    const wrongAccountFile = buildRecoveryFile('000000000000000000000001', fakeDeviceShare);

    await page.locator('input[type="file"]').setInputFiles({
      name: 'wrong-account.json',
      mimeType: 'application/json',
      buffer: Buffer.from(wrongAccountFile),
    });

    await expect(page.getByText('This recovery file is for a different account.')).toBeVisible();
  });
});

// ─── Full recovery flow ───────────────────────────────────────────────────────

test.describe('full recovery flow', () => {
  test('valid backup file → new passphrase → success screen', async ({ page }) => {
    const { account } = makeAccount();
    const { deviceShare } = await seedEncryptionProfile(account.address, PASSPHRASE);
    const userId = await getOrCreateUserId(account.address);

    const token = await createTestSession(account.address);
    await injectSession(page, token);
    await page.goto('/recover');

    const recoveryFile = buildRecoveryFile(userId, deviceShare);
    await page.locator('input[type="file"]').setInputFiles({
      name: 'signote-recovery.json',
      mimeType: 'application/json',
      buffer: Buffer.from(recoveryFile),
    });

    // File verified → passphrase screen
    await expect(page.getByRole('heading', { name: 'Set a new passphrase' })).toBeVisible({ timeout: 15000 });

    await page.locator('#rec-new').fill(NEW_PASSPHRASE);
    await page.locator('#rec-confirm').fill(NEW_PASSPHRASE);
    await page.getByRole('button', { name: 'Recover access' }).click();

    await expect(page.getByRole('heading', { name: 'Success' })).toBeVisible({ timeout: 20000 });
  });
});
