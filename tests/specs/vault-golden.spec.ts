import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { test, expect, type Page } from '@playwright/test';
import { and, eq } from 'drizzle-orm';

import {
  fileAttachments,
  noteTags,
  noteVersions,
  notes,
  otpRecords,
  sealNotes,
  secretNoteVersions,
  secretNotes,
  tags,
} from '../../src/db/schema';
import { makeAccount } from '../utils/makeAccount';
import { createTestSession } from '../utils/createTestSession';
import { injectSession } from '../utils/injectSession';
import { getOrCreateUserId } from '../fixtures/getOrCreateUserId';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';
import { seedNotes } from '../fixtures/seedNotes';
import { seedSecrets } from '../fixtures/seedSecrets';
import { seedSeals } from '../fixtures/seedSeals';
import { seedOtpRecords } from '../fixtures/seedOtpRecords';
import { seedTags } from '../fixtures/seedTags';
import { seedSealVersions, seedSecretVersions } from '../fixtures/seedVersions';
import { decryptStoredFile, seedEncryptedFile } from '../fixtures/seedEncryptedFile';
import { testDb } from '../fixtures/db';
import { decryptOtpRecord, decryptSealHead, decryptSecretHead, mekFromPassphrase } from '../utils/vaultCrypto';
import { SecretsPage } from '../pages/SecretsPage';

/**
 * The committed v1 sample archive. Every release must still import it: the
 * reader is not allowed to drift from a format already in users' hands.
 *
 * Regenerate (only when the writer deliberately changes) with
 *   UPDATE_VAULT_GOLDEN=1 npx playwright test tests/specs/vault-golden.spec.ts
 * which seeds every category and attachment key scope, exports through the
 * real browser pipeline, and rewrites the archive and its expectations.
 */

const DIR = path.resolve(__dirname, '../fixtures/vault-archives');
const ARCHIVE = path.join(DIR, 'v1-sample.snvault');
const EXPECTED = path.join(DIR, 'v1-sample.json');
const VAULT_PASSPHRASE = SecretsPage.PASSPHRASE;
const ARCHIVE_PASSWORD = 'signote-sample-archive-v1';
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

type Expected = {
  vaultPassphrase: string;
  archivePassword: string;
  note: { id: string; title: string; content: string; historyTitles: string[]; tags: string[] };
  secret: { id: string; title: string; content: string; historyTitles: string[] };
  seal: { id: string; title: string; content: string };
  authenticator: { id: string; issuer: string };
  files: Array<{ id: string; owner: 'secrets' | 'seals'; filename: string; sha256: string }>;
};

test.describe.configure({ mode: 'serial' });

async function exportVault(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });
  await page.goto('/export');
  await page.getByRole('textbox', { name: /^Archive password/ }).fill(ARCHIVE_PASSWORD);
  await page.getByLabel('Confirm password').fill(ARCHIVE_PASSWORD);
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('start-vault-export').click();
  const download = await downloadPromise;
  await expect(page.getByText('Encrypted vault downloaded')).toBeVisible({ timeout: 60_000 });
  return download;
}

test('regenerates the golden v1 archive', async ({ page }) => {
  test.skip(!process.env.UPDATE_VAULT_GOLDEN, 'Set UPDATE_VAULT_GOLDEN=1 to rewrite the committed archive');
  test.setTimeout(180_000);
  const source = makeAccount();
  const userId = await getOrCreateUserId(source.account.address);
  const { mekBytes } = await seedEncryptionProfile(source.account.address, VAULT_PASSPHRASE);
  await injectSession(page, await createTestSession(source.account.address));

  const [note] = await seedNotes(source.account.address, [
    {
      title: 'Golden note',
      content: '<p>A plaintext note with <strong>history</strong>.</p>',
      versions: [{ title: 'Golden note draft', content: '<p>First draft</p>' }],
    },
  ]);
  const [tag] = await seedTags(source.account.address, [{ name: 'golden' }]);
  await testDb().insert(noteTags).values({ userId, noteId: note.id, tagId: tag.id, sortOrder: 0 });

  const [secret] = await seedSecrets(source.account.address, mekBytes, [
    { title: 'Golden secret', content: 'Secret plaintext from the golden archive' },
  ]);
  await seedSecretVersions(secret.id, mekBytes, [{ title: 'Golden secret draft', content: 'Earlier secret' }]);
  const [seal] = await seedSeals(source.account.address, mekBytes, [
    { title: 'Golden seal', content: 'Sealed plaintext from the golden archive' },
  ]);
  await seedSealVersions(seal.id, mekBytes, [{ title: 'Golden seal draft', content: 'Earlier seal' }]);
  const [otp] = await seedOtpRecords(source.account.address, mekBytes, [
    { issuer: 'Golden Issuer', account: 'golden@example.com' },
  ]);

  // One attachment per encrypted key scope: the vault file key, and a Seal's own key.
  const vaultFile = await seedEncryptedFile(page.request, mekBytes, { bytes: 4096, filename: 'secret.pdf' });
  const sealFile = await seedEncryptedFile(page.request, mekBytes, {
    bytes: 3000,
    filename: 'sealed.pdf',
    seal: { id: seal.id, wrappedNoteKey: seal.wrappedNoteKey! },
  });
  await testDb()
    .update(fileAttachments)
    .set({ noteId: secret.id, noteTier: 'secret' })
    .where(and(eq(fileAttachments.userId, userId), eq(fileAttachments.id, vaultFile.fileId)));
  await testDb()
    .update(fileAttachments)
    .set({ noteId: seal.id, noteTier: 'seal' })
    .where(and(eq(fileAttachments.userId, userId), eq(fileAttachments.id, sealFile.fileId)));

  await page.goto('/secrets');
  await new SecretsPage(page).unlock(VAULT_PASSPHRASE);
  const download = await exportVault(page);

  mkdirSync(DIR, { recursive: true });
  await download.saveAs(ARCHIVE);
  const expected: Expected = {
    vaultPassphrase: VAULT_PASSPHRASE,
    archivePassword: ARCHIVE_PASSWORD,
    note: {
      id: note.id,
      title: 'Golden note',
      content: '<p>A plaintext note with <strong>history</strong>.</p>',
      historyTitles: ['Golden note draft'],
      tags: ['golden'],
    },
    secret: {
      id: secret.id,
      title: 'Golden secret',
      content: 'Secret plaintext from the golden archive',
      historyTitles: ['Golden secret draft'],
    },
    seal: { id: seal.id, title: 'Golden seal', content: 'Sealed plaintext from the golden archive' },
    authenticator: { id: otp.id, issuer: 'Golden Issuer' },
    files: [
      { id: vaultFile.fileId, owner: 'secrets', filename: 'secret.pdf', sha256: sha256(vaultFile.plaintext) },
      { id: sealFile.fileId, owner: 'seals', filename: 'sealed.pdf', sha256: sha256(sealFile.plaintext) },
    ],
  };
  writeFileSync(EXPECTED, `${JSON.stringify(expected, null, 2)}\n`);
});

