import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';

import { fileAttachments } from '../../src/db/schema';
import { testDb } from '../fixtures/db';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';
import { seedNotes } from '../fixtures/seedNotes';
import { seedSecrets } from '../fixtures/seedSecrets';
import { seedSecretVersions } from '../fixtures/seedVersions';
import { makeAccount } from '../utils/makeAccount';
import { settleModal } from '../utils/settleModal';
import { NotesPage } from '../pages/NotesPage';
import { SealsPage } from '../pages/SealsPage';
import { SecretsPage } from '../pages/SecretsPage';
import { decryptStoredFile } from '../fixtures/seedEncryptedFile';

test.describe.configure({ mode: 'parallel' });

test.describe('tier promotion', () => {
  test('can create the vault inline before moving the first encrypted note', async ({ page }) => {
    const { account } = makeAccount();
    const title = `First secret ${Date.now()}`;
    await seedNotes(account.address, [{ title, content: '<p>first encrypted body</p>' }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.noteCard(title).click();
    await settleModal(page);
    await page.getByTestId('more-actions-btn').click();
    await page.getByTestId('promote-tier-item').click();

    await expect(page.getByText('First, create a vault passphrase.')).toBeVisible();
    const passphrase = 'a-new-vault-passphrase-for-promotion';
    await page.getByLabel('New passphrase', { exact: true }).fill(passphrase);
    await page.getByLabel('Confirm passphrase', { exact: true }).fill(passphrase);
    const moved = page.waitForResponse(
      (response) => response.url().includes('promotions.noteToSecret') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Move to Secrets' }).click();
    await moved;
    await expect(notesPage.noteCard(title)).not.toBeVisible();

    const secretsPage = new SecretsPage(page);
    await secretsPage.goto();
    await secretsPage.unlock(passphrase);
    await secretsPage.secretCard(title).click();
    await expect(page.getByTestId('tiptap-editor')).toContainText('first encrypted body');
  });

  test('moves a note and its history to Secrets through a one-shot passphrase dialog', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SecretsPage.PASSPHRASE);
    const title = `Promoted note ${Date.now()}`;
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address, { navigate: false });
    const attachmentBytes = Buffer.from('plaintext attachment promoted securely');
    const upload = await page.request.post('/api/files', {
      multipart: {
        file: { name: 'attachment.txt', mimeType: 'text/plain', buffer: attachmentBytes },
      },
    });
    expect(upload.ok()).toBe(true);
    const { fileId } = (await upload.json()) as { fileId: string };
    const [note] = await seedNotes(account.address, [
      {
        title,
        content:
          '<p>current private content</p>' +
          `<div data-type="file-attachment" fileid="${fileId}" filename="attachment.txt" size="${attachmentBytes.length}" mimetype="text/plain" uploadstatus="complete" data-file-id="${fileId}" data-filename="attachment.txt" data-size="${attachmentBytes.length}" data-mime-type="text/plain"></div>`,
        versions: [{ title: 'Earlier title', content: '<p>earlier private content</p>' }],
      },
    ]);
    await testDb()
      .update(fileAttachments)
      .set({ noteId: note.id, noteTier: 'note' })
      .where(eq(fileAttachments.id, fileId));

    await notesPage.goto();
    await notesPage.noteCard(title).click();
    await settleModal(page);
    await page.getByTestId('more-actions-btn').click();
    await page.getByTestId('promote-tier-item').click();

    await expect(page.getByRole('heading', { name: 'Move note to Secrets?' })).toBeVisible();
    await page.getByLabel('Vault passphrase', { exact: true }).fill(SecretsPage.PASSPHRASE);
    const moved = page.waitForResponse(
      (response) => response.url().includes('promotions.noteToSecret') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Move to Secrets' }).click();
    await moved;
    await expect(notesPage.noteCard(title)).not.toBeVisible();

    const storedFiles = await testDb().select().from(fileAttachments);
    expect(storedFiles.find((file) => file.id === fileId)?.deletedAt).toBeTruthy();
    const replacement = storedFiles.find((file) => file.id !== fileId && file.noteId === note.id);
    expect(replacement).toMatchObject({ encrypted: true, noteTier: 'secret', deletedAt: null });
    expect(Buffer.from(await decryptStoredFile(page.request, replacement!.id, mekBytes))).toEqual(attachmentBytes);

    const secretsPage = new SecretsPage(page);
    await secretsPage.goto();
    await secretsPage.unlock();
    await secretsPage.secretCard(title).click();
    await expect(page.getByTestId('tiptap-editor')).toContainText('current private content');
    await settleModal(page);
    await page.getByTestId('more-actions-btn').click();
    await page.getByTestId('version-history-item').click();
    await expect(page.getByTestId('version-row')).toHaveCount(2);
    await page.getByTestId('version-row').last().click();
    await expect(page.getByTestId('version-content')).toContainText('earlier private content');
  });

  test('moves an unlocked secret and all history to a uniquely keyed Seal', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SecretsPage.PASSPHRASE);
    const title = `Promoted secret ${Date.now()}`;
    const [secret] = await seedSecrets(account.address, mekBytes, [{ title, content: 'current shared-key content' }]);
    await seedSecretVersions(secret.id, mekBytes, [{ title: 'Earlier secret', content: 'earlier shared-key content' }]);

    const secretsPage = new SecretsPage(page);
    await secretsPage.signInDirectly(account.address);
    await secretsPage.unlock();
    await secretsPage.secretCard(title).click();
    await settleModal(page);
    await page.getByTestId('more-actions-btn').click();
    await page.getByTestId('promote-tier-item').click();

    await expect(page.getByRole('heading', { name: 'Move secret to Seals?' })).toBeVisible();
    const moved = page.waitForResponse(
      (response) => response.url().includes('promotions.secretToSeal') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Move to Seals' }).click();
    await moved;
    await expect(secretsPage.secretCard(title)).not.toBeVisible();

    const sealsPage = new SealsPage(page);
    await page.getByRole('link', { name: 'Seals', exact: true }).click();
    await expect(page.getByTestId('unlock-button')).toHaveAttribute('aria-pressed', 'true');
    await sealsPage.sealCard(title).click();
    await page.getByRole('button', { name: 'Decrypt to view' }).click();
    await expect(page.getByTestId('tiptap-editor')).toContainText('current shared-key content');
    await settleModal(page);
    await page.getByTestId('more-actions-btn').click();
    await page.getByTestId('version-history-item').click();
    await page.getByTestId('version-row').last().click();
    await expect(page.getByTestId('version-content')).toContainText('earlier shared-key content');
  });
});
