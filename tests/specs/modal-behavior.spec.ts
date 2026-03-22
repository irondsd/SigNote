import { test, expect, type Page } from '@playwright/test';
import { changeAccount } from '../utils/changeAccount';
import { makeAccount } from '../utils/makeAccount';
import { mockProvider } from '../utils/mockProvider';
import { signIn } from '../utils/signIn';
import { seedNotes } from '../fixtures/seedNotes';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';
import { seedSecrets } from '../fixtures/seedSecrets';

test.describe.configure({ mode: 'parallel' });

const TEST_PASSPHRASE = 'correct-horse-battery-staple-42';

const noteCard = (page: Page, title: string) => page.getByTestId('note-card').filter({ hasText: title });

const setup = async (page: Page, startUrl = '/') => {
  const { privateKey, account } = makeAccount();
  await mockProvider(page);
  await page.goto(startUrl);
  await changeAccount(page, privateKey);
  await signIn(page);
  return { privateKey, account };
};

const unlock = async (page: Page) => {
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByPlaceholder('Your passphrase')).toBeVisible();
  await page.getByPlaceholder('Your passphrase').fill(TEST_PASSPHRASE);
  await page.getByRole('button', { name: 'Unlock' }).last().click();
  await expect(page.getByRole('button', { name: 'Lock', exact: true })).toBeVisible({ timeout: 20000 });
};

// ─── Close via X Button ─────────────────────────────────────────────────────

test.describe('modal close - X button', () => {
  test('note modal closes via X button', async ({ page }) => {
    const { account } = await setup(page);
    await seedNotes(account.address, [{ title: 'XClose Test' }]);
    await page.reload();

    await noteCard(page, 'XClose Test').click();
    const modal = page.getByTestId('note-modal');
    await expect(modal).toBeVisible();

    await modal.getByRole('button', { name: 'Close' }).click();
    await expect(modal).toHaveCount(0);
  });

  test('new note modal closes via X button', async ({ page }) => {
    await setup(page);

    await page.getByTestId('new-note-btn').click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();

    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('note-modal')).toHaveCount(0);
  });
});

// ─── Close via Backdrop Click ───────────────────────────────────────────────

test.describe('modal close - backdrop click', () => {
  test('note modal closes when clicking backdrop in view mode', async ({ page }) => {
    const { account } = await setup(page);
    await seedNotes(account.address, [{ title: 'Backdrop Test' }]);
    await page.reload();

    await noteCard(page, 'Backdrop Test').click();
    await expect(page.getByTestId('note-modal')).toBeVisible();

    // Click outside the modal (top-left corner of the backdrop)
    await page.mouse.click(5, 5);
    await expect(page.getByTestId('note-modal')).toHaveCount(0);
  });

  test('note modal does NOT close via backdrop click while editing', async ({ page }) => {
    const { account } = await setup(page);
    await seedNotes(account.address, [{ title: 'NoClose Edit' }]);
    await page.reload();

    await noteCard(page, 'NoClose Edit').click();
    await expect(page.getByTestId('note-modal')).toBeVisible();

    // Enter edit mode
    await page.getByTestId('edit-btn').click();

    // Click outside the modal — should NOT close (disableClose=true during editing)
    await page.mouse.click(5, 5);
    await expect(page.getByTestId('note-modal')).toBeVisible();
  });

  test('new note modal does NOT close via backdrop click when content exists', async ({ page }) => {
    await setup(page);

    await page.getByTestId('new-note-btn').click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();

    // Type some content
    await page.getByTestId('tiptap-editor').click();
    await page.keyboard.type('Some content');

    // Click outside — should NOT close (handleBackdropClose checks isContentEmpty)
    await page.mouse.click(5, 5);
    await expect(page.getByTestId('note-title-input')).toBeVisible();
  });
});

// ─── X Button Discards Unsaved New Note ─────────────────────────────────────

test.describe('modal close - discard', () => {
  test('closing new note modal via X does not create note', async ({ page }) => {
    await setup(page);

    await page.getByTestId('new-note-btn').click();
    const title = `Discard_${Date.now()}`;
    await page.getByTestId('note-title-input').fill(title);

    // Close via X — triggers unsaved changes confirmation
    await page.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Discard' }).click();

    // Note should NOT appear in the grid
    await expect(noteCard(page, title)).toHaveCount(0);
  });
});

// ─── Secret Modal Close ─────────────────────────────────────────────────────

test.describe('modal close - secrets', () => {
  test('secret modal closes via X button when viewing decrypted content', async ({ page }) => {
    const { account } = await setup(page, '/secrets');
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    await seedSecrets(account.address, mekBytes, [{ title: 'SecretClose Test', content: 'secret body' }]);
    await page.reload();
    await unlock(page);

    await page.getByTestId('secret-card').filter({ hasText: 'SecretClose Test' }).click();
    const modal = page.getByTestId('note-modal');
    await expect(modal).toBeVisible();

    await modal.getByRole('button', { name: 'Close' }).click();
    await expect(modal).toHaveCount(0);
  });
});
