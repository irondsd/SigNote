import { test, expect, type Page } from '@playwright/test';
import { and, eq } from 'drizzle-orm';

import { fileAttachments, notes, secretNotes } from '../../src/db/schema';
import { makeAccount } from '../utils/makeAccount';
import { createTestSession } from '../utils/createTestSession';
import { injectSession } from '../utils/injectSession';
import { getOrCreateUserId } from '../fixtures/getOrCreateUserId';
import { decryptStoredFile, seedEncryptedFile } from '../fixtures/seedEncryptedFile';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';
import { seedNotes } from '../fixtures/seedNotes';
import { seedSecrets } from '../fixtures/seedSecrets';
import { testDb } from '../fixtures/db';
import { SecretsPage } from '../pages/SecretsPage';
import { exportVault, inspectArchive } from '../utils/vaultArchive';

test.describe.configure({ mode: 'serial' });

const passphrase = SecretsPage.PASSPHRASE;
const archivePassword = 'portable-archive-password-42';

/** Seeds a source vault, unlocks it once (which records the vaultKeyId that
 * encrypted exports require) and exports it through the browser. */
async function exportSourceVault(page: Page) {
  const source = makeAccount();
  const userId = await getOrCreateUserId(source.account.address);
  const { mekBytes } = await seedEncryptionProfile(source.account.address, passphrase);
  await seedNotes(source.account.address, [{ title: 'Portable note', content: '<p>From the source</p>' }]);
  await seedSecrets(source.account.address, mekBytes, [{ title: 'Portable secret', content: 'still encrypted' }]);
  await injectSession(page, await createTestSession(source.account.address));

  await page.goto('/secrets');
  await new SecretsPage(page).unlock(passphrase);
  return { userId, archivePath: await exportVault(page, archivePassword) };
}

const inspect = (page: Page, archivePath: string) => inspectArchive(page, archivePath, archivePassword);

test('restores an encrypted vault archive into a second account alongside the source', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const { userId: sourceUserId, archivePath } = await exportSourceVault(page);

  // The source vault stays in place: the destination is a second account on the
  // same deployment, which holds the archive's ids verbatim alongside it. Seal
  // and Authenticator ciphertext is bound to those ids, so this only works
  // because ids are unique per account rather than globally.
  const destination = makeAccount();
  const destinationContext = await browser.newContext({ baseURL: 'http://localhost:5005', serviceWorkers: 'block' });
  const destinationPage = await destinationContext.newPage();
  await injectSession(destinationPage, await createTestSession(destination.account.address));
  await inspect(destinationPage, archivePath);
  await expect(destinationPage.getByRole('heading', { name: 'Review this restore' })).toBeVisible({ timeout: 60_000 });
  await expect(destinationPage.getByText('Install from archive')).toBeVisible();
  await destinationPage.getByRole('button', { name: 'Restore vault' }).click();
  await expect(destinationPage.getByText('Vault restored')).toBeVisible({ timeout: 60_000 });

  await destinationPage.getByRole('link', { name: 'Open Secrets' }).click();
  const restoredSecrets = new SecretsPage(destinationPage);
  await restoredSecrets.unlock(passphrase);
  await expect(restoredSecrets.secretCard('Portable secret')).toContainText('still encrypted');
  await destinationPage.goto('/');
  await expect(destinationPage.getByTestId('note-card').filter({ hasText: 'Portable note' })).toContainText(
    'From the source',
  );
  await destinationContext.close();

  // Same ids, two owners, each untouched by the other.
  const destinationUserId = await getOrCreateUserId(destination.account.address);
  const [sourceSecret] = await testDb().select().from(secretNotes).where(eq(secretNotes.userId, sourceUserId));
  const [restoredSecret] = await testDb().select().from(secretNotes).where(eq(secretNotes.userId, destinationUserId));
  expect(restoredSecret.id).toBe(sourceSecret.id);
  expect(restoredSecret.encryptedBody).toEqual(sourceSecret.encryptedBody);
  expect(await testDb().select().from(notes).where(eq(notes.userId, sourceUserId))).toHaveLength(1);
});

