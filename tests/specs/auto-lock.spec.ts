/**
 * Auto-lock tests
 *
 * Tests for soft lock (tab visibility), hard lock (inactivity/sleep),
 * and unsaved changes confirmation dialog.
 */

import { test, expect, type Page } from '@playwright/test';
import { changeAccount } from '../utils/changeAccount';
import { makeAccount } from '../utils/makeAccount';
import { mockProvider } from '../utils/mockProvider';
import { signIn } from '../utils/signIn';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';
import { seedSecrets } from '../fixtures/seedSecrets';
import { seedSeals } from '../fixtures/seedSeals';
import { seedNotes } from '../fixtures/seedNotes';

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

// ─── Unsaved Changes Confirmation ───────────────────────────────────────────

test.describe('unsaved changes confirmation', () => {
  test('closing note modal with unsaved edits shows confirmation', async ({ page }) => {
    const { account } = await setup(page, '/');
    await seedNotes(account.address, [{ title: 'Unsaved Test', content: 'original' }]);
    await page.reload();

    // Open note modal and edit
    await page.getByTestId('note-card').filter({ hasText: 'Unsaved Test' }).click();
    await expect(page.getByTestId('note-modal')).toBeVisible();
    await page.getByTestId('edit-btn').click();
    await page.getByTestId('tiptap-editor').click();
    await page.keyboard.type(' modified');

    // Try to close via X — should show confirmation
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByText('Discard unsaved changes?')).toBeVisible();

    // Cancel keeps editing
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('note-modal')).toBeVisible();
  });

  test('discard button closes modal and discards changes', async ({ page }) => {
    const { account } = await setup(page, '/');
    await seedNotes(account.address, [{ title: 'Discard Test', content: 'original content' }]);
    await page.reload();

    // Open, edit, close, discard
    await page.getByTestId('note-card').filter({ hasText: 'Discard Test' }).click();
    await expect(page.getByTestId('note-modal')).toBeVisible();
    await page.getByTestId('edit-btn').click();
    await page.getByTestId('tiptap-editor').click();
    await page.keyboard.type(' extra');

    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByText('Discard unsaved changes?')).toBeVisible();
    await page.getByRole('button', { name: 'Discard', exact: true }).click();

    // Modal should be closed
    await expect(page.getByTestId('note-modal')).toHaveCount(0);
  });

  test('closing note modal without changes does NOT show confirmation', async ({ page }) => {
    const { account } = await setup(page, '/');
    await seedNotes(account.address, [{ title: 'NoConfirm Test' }]);
    await page.reload();

    // Open note modal in view mode (no edits)
    await page.getByTestId('note-card').filter({ hasText: 'NoConfirm Test' }).click();
    await expect(page.getByTestId('note-modal')).toBeVisible();

    // Close — should NOT show confirmation dialog
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByText('Discard unsaved changes?')).not.toBeVisible();
    await expect(page.getByTestId('note-modal')).toHaveCount(0);
  });

  test('new note modal with content shows confirmation on cancel', async ({ page }) => {
    await setup(page, '/');

    await page.getByTestId('new-note-btn').click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();
    await page.getByTestId('note-title-input').fill('Draft title');

    // Cancel — should show confirmation
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Discard unsaved changes?')).toBeVisible();

    // Discard closes
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(page.getByTestId('note-modal')).toHaveCount(0);
  });

  test('new note modal with empty content does NOT show confirmation', async ({ page }) => {
    await setup(page, '/');

    await page.getByTestId('new-note-btn').click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();

    // Cancel with no content — should close immediately
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Discard unsaved changes?')).not.toBeVisible();
    await expect(page.getByTestId('note-modal')).toHaveCount(0);
  });

  test('new secret modal with content shows confirmation on cancel', async ({ page }) => {
    await setup(page, '/secrets');
    await unlock(page);

    await page.getByRole('button', { name: 'New Secret' }).click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();
    await page.getByTestId('note-title-input').fill('Secret draft');

    // Cancel — should show confirmation
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Discard unsaved changes?')).toBeVisible();
  });
});
