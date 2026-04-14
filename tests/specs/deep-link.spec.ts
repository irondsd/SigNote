import { test, expect } from '@playwright/test';
import { makeAccount } from '../utils/makeAccount';
import { seedNotes } from '../fixtures/seedNotes';
import { seedSecrets } from '../fixtures/seedSecrets';
import { seedSeals } from '../fixtures/seedSeals';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';
import { NotesPage } from '../pages/NotesPage';
import { SecretsPage } from '../pages/SecretsPage';
import { SealsPage } from '../pages/SealsPage';

test.describe.configure({ mode: 'parallel' });

// ─── Notes ────────────────────────────────────────────────────────────────────

test.describe('deep link - notes', () => {
  test('URL updates to ?id when a note modal opens', async ({ page }) => {
    const { account } = makeAccount();
    const title = `DeepLink ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    await notesPage.noteCard(title).click();
    await expect(page.getByTestId('note-modal')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`[?&]id=${note._id.toString()}`));
  });

  test('note modal opens automatically when ?id is in URL', async ({ page }) => {
    const { account } = makeAccount();
    const title = `DeepLink ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await page.goto(`/?id=${note._id.toString()}`);

    await expect(page.getByTestId('note-modal')).toBeVisible();
    await expect(page.getByTestId('note-title')).toContainText(title);
  });

  test('URL clears when note modal is closed', async ({ page }) => {
    const { account } = makeAccount();
    const title = `DeepLink ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    await notesPage.noteCard(title).click();
    await expect(page).toHaveURL(new RegExp(`[?&]id=${note._id.toString()}`));

    await page.getByTestId('note-modal').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('note-modal')).toHaveCount(0);
    await expect(page).toHaveURL('/');
  });
});

// ─── Secrets ──────────────────────────────────────────────────────────────────

test.describe('deep link - secrets', () => {
  test('URL updates to ?id when a secret modal opens', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SecretsPage.PASSPHRASE);
    const title = `DeepSecret ${Date.now()}`;
    const [secret] = await seedSecrets(account.address, mekBytes, [{ title }]);

    const secretsPage = new SecretsPage(page);
    await secretsPage.signInDirectly(account.address);
    await secretsPage.unlock();

    await secretsPage.secretCard(title).click();
    await expect(page.getByTestId('note-modal')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`[?&]id=${secret._id.toString()}`));
  });

  test('secret modal opens automatically when ?id is in URL', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SecretsPage.PASSPHRASE);
    const title = `DeepSecret ${Date.now()}`;
    const [secret] = await seedSecrets(account.address, mekBytes, [{ title }]);

    const secretsPage = new SecretsPage(page);
    await secretsPage.signInDirectly(account.address);
    await secretsPage.unlock();
    await page.goto(`/secrets?id=${secret._id.toString()}`);

    await expect(page.getByTestId('note-modal')).toBeVisible();
    await expect(page.getByTestId('note-title')).toContainText(title);
  });

  test('URL clears when secret modal is closed', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SecretsPage.PASSPHRASE);
    const title = `DeepSecret ${Date.now()}`;
    const [secret] = await seedSecrets(account.address, mekBytes, [{ title }]);

    const secretsPage = new SecretsPage(page);
    await secretsPage.signInDirectly(account.address);
    await secretsPage.unlock();

    await secretsPage.secretCard(title).click();
    await expect(page).toHaveURL(new RegExp(`[?&]id=${secret._id.toString()}`));

    await page.getByTestId('note-modal').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('note-modal')).toHaveCount(0);
    await expect(page).toHaveURL('/secrets');
  });
});

// ─── Seals ────────────────────────────────────────────────────────────────────

test.describe('deep link - seals', () => {
  test('URL updates to ?id when a seal modal opens', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);
    const title = `DeepSeal ${Date.now()}`;
    const [seal] = await seedSeals(account.address, mekBytes, [{ title }]);

    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly(account.address);
    await sealsPage.unlock();

    await sealsPage.sealCard(title).click();
    await expect(page.getByTestId('note-modal')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`[?&]id=${seal._id.toString()}`));
  });

  test('seal modal opens automatically when ?id is in URL', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);
    const title = `DeepSeal ${Date.now()}`;
    const [seal] = await seedSeals(account.address, mekBytes, [{ title }]);

    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly(account.address);
    await sealsPage.unlock();
    await page.goto(`/seals?id=${seal._id.toString()}`);

    await expect(page.getByTestId('note-modal')).toBeVisible();
    await expect(page.getByTestId('note-title')).toContainText(title);
  });

  test('URL clears when seal modal is closed', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);
    const title = `DeepSeal ${Date.now()}`;
    const [seal] = await seedSeals(account.address, mekBytes, [{ title }]);

    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly(account.address);
    await sealsPage.unlock();

    await sealsPage.sealCard(title).click();
    await expect(page).toHaveURL(new RegExp(`[?&]id=${seal._id.toString()}`));

    await page.getByTestId('note-modal').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('note-modal')).toHaveCount(0);
    await expect(page).toHaveURL('/seals');
  });
});
