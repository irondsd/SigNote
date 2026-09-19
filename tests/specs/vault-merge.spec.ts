import { test, expect, type Page } from '@playwright/test';
import { and, eq } from 'drizzle-orm';

import {
  fileAttachments,
  noteTags,
  noteVersions,
  notes,
  otpRecords,
  sealNotes,
  secretNotes,
  tags,
  vaultImports,
} from '../../src/db/schema';
import { testDb } from '../fixtures/db';
import { decryptSealHead, mekFromPassphrase } from '../utils/vaultCrypto';
import { GOLDEN_ARCHIVE, inspectArchive, outcomeRow, restoreGolden, reviewHeading } from '../utils/vaultArchive';

/**
 * Merging an archive back into the vault it came from. Each test restores the
 * committed golden archive into a new account — which then holds the archive's
 * vault identity — changes that account behind the page's back, and imports
 * the same archive again.
 */

test.describe.configure({ timeout: 150_000 });

async function inspectMerge(page: Page, archivePassword: string) {
  await inspectArchive(page, GOLDEN_ARCHIVE, archivePassword);
  await expect(reviewHeading(page, 'merge')).toBeVisible({ timeout: 60_000 });
}

const resolve = (page: Page, title: string) => page.getByRole('radiogroup', { name: `Resolve ${title}` });
const importButton = (page: Page) => page.getByRole('button', { name: 'Import into vault' });
const merged = (page: Page) => expect(page.getByText('Vault merged')).toBeVisible({ timeout: 60_000 });

const byId = <T extends typeof notes | typeof secretNotes | typeof sealNotes | typeof otpRecords>(
  table: T,
  userId: string,
  id: string,
) => and(eq(table.userId, userId), eq(table.id, id));

test('re-importing an unchanged archive finds every item identical and imports nothing', async ({ page }) => {
  const { expected } = await restoreGolden(page);

  await inspectMerge(page, expected.archivePassword);
  await expect(page.getByText('Same key as this account')).toBeVisible();
  await expect(page.getByText('Merge into this vault')).toBeVisible();
  for (const category of ['Notes', 'Secrets', 'Seals', 'Authenticator'] as const)
    expect(await outcomeRow(page, category)).toEqual([0, 1, 0]);
  await expect(page.getByText('Identical items are already here and are skipped automatically.')).toBeVisible();
  await expect(page.getByText(/There is nothing to import/)).toBeVisible();
  await expect(importButton(page)).toBeDisabled();
});

test('an item deleted here comes back with its history, reusing the tag that already exists', async ({ page }) => {
  const { expected, userId } = await restoreGolden(page);
  const [tagBefore] = await testDb().select().from(tags).where(eq(tags.userId, userId));
  await testDb()
    .delete(notes)
    .where(byId(notes, userId, expected.note.id));

  await inspectMerge(page, expected.archivePassword);
  expect(await outcomeRow(page, 'Notes')).toEqual([1, 0, 0]);
  // The archive's one tag already exists here, so reusing it is the default.
  await expect(page.getByRole('radio', { name: /Reuse existing tags only/ })).toBeChecked();
  await expect(page.getByText('1 of 1 archive tags already exist here')).toBeVisible();
  await importButton(page).click();
  await merged(page);
  await expect(page.getByText('1 added, 0 replaced, 0 kept as copies')).toBeVisible();

  const [note] = await testDb()
    .select()
    .from(notes)
    .where(byId(notes, userId, expected.note.id));
  expect(note).toMatchObject({ title: expected.note.title, content: expected.note.content });
  const history = await testDb()
    .select()
    .from(noteVersions)
    .where(and(eq(noteVersions.userId, userId), eq(noteVersions.noteId, expected.note.id)));
  expect(history.map((version) => version.title)).toEqual(expected.note.historyTitles);
  const links = await testDb().select().from(noteTags).where(eq(noteTags.userId, userId));
  expect(links).toMatchObject([{ noteId: expected.note.id, tagId: tagBefore.id }]);
  expect(await testDb().select().from(tags).where(eq(tags.userId, userId))).toHaveLength(1);
});

