import { test, expect } from '@playwright/test';
import { seedNotes } from '../fixtures/seedNotes';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';
import { seedSecrets } from '../fixtures/seedSecrets';
import { NotesPage } from '../pages/NotesPage';
import { SecretsPage } from '../pages/SecretsPage';

test.describe.configure({ mode: 'parallel' });

// ─── Close via X Button ─────────────────────────────────────────────────────

test.describe('modal close - X button', () => {
  test('note modal closes via X button', async ({ page }) => {
    const notesPage = new NotesPage(page);
    const { account } = await notesPage.signInWithWallet();
    await seedNotes(account.address, [{ title: 'XClose Test' }]);
    await page.reload();

    await notesPage.noteCard('XClose Test').click();
    const modal = page.getByTestId('note-modal');
    await expect(modal).toBeVisible();

    await modal.getByRole('button', { name: 'Close' }).click();
    await expect(modal).toHaveCount(0);
  });

  test('new note modal closes via X button', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInWithWallet();

    await page.getByTestId('new-note-btn').click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();

    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('note-modal')).toHaveCount(0);
  });
});

// ─── Close via Backdrop Click ───────────────────────────────────────────────

test.describe('modal close - backdrop click', () => {
  test('note modal closes when clicking backdrop in view mode', async ({ page }) => {
    const notesPage = new NotesPage(page);
    const { account } = await notesPage.signInWithWallet();
    await seedNotes(account.address, [{ title: 'Backdrop Test' }]);
    await page.reload();

    await notesPage.noteCard('Backdrop Test').click();
    await expect(page.getByTestId('note-modal')).toBeVisible();

    // Click outside the modal (top-left corner of the backdrop)
    await page.mouse.click(5, 5);
    await expect(page.getByTestId('note-modal')).toHaveCount(0);
  });

  test('note modal does NOT close via backdrop click while editing', async ({ page }) => {
    const notesPage = new NotesPage(page);
    const { account } = await notesPage.signInWithWallet();
    await seedNotes(account.address, [{ title: 'NoClose Edit' }]);
    await page.reload();

    await notesPage.noteCard('NoClose Edit').click();
    await expect(page.getByTestId('note-modal')).toBeVisible();

    // Enter edit mode
    await page.getByTestId('edit-btn').click();

    // Click outside the modal — should NOT close (disableClose=true during editing)
    await page.mouse.click(5, 5);
    await expect(page.getByTestId('note-modal')).toBeVisible();
  });

  test('new note modal does NOT close via backdrop click when content exists', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInWithWallet();

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
    const notesPage = new NotesPage(page);
    await notesPage.signInWithWallet();

    await page.getByTestId('new-note-btn').click();
    const title = `Discard_${Date.now()}`;
    await page.getByTestId('note-title-input').fill(title);

    // Close via X — triggers unsaved changes confirmation
    await page.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Discard' }).click();

    // Note should NOT appear in the grid
    await expect(notesPage.noteCard(title)).toHaveCount(0);
  });
});

// ─── Secret Modal Close ─────────────────────────────────────────────────────

test.describe('modal close - secrets', () => {
  test('secret modal closes via X button when viewing decrypted content', async ({ page }) => {
    // Sign in first (no enc profile yet), then seed enc profile + secrets post-sign-in
    const notesPage = new NotesPage(page);
    const { account } = await notesPage.signInWithWallet();
    const { mekBytes } = await seedEncryptionProfile(account.address, SecretsPage.PASSPHRASE);
    await seedSecrets(account.address, mekBytes, [{ title: 'SecretClose Test', content: 'secret body' }]);
    await page.goto('/secrets');
    await page.reload();

    const secretsPage = new SecretsPage(page);
    await secretsPage.unlock();

    await secretsPage.secretCard('SecretClose Test').click();
    const modal = page.getByTestId('note-modal');
    await expect(modal).toBeVisible();

    await modal.getByRole('button', { name: 'Close' }).click();
    await expect(modal).toHaveCount(0);
  });
});