test('imports the committed golden v1 archive and opens every item with the original passphrase', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const expected = JSON.parse(readFileSync(EXPECTED, 'utf8')) as Expected;
  const destination = makeAccount();
  const context = await browser.newContext({ baseURL: 'http://localhost:5005', serviceWorkers: 'block' });
  const page = await context.newPage();
  await injectSession(page, await createTestSession(destination.account.address));
  const userId = await getOrCreateUserId(destination.account.address);

  await page.goto('/import');
  await page.locator('input[type=file]').setInputFiles(ARCHIVE);
  await page.getByRole('textbox', { name: /^Archive password/ }).fill(expected.archivePassword);
  await page.getByRole('button', { name: 'Inspect archive' }).click();
  await expect(page.getByRole('heading', { name: 'Review this restore' })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Restore vault' }).click();
  await expect(page.getByText('Vault restored')).toBeVisible({ timeout: 60_000 });

  // The archived profile opens with the original passphrase, and every
  // encrypted item decrypts under the key it was bound to — same ids.
  const mek = await mekFromPassphrase(userId, expected.vaultPassphrase);
  expect(await decryptSecretHead(expected.secret.id, mek, userId)).toBe(expected.secret.content);
  expect(await decryptSealHead(expected.seal.id, mek, userId)).toBe(expected.seal.content);
  expect(JSON.parse(await decryptOtpRecord(userId, expected.authenticator.id, mek))).toMatchObject({
    issuer: expected.authenticator.issuer,
  });
  for (const file of expected.files)
    expect(sha256(await decryptStoredFile(page.request, file.id, mek, 0, userId))).toBe(file.sha256);

  const [note] = await testDb()
    .select()
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.id, expected.note.id)));
  expect(note).toMatchObject({ title: expected.note.title, content: expected.note.content });
  const noteHistory = await testDb()
    .select()
    .from(noteVersions)
    .where(and(eq(noteVersions.userId, userId), eq(noteVersions.noteId, expected.note.id)));
  expect(noteHistory.map((version) => version.title)).toEqual(expected.note.historyTitles);
  const secretHistory = await testDb()
    .select()
    .from(secretNoteVersions)
    .where(and(eq(secretNoteVersions.userId, userId), eq(secretNoteVersions.noteId, expected.secret.id)));
  expect(secretHistory.map((version) => version.title)).toEqual(expected.secret.historyTitles);
  const tagNames = await testDb()
    .select({ name: tags.name })
    .from(noteTags)
    .innerJoin(tags, eq(tags.id, noteTags.tagId))
    .where(and(eq(noteTags.userId, userId), eq(noteTags.noteId, expected.note.id)));
  expect(tagNames.map((row) => row.name)).toEqual(expected.note.tags);
  expect(await testDb().select().from(sealNotes).where(eq(sealNotes.userId, userId))).toHaveLength(1);
  expect(await testDb().select().from(secretNotes).where(eq(secretNotes.userId, userId))).toHaveLength(1);
  expect(await testDb().select().from(otpRecords).where(eq(otpRecords.userId, userId))).toHaveLength(1);

  // And the ordinary vault UI unlocks it.
  await page.goto('/secrets');
  const secrets = new SecretsPage(page);
  await secrets.unlock(expected.vaultPassphrase);
  await expect(secrets.secretCard(expected.secret.title)).toContainText(expected.secret.content);
  await context.close();
});
