import { test, expect, type Page } from '@playwright/test';
import { changeAccount } from '../utils/changeAccount';
import { makeAccount } from '../utils/makeAccount';
import { mockProvider } from '../utils/mockProvider';
import { signIn } from '../utils/signIn';
import { seedNotes } from '../fixtures/seedNotes';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';
import { seedSecrets } from '../fixtures/seedSecrets';
import { seedSeals } from '../fixtures/seedSeals';

test.describe.configure({ mode: 'parallel' });

const TEST_PASSPHRASE = 'correct-horse-battery-staple-42';

const noteCard = (page: Page, title: string) => page.getByTestId('note-card').filter({ hasText: title });
const secretCard = (page: Page, title: string) => page.getByTestId('secret-card').filter({ hasText: title });

// ─── Input length constraints in modals ──────────────────────────────────────

const LONG_TITLE = 'A'.repeat(501);
const LONG_CONTENT = 'X'.repeat(500_001);

const sealCard = (page: Page, title: string) => page.getByTestId('secret-card').filter({ hasText: title });

const setupEncrypted = async (page: Page, startUrl: string) => {
  const { privateKey, account } = makeAccount();
  const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
  await mockProvider(page);
  await page.goto(startUrl);
  await changeAccount(page, privateKey);
  await signIn(page);
  return { privateKey, account, mekBytes };
};

const unlock = async (page: Page) => {
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.getByPlaceholder('Your passphrase').fill(TEST_PASSPHRASE);
  await page.getByRole('button', { name: 'Unlock' }).last().click();
  await expect(page.getByRole('button', { name: 'Lock', exact: true })).toBeVisible({ timeout: 20000 });
};

const fillLargeContent = async (page: Page) => {
  await page.locator('[data-testid="tiptap-editor"] .ProseMirror').fill(LONG_CONTENT);
};

test.describe('input length constraints in modals', () => {
  // ── Note (t1) — New modal ────────────────────────────────────────────────

  test('NewNoteModal blocks title over 500 chars', async ({ page }) => {
    const { privateKey } = makeAccount();
    await mockProvider(page);
    await page.goto('/');
    await changeAccount(page, privateKey);
    await signIn(page);

    await page.getByTestId('new-note-btn').click();
    await page.getByTestId('note-title-input').click();
    await page.getByTestId('note-title-input').fill(LONG_TITLE);
    await page.getByTestId('save-note-btn').click();

    await expect(page.getByText('Title is too long')).toBeVisible();
    await expect(page.getByTestId('note-title-input')).toBeVisible();
  });

  test('NewNoteModal blocks content over 500k chars', async ({ page }) => {
    const { privateKey } = makeAccount();
    await mockProvider(page);
    await page.goto('/');
    await changeAccount(page, privateKey);
    await signIn(page);

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

    await mockProvider(page);
    await page.goto('/');
    await changeAccount(page, privateKey);
    await signIn(page);

    await noteCard(page, title).click();
    await page.getByTestId('edit-btn').click();
    await page.getByTestId('note-title-input').fill(LONG_TITLE);
    await page.getByTestId('save-btn').click();

    await expect(page.getByText('Title is too long')).toBeVisible();
  });

  test('NoteModal blocks content over 500k chars on edit', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const title = `Constraint Note Content ${Date.now()}`;
    await seedNotes(account.address, [{ title }]);

    await mockProvider(page);
    await page.goto('/');
    await changeAccount(page, privateKey);
    await signIn(page);

    await noteCard(page, title).click();
    await page.getByTestId('edit-btn').click();
    await fillLargeContent(page);
    await page.getByTestId('save-btn').click();

    await expect(page.getByText('Content is too large to save')).toBeVisible();
  });

  // ── Secret (t2) — New modal ──────────────────────────────────────────────

  test('NewSecretModal blocks title over 500 chars', async ({ page }) => {
    await setupEncrypted(page, '/secrets');
    await unlock(page);

    await page.getByRole('button', { name: 'New Secret' }).click();
    await page.getByTestId('note-title-input').click();
    await page.getByTestId('note-title-input').fill(LONG_TITLE);
    await page.getByTestId('save-secret-btn').click();

    await expect(page.getByText('Title is too long')).toBeVisible();
    await expect(page.getByTestId('note-title-input')).toBeVisible();
  });

  test('NewSecretModal blocks content over 500k chars', async ({ page }) => {
    await setupEncrypted(page, '/secrets');
    await unlock(page);

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
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const title = `Constraint Secret ${Date.now()}`;
    await seedSecrets(account.address, mekBytes, [{ title }]);

    await mockProvider(page);
    await page.goto('/secrets');
    await changeAccount(page, privateKey);
    await signIn(page);
    await unlock(page);

    await secretCard(page, title).click();
    await page.getByTestId('edit-btn').click();
    await page.getByTestId('note-title-input').fill(LONG_TITLE);
    await page.getByTestId('save-btn').click();

    await expect(page.getByText('Title is too long')).toBeVisible();
  });

  test('SecretNoteModal blocks content over 500k chars on edit', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const title = `Constraint Secret Content ${Date.now()}`;
    await seedSecrets(account.address, mekBytes, [{ title, content: 'initial' }]);

    await mockProvider(page);
    await page.goto('/secrets');
    await changeAccount(page, privateKey);
    await signIn(page);
    await unlock(page);

    await secretCard(page, title).click();
    await page.getByTestId('edit-btn').click();
    await fillLargeContent(page);
    await page.getByTestId('save-btn').click();

    await expect(page.getByText('Content is too large to save')).toBeVisible();
  });

  // ── Seal (t3) — New modal ────────────────────────────────────────────────

  test('NewSealModal blocks title over 500 chars', async ({ page }) => {
    await setupEncrypted(page, '/seals');
    await unlock(page);

    await page.getByRole('button', { name: 'New Seal' }).click();
    await page.getByTestId('note-title-input').click();
    await page.getByTestId('note-title-input').fill(LONG_TITLE);
    await page.getByTestId('save-seal-btn').click();

    await expect(page.getByText('Title is too long')).toBeVisible();
    await expect(page.getByTestId('note-title-input')).toBeVisible();
  });

  test('NewSealModal blocks content over 500k chars', async ({ page }) => {
    await setupEncrypted(page, '/seals');
    await unlock(page);

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
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const title = `Constraint Seal ${Date.now()}`;
    await seedSeals(account.address, mekBytes, [{ title }]);

    await mockProvider(page);
    await page.goto('/seals');
    await changeAccount(page, privateKey);
    await signIn(page);
    await unlock(page);

    await sealCard(page, title).click();
    await page.getByTestId('decrypt-btn').click();
    await expect(page.getByTestId('edit-btn')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('edit-btn').click();
    await page.getByTestId('note-title-input').fill(LONG_TITLE);
    await page.getByTestId('save-btn').click();

    await expect(page.getByText('Title is too long')).toBeVisible();
  });

  test('SealNoteModal blocks content over 500k chars on edit', async ({ page }) => {
    const { privateKey, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, TEST_PASSPHRASE);
    const title = `Constraint Seal Content ${Date.now()}`;
    await seedSeals(account.address, mekBytes, [{ title, content: 'initial' }]);

    await mockProvider(page);
    await page.goto('/seals');
    await changeAccount(page, privateKey);
    await signIn(page);
    await unlock(page);

    await sealCard(page, title).click();
    await page.getByTestId('decrypt-btn').click();
    await expect(page.getByTestId('edit-btn')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('edit-btn').click();
    await fillLargeContent(page);
    await page.getByTestId('save-btn').click();

    await expect(page.getByText('Content is too large to save')).toBeVisible();
  });
});