test('keep both copies a Note under a new id; a Secret whose attachment is already here cannot be copied', async ({
  page,
}) => {
  const { expected, userId } = await restoreGolden(page);
  await testDb()
    .update(notes)
    .set({ title: 'Note edited here' })
    .where(byId(notes, userId, expected.note.id));
  await testDb()
    .update(secretNotes)
    .set({ title: 'Secret edited here' })
    .where(byId(secretNotes, userId, expected.secret.id));

  await inspectMerge(page, expected.archivePassword);
  expect(await outcomeRow(page, 'Notes')).toEqual([0, 0, 1]);
  expect(await outcomeRow(page, 'Secrets')).toEqual([0, 0, 1]);
  await expect(page.getByRole('heading', { name: 'Resolve 2 conflicts' })).toBeVisible();

  // A Secret's encrypted body names its attachments by id, so a copy would
  // have to share them — refused while those ids already exist here.
  await expect(resolve(page, expected.secret.title).getByLabel('Keep both')).toBeDisabled();
  await expect(resolve(page, expected.secret.title).getByLabel('Keep existing')).toBeChecked();

  await resolve(page, expected.note.title).getByLabel('Keep both').check();
  await expect(page.getByText('0 new, 0 replaced, 1 kept as copies')).toBeVisible();
  await importButton(page).click();
  await merged(page);
  await expect(page.getByText('0 added, 0 replaced, 1 kept as copies')).toBeVisible();

  const userNotes = await testDb().select().from(notes).where(eq(notes.userId, userId));
  expect(userNotes).toHaveLength(2);
  const original = userNotes.find((note) => note.id === expected.note.id)!;
  const copy = userNotes.find((note) => note.id !== expected.note.id)!;
  expect(original.title).toBe('Note edited here');
  expect(copy).toMatchObject({ title: expected.note.title, content: expected.note.content });
  const copyHistory = await testDb()
    .select()
    .from(noteVersions)
    .where(and(eq(noteVersions.userId, userId), eq(noteVersions.noteId, copy.id)));
  expect(copyHistory.map((version) => version.title)).toEqual(expected.note.historyTitles);
  expect(await testDb().select().from(noteTags).where(eq(noteTags.noteId, copy.id))).toHaveLength(1);

  // Kept, the default: the Secret is exactly as this account had it.
  const secrets = await testDb().select().from(secretNotes).where(eq(secretNotes.userId, userId));
  expect(secrets).toMatchObject([{ id: expected.secret.id, title: 'Secret edited here' }]);
});

test('Seals and Authenticator records only offer keep or replace, and replace restores them', async ({ page }) => {
  const { expected, userId } = await restoreGolden(page);
  await testDb()
    .update(sealNotes)
    .set({ title: 'Seal edited here' })
    .where(byId(sealNotes, userId, expected.seal.id));
  const [otpBefore] = await testDb()
    .update(otpRecords)
    .set({ color: 'red', revision: 7 })
    .where(byId(otpRecords, userId, expected.authenticator.id))
    .returning();

  await inspectMerge(page, expected.archivePassword);
  expect(await outcomeRow(page, 'Seals')).toEqual([0, 0, 1]);
  expect(await outcomeRow(page, 'Authenticator')).toEqual([0, 0, 1]);
  await expect(page.getByText(/^Keep both is unavailable\./)).toHaveCount(2);
  for (const category of ['Seals', 'Authenticator']) {
    const applyAll = page.getByRole('group', { name: `Apply to all ${category}` });
    await expect(applyAll.getByRole('button', { name: 'Keep both' })).toBeDisabled();
    await applyAll.getByRole('button', { name: 'Replace from backup' }).click();
  }
  // Encrypted issuer and account: an Authenticator conflict is named by id.
  await expect(
    resolve(page, `Credential …${expected.authenticator.id.slice(-6)}`).getByLabel('Keep both'),
  ).toBeDisabled();
  await expect(resolve(page, expected.seal.title).getByLabel('Replace from backup')).toBeChecked();
  await expect(page.getByText('2 items will be replaced')).toBeVisible();
  await importButton(page).click();
  await merged(page);
  await expect(page.getByText('0 added, 2 replaced, 0 kept as copies')).toBeVisible();

  const [seal] = await testDb()
    .select()
    .from(sealNotes)
    .where(byId(sealNotes, userId, expected.seal.id));
  expect(seal.title).toBe(expected.seal.title);
  const mek = await mekFromPassphrase(userId, expected.vaultPassphrase);
  expect(await decryptSealHead(expected.seal.id, mek, userId)).toBe(expected.seal.content);
  // The Seal's attachment was identical, so it was reused rather than re-uploaded.
  const files = await testDb().select().from(fileAttachments).where(eq(fileAttachments.userId, userId));
  expect(files.filter((file) => file.deletedAt === null)).toHaveLength(expected.files.length);

  // Every device syncs to the replaced record: its revision passes both histories.
  const [otp] = await testDb()
    .select()
    .from(otpRecords)
    .where(byId(otpRecords, userId, expected.authenticator.id));
  expect(otp.color).toBeNull();
  expect(otp.revision).toBeGreaterThan(otpBefore.revision);
});

