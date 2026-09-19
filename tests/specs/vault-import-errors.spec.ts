import { readFileSync, writeFileSync } from 'node:fs';

import { test, expect, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';

import {
  encryptionProfiles,
  encryptionStates,
  notes,
  otpRecords,
  sealNotes,
  secretNotes,
  vaultImports,
} from '../../src/db/schema';
import { makeAccount } from '../utils/makeAccount';
import { createTestSession } from '../utils/createTestSession';
import { injectSession } from '../utils/injectSession';
import { getOrCreateUserId } from '../fixtures/getOrCreateUserId';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';
import { seedNotes } from '../fixtures/seedNotes';
import { testDb } from '../fixtures/db';
import { GOLDEN_ARCHIVE, goldenExpected, inspectArchive, reviewHeading } from '../utils/vaultArchive';

/**
 * Everything the Import page must refuse, and how. Each case ends with the
 * account exactly as it started: no records, and no import left open.
 */

test.describe.configure({ timeout: 120_000 });

const expected = goldenExpected();
const WRONG_PASSWORD = 'That password did not open the archive. Check it and try again.';
const DAMAGED = 'This file is damaged, incomplete, or not a supported SigNote vault archive.';

async function signedIn(page: Page) {
  const { account } = makeAccount();
  await injectSession(page, await createTestSession(account.address));
  return { address: account.address, userId: await getOrCreateUserId(account.address) };
}

/** A copy of the golden archive with `edit` applied to its bytes. */
function alteredArchive(name: string, edit: (bytes: Buffer) => Buffer) {
  const target = test.info().outputPath(name);
  writeFileSync(target, edit(readFileSync(GOLDEN_ARCHIVE)));
  return target;
}

async function expectUntouched(userId: string) {
  for (const table of [notes, secretNotes, sealNotes, otpRecords])
    expect(await testDb().select().from(table).where(eq(table.userId, userId))).toHaveLength(0);
  const open = await testDb().select().from(vaultImports).where(eq(vaultImports.userId, userId));
  expect(open.filter((row) => row.phase !== 'aborted')).toHaveLength(0);
}

// Scoped to the page: Next's route announcer is an (empty) alert too.
const alert = (page: Page) => page.locator('main').getByRole('alert');

test('a wrong password is refused locally and the same file can be retried', async ({ page }) => {
  const { userId } = await signedIn(page);
  await inspectArchive(page, GOLDEN_ARCHIVE, 'not the archive password');
  await expect(alert(page)).toHaveText(WRONG_PASSWORD, { timeout: 60_000 });
  // Decryption failed in the browser: the server never heard of this archive.
  expect(await testDb().select().from(vaultImports).where(eq(vaultImports.userId, userId))).toHaveLength(0);

  // The chosen file is kept; only the password needs correcting.
  await page.getByRole('textbox', { name: /^Archive password/ }).fill(expected.archivePassword);
  await page.getByRole('button', { name: 'Inspect archive' }).click();
  await expect(reviewHeading(page, 'restore')).toBeVisible({ timeout: 60_000 });
  await expect(alert(page)).toHaveCount(0);
});

test('a file that is not a vault archive is refused', async ({ page }) => {
  const { userId } = await signedIn(page);
  const target = test.info().outputPath('notes.snvault');
  writeFileSync(target, 'just some text that happens to have the right extension\n'.repeat(100));
  await inspectArchive(page, target, expected.archivePassword);
  await expect(alert(page)).toHaveText(DAMAGED, { timeout: 60_000 });
  await expectUntouched(userId);
});

test('a single altered byte fails authentication and nothing is imported', async ({ page }) => {
  const { userId } = await signedIn(page);
  const target = alteredArchive('tampered.snvault', (bytes) => {
    const copy = Buffer.from(bytes);
    const middle = Math.floor(copy.length / 2);
    copy[middle] ^= 0x01;
    return copy;
  });
  await inspectArchive(page, target, expected.archivePassword);
  // Authenticated encryption can't tell a wrong key from altered ciphertext.
  await expect(alert(page)).toHaveText(WRONG_PASSWORD, { timeout: 60_000 });
  await expectUntouched(userId);
});

test('a truncated archive is refused even though every chunk it has authenticates', async ({ page }) => {
  const { userId } = await signedIn(page);
  const target = alteredArchive('truncated.snvault', (bytes) => bytes.subarray(0, bytes.length - 64));
  await inspectArchive(page, target, expected.archivePassword);
  await expect(alert(page)).toHaveText(new RegExp(`${DAMAGED}|${WRONG_PASSWORD}`.replaceAll('.', '\\.')), {
    timeout: 60_000,
  });
  await expectUntouched(userId);
});

test('an account under a different vault key refuses encrypted items before anything is staged', async ({ page }) => {
  const { address, userId } = await signedIn(page);
  await seedEncryptionProfile(address, 'a-different-vault-passphrase');
  // What a first unlock records; any other vault's identity differs from the archive's.
  await testDb()
    .update(encryptionProfiles)
    .set({ vaultKeyId: 'A'.repeat(43) })
    .where(eq(encryptionProfiles.userId, userId));

  await inspectArchive(page, GOLDEN_ARCHIVE, expected.archivePassword);
  await expect(alert(page)).toHaveText(
    'This account uses a different encryption key. The archive’s encrypted items cannot be imported here.',
    { timeout: 60_000 },
  );
  await expectUntouched(userId);
});

test('a vault that has never recorded its identity is asked to unlock once first', async ({ page }) => {
  const { address, userId } = await signedIn(page);
  // A profile from before vault identities: no vaultKeyId until its next unlock.
  await seedEncryptionProfile(address, expected.vaultPassphrase);

  await inspectArchive(page, GOLDEN_ARCHIVE, expected.archivePassword);
  await expect(alert(page)).toHaveText(/Unlock Secrets in this account once/, { timeout: 60_000 });
  await expectUntouched(userId);
});

test('an import cannot start while a key rotation is in progress', async ({ page }) => {
  const { address, userId } = await signedIn(page);
  await seedNotes(address, [{ title: 'Already here' }]);
  await testDb()
    .insert(encryptionStates)
    .values({ userId, activeRotationId: 'rotation-in-progress' })
    .onConflictDoUpdate({ target: encryptionStates.userId, set: { activeRotationId: 'rotation-in-progress' } });

  await inspectArchive(page, GOLDEN_ARCHIVE, expected.archivePassword);
  await expect(alert(page)).toHaveText(/Another import or a key rotation is in progress/, { timeout: 60_000 });
  expect(await testDb().select().from(vaultImports).where(eq(vaultImports.userId, userId))).toHaveLength(0);
});

const openImports = async (userId: string) =>
  (await testDb().select().from(vaultImports).where(eq(vaultImports.userId, userId))).map((row) => row.phase);

test('leaving the page mid-import releases it, so the next attempt is not blocked', async ({ page }) => {
  const { userId } = await signedIn(page);
  await inspectArchive(page, GOLDEN_ARCHIVE, expected.archivePassword);
  await expect(reviewHeading(page, 'restore')).toBeVisible({ timeout: 60_000 });
  expect(await openImports(userId)).toEqual(['review']);

  // The page says so on its way out.
  await page.goto('/profile');
  await expect.poll(() => openImports(userId)).toEqual(['aborted']);

  await inspectArchive(page, GOLDEN_ARCHIVE, expected.archivePassword);
  await expect(reviewHeading(page, 'restore')).toBeVisible({ timeout: 60_000 });
});

test('an import left open by a browser that went away can be discarded from the next one', async ({
  page,
  browser,
}) => {
  const { address, userId } = await signedIn(page);
  // Another browser opens an import and is killed outright, with no page
  // lifecycle to tell the server on the way out.
  const gone = await browser.newContext({ baseURL: 'http://localhost:5005', serviceWorkers: 'block' });
  const gonePage = await gone.newPage();
  await injectSession(gonePage, await createTestSession(address));
  await inspectArchive(gonePage, GOLDEN_ARCHIVE, expected.archivePassword);
  await expect(reviewHeading(gonePage, 'restore')).toBeVisible({ timeout: 60_000 });
  await gone.close();
  expect(await openImports(userId)).toEqual(['review']);

  await inspectArchive(page, GOLDEN_ARCHIVE, expected.archivePassword);
  await expect(alert(page)).toHaveText(/An unfinished import is still open for this account/, { timeout: 60_000 });
  expect(await openImports(userId)).toEqual(['review']);

  // The file and password are still chosen: discarding goes straight on.
  await page.getByRole('button', { name: 'Discard it and continue' }).click();
  await expect(reviewHeading(page, 'restore')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Restore vault' }).click();
  await expect(page.getByText('Vault restored')).toBeVisible({ timeout: 60_000 });
  expect((await openImports(userId)).sort()).toEqual(['aborted', 'committed']);
});
