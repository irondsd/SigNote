import { test, expect } from '@playwright/test';
import { makeAccount } from '../utils/makeAccount';
import { seedNotes } from '../fixtures/seedNotes';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';
import { seedSecrets } from '../fixtures/seedSecrets';
import { seedSeals } from '../fixtures/seedSeals';
import { NotesPage } from '../pages/NotesPage';
import { SecretsPage } from '../pages/SecretsPage';
import { SealsPage } from '../pages/SealsPage';

test.describe.configure({ mode: 'parallel' });

// ─── Input length constraints in modals ──────────────────────────────────────

const LONG_TITLE = 'A'.repeat(501);
const LONG_CONTENT = 'X'.repeat(500_001);

const fillLargeContent = async (page: import('@playwright/test').Page) => {
  await page.locator('[data-testid="tiptap-editor"] .ProseMirror').fill(LONG_CONTENT);
};

test.describe('input length constraints in modals', () => {
  // ── Note (t1) — New modal ────────────────────────────────────────────────

  test('NewNoteModal blocks title over 500 chars', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInWithWallet();

    await page.getByTestId('new-note-btn').click();
    await page.getByTestId('note-title-input').click();
    await page.getByTestId('note-title-input').fill(LONG_TITLE);
    await page.getByTestId('save-note-btn').click();

    await expect(page.getByText('Title is too long')).toBeVisible();
    await expect(page.getByTestId('note-title-input')).toBeVisible();
  });

  test('NewNoteModal blocks content over 500k chars', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInWithWallet();

    await page.getByTestId('new-note-btn').click();
    await page.getByTestId('note-title-input').fill('Test');
    await fillLargeContent(page);
    await page.getByTestId('save-note-btn').click();

    await expect(page.getByText('Content is too large to save')).toBeVisible();
    await expect(page.getByTestId('note-title-input')).toBeVisible();
  });

  // ── Note (t1) — Edit modal ───────────────────────────────────────────────

  test('NoteModal blocks title over 500 chars on edit', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const title = `Constraint Note ${Date.now()}`;
    await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInWithWallet(privateKey);

    await notesPage.noteCard(title).click();
    await page.getByTestId('edit-btn').click();
    await page.getByTestId('note-title-input').fill(LONG_TITLE);
    await page.getByTestId('save-btn').click();

    await expect(page.getByText('Title is too long')).toBeVisible();
  });

  test('NoteModal blocks content over 500k chars on edit', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const title = `Constraint Note Content ${Date.now()}`;
    await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInWithWallet(privateKey);

    await notesPage.noteCard(title).click();
    await page.getByTestId('edit-btn').click();
    await fillLargeContent(page);
    await page.getByTestId('save-btn').click();

    await expect(page.getByText('Content is too large to save')).toBeVisible();
  });

  // ── Secret (t2) — New modal ──────────────────────────────────────────────

  test('NewSecretModal blocks title over 500 chars', async ({ page }) => {
    const secretsPage = new SecretsPage(page);
    await secretsPage.signInWithWallet();
    await secretsPage.unlock();

    await page.getByRole('button', { name: 'New Secret' }).click();
    await page.getByTestId('note-title-input').click();
    await page.getByTestId('note-title-input').fill(LONG_TITLE);
    await page.getByTestId('save-secret-btn').click();

    await expect(page.getByText('Title is too long')).toBeVisible();
    await expect(page.getByTestId('note-title-input')).toBeVisible();
  });

  test('NewSecretModal blocks content over 500k chars', async ({ page }) => {
    const secretsPage = new SecretsPage(page);
    await secretsPage.signInWithWallet();
    await secretsPage.unlock();

    await page.getByRole('button', { name: 'New Secret' }).click();
    await page.getByTestId('note-title-input').fill('Test');
    await fillLargeContent(page);
    await page.getByTestId('save-secret-btn').click();

    await expect(page.getByText('Content is too large to save')).toBeVisible();
    await expect(page.getByTestId('note-title-input')).toBeVisible();
  });

  // ── Secret (t2) — Edit modal ─────────────────────────────────────────────

  test('SecretNoteModal blocks title over 500 chars on edit', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SecretsPage.PASSPHRASE);
    const title = `Constraint Secret ${Date.now()}`;
    await seedSecrets(account.address, mekBytes, [{ title }]);

    const secretsPage = new SecretsPage(page);
    await secretsPage.signInWithWallet(privateKey);
    await secretsPage.unlock();

    await secretsPage.secretCard(title).click();
    await page.getByTestId('edit-btn').click();
    await page.getByTestId('note-title-input').fill(LONG_TITLE);
    await page.getByTestId('save-btn').click();

    await expect(page.getByText('Title is too long')).toBeVisible();
  });

  test('SecretNoteModal blocks content over 500k chars on edit', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SecretsPage.PASSPHRASE);
    const title = `Constraint Secret Content ${Date.now()}`;
    await seedSecrets(account.address, mekBytes, [{ title, content: 'initial' }]);

    const secretsPage = new SecretsPage(page);
    await secretsPage.signInWithWallet(privateKey);
    await secretsPage.unlock();

    await secretsPage.secretCard(title).click();
    await page.getByTestId('edit-btn').click();
    await fillLargeContent(page);
    await page.getByTestId('save-btn').click();

    await expect(page.getByText('Content is too large to save')).toBeVisible();
  });

  // ── Seal (t3) — New modal ────────────────────────────────────────────────

  test('NewSealModal blocks title over 500 chars', async ({ page }) => {
    const sealsPage = new SealsPage(page);
    await sealsPage.signInWithWallet();
    await sealsPage.unlock();

    await page.getByRole('button', { name: 'New Seal' }).click();
    await page.getByTestId('note-title-input').click();
    await page.getByTestId('note-title-input').fill(LONG_TITLE);
    await page.getByTestId('save-seal-btn').click();

    await expect(page.getByText('Title is too long')).toBeVisible();
    await expect(page.getByTestId('note-title-input')).toBeVisible();
  });

  test('NewSealModal blocks content over 500k chars', async ({ page }) => {
    const sealsPage = new SealsPage(page);
    await sealsPage.signInWithWallet();
    await sealsPage.unlock();

    await page.getByRole('button', { name: 'New Seal' }).click();
    await page.getByTestId('note-title-input').fill('Test');
    await fillLargeContent(page);
    await page.getByTestId('save-seal-btn').click();

    await expect(page.getByText('Content is too large to save')).toBeVisible();
    await expect(page.getByTestId('note-title-input')).toBeVisible();
  });

  // ── Seal (t3) — Edit modal ───────────────────────────────────────────────

  test('SealNoteModal blocks title over 500 chars on edit', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);
    const title = `Constraint Seal ${Date.now()}`;
    await seedSeals(account.address, mekBytes, [{ title }]);

    const sealsPage = new SealsPage(page);
    await sealsPage.signInWithWallet(privateKey);
    await sealsPage.unlock();

    await sealsPage.sealCard(title).click();
    await page.getByTestId('decrypt-btn').click();
    await expect(page.getByTestId('edit-btn')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('edit-btn').click();
    await page.getByTestId('note-title-input').fill(LONG_TITLE);
    await page.getByTestId('save-btn').click();

    await expect(page.getByText('Title is too long')).toBeVisible();
  });

  test('SealNoteModal blocks content over 500k chars on edit', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);
    const title = `Constraint Seal Content ${Date.now()}`;
    await seedSeals(account.address, mekBytes, [{ title, content: 'initial' }]);

    const sealsPage = new SealsPage(page);
    await sealsPage.signInWithWallet(privateKey);
    await sealsPage.unlock();

    await sealsPage.sealCard(title).click();
    await page.getByTestId('decrypt-btn').click();
    await expect(page.getByTestId('edit-btn')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('edit-btn').click();
    await fillLargeContent(page);
    await page.getByTestId('save-btn').click();

    await expect(page.getByText('Content is too large to save')).toBeVisible();
  });
});