test('by default a conflict keeps what is here while new items still land', async ({ page, context }) => {
  const { expected, userId } = await restoreGolden(page);
  await testDb()
    .update(notes)
    .set({ title: 'Note edited here' })
    .where(byId(notes, userId, expected.note.id));
  await testDb()
    .update(sealNotes)
    .set({ deletedAt: new Date() })
    .where(byId(sealNotes, userId, expected.seal.id));
  await testDb()
    .delete(otpRecords)
    .where(byId(otpRecords, userId, expected.authenticator.id));

  await inspectMerge(page, expected.archivePassword);
  expect(await outcomeRow(page, 'Authenticator')).toEqual([1, 0, 0]);

  // A trashed item has nowhere to open; a live one opens in the ordinary vault.
  const sealConflict = page.getByTestId('import-conflict').filter({ has: resolve(page, expected.seal.title) });
  await expect(sealConflict).toContainText('in trash');
  await expect(sealConflict.getByRole('link', { name: 'Open in a new tab' })).toHaveCount(0);
  const noteConflict = page.getByTestId('import-conflict').filter({ has: resolve(page, expected.note.title) });
  const [opened] = await Promise.all([
    context.waitForEvent('page'),
    noteConflict.getByRole('link', { name: 'Open in a new tab' }).click(),
  ]);
  await expect(opened).toHaveURL(new RegExp(`/\\?id=${expected.note.id}$`));
  await expect(opened.getByTestId('note-modal')).toBeVisible();
  await expect(opened.getByTestId('note-title')).toContainText('Note edited here');
  await opened.close();

  await expect(page.getByText('1 new, 0 replaced, 0 kept as copies')).toBeVisible();
  await importButton(page).click();
  await merged(page);
  await expect(page.getByText('1 added, 0 replaced, 0 kept as copies')).toBeVisible();

  const [note] = await testDb()
    .select()
    .from(notes)
    .where(byId(notes, userId, expected.note.id));
  expect(note.title).toBe('Note edited here');
  const [seal] = await testDb()
    .select()
    .from(sealNotes)
    .where(byId(sealNotes, userId, expected.seal.id));
  expect(seal.deletedAt).not.toBeNull();
  expect(await testDb().select().from(otpRecords).where(eq(otpRecords.userId, userId))).toHaveLength(1);
});