test('merges an archive back into its own vault, resolving a conflict from the backup', async ({ page }) => {
  test.setTimeout(120_000);
  const { userId, archivePath } = await exportSourceVault(page);
  const [original] = await testDb().select().from(secretNotes).where(eq(secretNotes.userId, userId));

  // The Secret changes after the backup; the Note does not.
  await testDb()
    .update(secretNotes)
    .set({ title: 'Changed since the backup' })
    .where(and(eq(secretNotes.userId, userId), eq(secretNotes.id, original.id)));

  await inspect(page, archivePath);
  await expect(page.getByRole('heading', { name: 'Review this merge' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Same key as this account')).toBeVisible();
  const conflict = page.getByTestId('import-conflict');
  await expect(conflict).toHaveCount(1);
  await expect(conflict).toContainText('Portable secret');
  await expect(conflict).toContainText('Changed since the backup');
  // The existing item opens in the ordinary vault, never on this page.
  await expect(conflict.getByRole('link', { name: 'Open in a new tab' })).toHaveAttribute(
    'href',
    `/secrets?id=${original.id}`,
  );
  // Nothing to do until a conflict is resolved: the Note is identical.
  await expect(page.getByRole('button', { name: 'Import into vault' })).toBeDisabled();

  await conflict.getByLabel('Replace from backup').check();
  await expect(page.getByText('1 item will be replaced')).toBeVisible();
  await page.getByRole('button', { name: 'Import into vault' }).click();
  await expect(page.getByText('Vault merged')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('0 added, 1 replaced, 0 kept as copies')).toBeVisible();

  const secrets = await testDb().select().from(secretNotes).where(eq(secretNotes.userId, userId));
  expect(secrets).toHaveLength(1);
  expect(secrets[0]).toMatchObject({
    id: original.id,
    title: 'Portable secret',
    encryptedBody: original.encryptedBody,
  });
  expect(await testDb().select().from(notes).where(eq(notes.userId, userId))).toHaveLength(1);
});

test('restores a multi-megabyte attachment byte for byte', async ({ page, browser }) => {
  // The golden archive fits in one read. A real one arrives in pieces, and the
  // attachment pass once stalled on the first entry it skipped, so the import
  // hung at 99% before its first file.
  test.setTimeout(180_000);
  const source = makeAccount();
  const sourceUserId = await getOrCreateUserId(source.account.address);
  const { mekBytes } = await seedEncryptionProfile(source.account.address, passphrase);
  const [secret] = await seedSecrets(source.account.address, mekBytes, [{ title: 'Carries a file', content: 'x' }]);
  await injectSession(page, await createTestSession(source.account.address));
  const file = await seedEncryptedFile(page.request, mekBytes, { bytes: 3 * 1024 * 1024, filename: 'large.pdf' });
  await testDb()
    .update(fileAttachments)
    .set({ noteId: secret.id, noteTier: 'secret' })
    .where(and(eq(fileAttachments.userId, sourceUserId), eq(fileAttachments.id, file.fileId)));
  await page.goto('/secrets');
  await new SecretsPage(page).unlock(passphrase);
  const archivePath = await exportVault(page, archivePassword);

  const destination = makeAccount();
  const context = await browser.newContext({ baseURL: 'http://localhost:5005', serviceWorkers: 'block' });
  const destinationPage = await context.newPage();
  await injectSession(destinationPage, await createTestSession(destination.account.address));
  await inspect(destinationPage, archivePath);
  await expect(destinationPage.getByRole('heading', { name: 'Review this restore' })).toBeVisible({ timeout: 60_000 });
  await destinationPage.getByRole('button', { name: 'Restore vault' }).click();
  await expect(destinationPage.getByText('Vault restored')).toBeVisible({ timeout: 90_000 });

  // The archive installs the source's profile, so the same MEK opens the copy.
  const destinationUserId = await getOrCreateUserId(destination.account.address);
  const restored = await decryptStoredFile(destinationPage.request, file.fileId, mekBytes, 0, destinationUserId);
  expect(Buffer.from(restored).equals(Buffer.from(file.plaintext))).toBe(true);
  await context.close();
});