test('a change made after the review is caught at commit, and the archive can be reviewed again', async ({ page }) => {
  const { expected, userId } = await restoreGolden(page);
  const secret = byId(secretNotes, userId, expected.secret.id);
  await testDb().update(secretNotes).set({ title: 'First edit' }).where(secret);

  await inspectMerge(page, expected.archivePassword);
  const conflict = page.getByTestId('import-conflict');
  await expect(conflict).toContainText('First edit');
  await resolve(page, expected.secret.title).getByLabel('Replace from backup').check();

  // Another device saves the Secret between review and commit.
  await testDb().update(secretNotes).set({ title: 'Second edit' }).where(secret);
  await importButton(page).click();
  await expect(page.locator('main').getByRole('alert')).toHaveText(
    /Your vault changed after you reviewed this import/,
    {
      timeout: 60_000,
    },
  );
  const [unchanged] = await testDb().select().from(secretNotes).where(secret);
  expect(unchanged.title).toBe('Second edit');

  // The verified archive is still in hand: no file or password again.
  await page.getByRole('button', { name: 'Review again' }).click();
  await expect(reviewHeading(page, 'merge')).toBeVisible({ timeout: 60_000 });
  await expect(conflict).toContainText('Second edit');
  await expect(resolve(page, expected.secret.title).getByLabel('Keep existing')).toBeChecked();
  await resolve(page, expected.secret.title).getByLabel('Replace from backup').check();
  await importButton(page).click();
  await merged(page);
  await expect(page.getByText('0 added, 1 replaced, 0 kept as copies')).toBeVisible();

  const [replaced] = await testDb().select().from(secretNotes).where(secret);
  expect(replaced.title).toBe(expected.secret.title);
});

test('tags can be dropped or created when none of the archive’s tags exist here', async ({ page }) => {
  const { expected, userId } = await restoreGolden(page);
  await testDb().update(tags).set({ name: 'renamed' }).where(eq(tags.userId, userId));
  const note = byId(notes, userId, expected.note.id);
  await testDb().delete(notes).where(note);

  await inspectMerge(page, expected.archivePassword);
  // Nothing matches by name, so there is nothing to reuse.
  await expect(page.getByRole('radio', { name: /Reuse existing tags only/ })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: /Create all 1 tags/ })).toBeChecked();
  await page.getByRole('radio', { name: /Import without tags/ }).check();
  await importButton(page).click();
  await merged(page);
  expect(await testDb().select().from(notes).where(note)).toHaveLength(1);
  expect(await testDb().select().from(noteTags).where(eq(noteTags.userId, userId))).toHaveLength(0);
  expect((await testDb().select().from(tags).where(eq(tags.userId, userId))).map((tag) => tag.name)).toEqual([
    'renamed',
  ]);

  await testDb().delete(notes).where(note);
  await inspectMerge(page, expected.archivePassword);
  await page.getByRole('radio', { name: /Create all 1 tags/ }).check();
  await importButton(page).click();
  await merged(page);
  const userTags = await testDb().select().from(tags).where(eq(tags.userId, userId));
  expect(userTags.map((tag) => tag.name).sort()).toEqual(['golden', 'renamed']);
  const golden = userTags.find((tag) => tag.name === 'golden')!;
  expect(await testDb().select().from(noteTags).where(eq(noteTags.userId, userId))).toMatchObject([
    { noteId: expected.note.id, tagId: golden.id },
  ]);
});

test('cancelling an import before it commits leaves the vault untouched', async ({ page }) => {
  const { expected, userId } = await restoreGolden(page);
  await testDb()
    .delete(notes)
    .where(byId(notes, userId, expected.note.id));

  await inspectMerge(page, expected.archivePassword);
  // Hold the plan at the server's door so the import is caught mid-flight.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/trpc/vaultImport.begin**', async (route) => {
    await held;
    await route.continue();
  });
  const beginResponse = page.waitForResponse('**/api/trpc/vaultImport.begin**');
  await importButton(page).click();
  await page.getByRole('button', { name: 'Cancel import' }).click();
  release();
  await beginResponse;

  await expect(page.locator('main').getByRole('alert')).toHaveText(
    'Import cancelled. Nothing was added to your vault.',
  );
  await expect(page.getByRole('button', { name: 'Inspect archive' })).toBeVisible();
  expect(await testDb().select().from(notes).where(eq(notes.userId, userId))).toHaveLength(0);
  await expect
    .poll(async () =>
      (await testDb().select().from(vaultImports).where(eq(vaultImports.userId, userId))).map((row) => row.phase),
    )
    .not.toContain('review');
  const phases = (await testDb().select().from(vaultImports).where(eq(vaultImports.userId, userId))).map(
    (row) => row.phase,
  );
  expect(phases.filter((phase) => phase !== 'committed')).toEqual(['aborted']);
});
