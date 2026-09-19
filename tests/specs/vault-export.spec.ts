import { test, expect, type Page } from '@playwright/test';
import { and, eq } from 'drizzle-orm';

import { encryptionProfiles, encryptionStates, notes, vaultExports } from '../../src/db/schema';
import { makeAccount } from '../utils/makeAccount';
import { createTestSession } from '../utils/createTestSession';
import { injectSession } from '../utils/injectSession';
import { getOrCreateUserId } from '../fixtures/getOrCreateUserId';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';
import { seedNotes } from '../fixtures/seedNotes';
import { seedSecrets } from '../fixtures/seedSecrets';
import { testDb } from '../fixtures/db';
import { SecretsPage } from '../pages/SecretsPage';
import { exportVault, inspectArchive, outcomeRow, reviewHeading } from '../utils/vaultArchive';

/** The Export page: what it lets you start, and what a failed or cancelled
 * export leaves behind — no file, and no operation still open. */

test.describe.configure({ timeout: 120_000 });

const PASSWORD = 'portable-archive-password-42';

async function signedIn(page: Page) {
  const { account } = makeAccount();
  await injectSession(page, await createTestSession(account.address));
  return { address: account.address, userId: await getOrCreateUserId(account.address) };
}

/** An account whose vault has recorded its identity, as encrypted exports require. */
async function unlockedVault(page: Page) {
  const signed = await signedIn(page);
  const { mekBytes } = await seedEncryptionProfile(signed.address, SecretsPage.PASSPHRASE);
  await page.goto('/secrets');
  await new SecretsPage(page).unlock();
  return { ...signed, mekBytes };
}

const include = (page: Page, label: string) => page.getByRole('switch', { name: `Include ${label}` });
const startButton = (page: Page) => page.getByTestId('start-vault-export');
const passwordInput = (page: Page) => page.getByRole('textbox', { name: /^Archive password/ });
const confirmInput = (page: Page) => page.getByLabel('Confirm password');

async function exportsOf(userId: string) {
  return testDb().select().from(vaultExports).where(eq(vaultExports.userId, userId));
}

test('Profile links to Export and Import', async ({ page }) => {
  await signedIn(page);
  await page.goto('/profile');
  const card = page.getByTestId('data-portability-section');
  await card.getByTestId('export-vault-btn').click();
  await expect(page.getByRole('heading', { name: 'Export your vault' })).toBeVisible();
  await page.goto('/profile');
  await card.getByTestId('import-vault-btn').click();
  await expect(page.getByRole('heading', { name: 'Import a vault' })).toBeVisible();
});

test('the archive password must be 12 characters and confirmed; the generator fills both', async ({ page }) => {
  const { address } = await signedIn(page);
  await seedNotes(address, [{ title: 'Something to export' }]);
  await page.goto('/export');
  await expect(include(page, 'Notes')).toBeChecked();

  await passwordInput(page).fill('too-short');
  await expect(page.getByText('Use at least 12 characters.')).toBeVisible();
  await expect(startButton(page)).toBeDisabled();

  await passwordInput(page).fill(PASSWORD);
  await confirmInput(page).fill(`${PASSWORD}-typo`);
  await expect(page.getByText('Passwords do not match.')).toBeVisible();
  await expect(startButton(page)).toBeDisabled();

  await confirmInput(page).fill(PASSWORD);
  await expect(page.getByText('Passwords do not match.')).toHaveCount(0);
  await expect(startButton(page)).toBeEnabled();

  await page.getByRole('button', { name: 'Generate a strong password' }).click();
  const generated = await passwordInput(page).inputValue();
  expect(generated.length).toBeGreaterThanOrEqual(32);
  await expect(confirmInput(page)).toHaveValue(generated);
  await expect(page.getByText(generated, { exact: true })).toBeVisible();
  await expect(startButton(page)).toBeEnabled();

  // Nothing selected, nothing to export.
  await include(page, 'Notes').click();
  await expect(startButton(page)).toBeDisabled();
});

test('without vault encryption only Notes can be exported, and that archive merges into any vault', async ({
  page,
  browser,
}) => {
  const { address } = await signedIn(page);
  await seedNotes(address, [{ title: 'Plain note', content: '<p>No vault needed</p>' }]);
  await page.goto('/export');
  // Empty categories start switched off.
  await expect(include(page, 'Notes')).toBeChecked();
  await expect(include(page, 'Secrets')).not.toBeChecked();

  await include(page, 'Secrets').click();
  await expect(
    page.getByText('Set up vault encryption before including Secrets, Seals or Authenticator.'),
  ).toBeVisible();
  await passwordInput(page).fill(PASSWORD);
  await confirmInput(page).fill(PASSWORD);
  await expect(startButton(page)).toBeDisabled();
  await include(page, 'Secrets').click();
  await expect(startButton(page)).toBeEnabled();
  const archivePath = await exportVault(page, PASSWORD);

  // A Notes-only archive holds no ciphertext, so an account under an
  // unrelated vault key — with data of its own — takes it as a merge.
  const context = await browser.newContext({ baseURL: 'http://localhost:5005', serviceWorkers: 'block' });
  const destination = await context.newPage();
  const target = await unlockedVault(destination);
  await seedNotes(target.address, [{ title: 'Already here' }]);
  await inspectArchive(destination, archivePath, PASSWORD);
  await expect(reviewHeading(destination, 'merge')).toBeVisible({ timeout: 60_000 });
  await expect(destination.getByText('Not included')).toBeVisible();
  expect(await outcomeRow(destination, 'Notes')).toEqual([1, 0, 0]);
  await destination.getByRole('button', { name: 'Import into vault' }).click();
  await expect(destination.getByText('Vault merged')).toBeVisible({ timeout: 60_000 });
  await context.close();

  const restored = await testDb().select().from(notes).where(eq(notes.userId, target.userId));
  expect(restored.map((note) => note.title).sort()).toEqual(['Already here', 'Plain note']);
});

test('a vault without a recorded identity must be unlocked once before an encrypted export', async ({ page }) => {
  const { address, userId } = await signedIn(page);
  const { mekBytes } = await seedEncryptionProfile(address, SecretsPage.PASSPHRASE);
  await seedSecrets(address, mekBytes, [{ title: 'Needs the vault id', content: 'x' }]);

  await page.goto('/export');
  await expect(include(page, 'Secrets')).toBeChecked();
  await expect(page.getByText(/Unlock your vault once to create its portable identity/)).toBeVisible();
  await passwordInput(page).fill(PASSWORD);
  await confirmInput(page).fill(PASSWORD);
  await expect(startButton(page)).toBeDisabled();

  await page.goto('/secrets');
  await new SecretsPage(page).unlock();
  const [profile] = await testDb().select().from(encryptionProfiles).where(eq(encryptionProfiles.userId, userId));
  expect(profile.vaultKeyId).toBeTruthy();

  await page.goto('/export');
  await expect(include(page, 'Secrets')).toBeChecked();
  await expect(page.getByText(/Unlock your vault once/)).toHaveCount(0);
  await passwordInput(page).fill(PASSWORD);
  await confirmInput(page).fill(PASSWORD);
  await expect(startButton(page)).toBeEnabled();
});

test('encrypted categories wait for a key rotation to finish; Notes still export', async ({ page }) => {
  const { address, userId, mekBytes } = await unlockedVault(page);
  await seedNotes(address, [{ title: 'Plain note' }]);
  await seedSecrets(address, mekBytes, [{ title: 'Mid-rotation secret', content: 'x' }]);
  await testDb()
    .insert(encryptionStates)
    .values({ userId, activeRotationId: 'rotation-in-progress' })
    .onConflictDoUpdate({ target: encryptionStates.userId, set: { activeRotationId: 'rotation-in-progress' } });

  await page.goto('/export');
  await expect(page.getByText('Finish or cancel key rotation before exporting encrypted data.')).toBeVisible();
  await passwordInput(page).fill(PASSWORD);
  await confirmInput(page).fill(PASSWORD);
  await expect(startButton(page)).toBeDisabled();

  await include(page, 'Secrets').click();
  await expect(page.getByText(/Finish or cancel key rotation/)).toHaveCount(0);
  await expect(startButton(page)).toBeEnabled();
});

test('cancelling an export saves nothing and closes the operation', async ({ page }) => {
  const { address, userId } = await signedIn(page);
  await seedNotes(address, [{ title: 'Never exported' }]);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });
  await page.goto('/export');
  await passwordInput(page).fill(PASSWORD);
  await confirmInput(page).fill(PASSWORD);

  // Hold the snapshot request so the export is caught before it streams.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/trpc/vaultExport.begin**', async (route) => {
    await held;
    await route.continue();
  });
  const downloads: unknown[] = [];
  page.on('download', (download) => downloads.push(download));
  const begun = page.waitForResponse('**/api/trpc/vaultExport.begin**');
  await startButton(page).click();
  await expect(page.getByText('Preparing a consistent snapshot…')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel export' }).click();
  release();
  await begun;

  await expect(page.locator('main').getByRole('alert')).toHaveText('Export cancelled.');
  await expect(startButton(page)).toBeVisible();
  await expect.poll(async () => (await exportsOf(userId)).map((row) => row.status)).toEqual(['cancelled']);
  expect(downloads).toHaveLength(0);
});

test('a record changed while it is being exported fails the export instead of saving a mixed snapshot', async ({
  page,
}) => {
  const { address, userId } = await signedIn(page);
  const [note] = await seedNotes(address, [{ title: 'Before the snapshot' }]);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });
  await page.goto('/export');
  await passwordInput(page).fill(PASSWORD);
  await confirmInput(page).fill(PASSWORD);

  // The snapshot is taken; the note is edited before its record streams.
  await page.route('**/api/trpc/vaultExport.begin**', async (route) => {
    const response = await route.fetch();
    await testDb()
      .update(notes)
      .set({ title: 'Edited during export' })
      .where(and(eq(notes.userId, userId), eq(notes.id, note.id)));
    // The body comes back decoded: pass it on without the original encoding headers.
    await route.fulfill({ status: response.status(), contentType: 'application/json', body: await response.body() });
  });
  const downloads: unknown[] = [];
  page.on('download', (download) => downloads.push(download));
  await startButton(page).click();

  await expect(page.locator('main').getByRole('alert')).toHaveText(/Your vault changed/, { timeout: 60_000 });
  await expect(page.getByText('Encrypted vault downloaded')).toHaveCount(0);
  expect(downloads).toHaveLength(0);
  await expect.poll(async () => (await exportsOf(userId)).map((row) => row.status)).toEqual(['cancelled']);

  // Starting again snapshots the vault as it now is.
  await page.unrouteAll();
  const archivePath = await exportVault(page, PASSWORD);
  expect(archivePath).toBeTruthy();
});

test('a rotated vault exports every record, not just the first page of each file', async ({ page, browser }) => {
  // Records stream a page at a time, after the request handler has returned.
  // Every page past the first once lost the request's generation there, so a
  // vault that had ever been rotated broke off mid-file.
  const { address, userId } = await signedIn(page);
  const titles = Array.from({ length: 60 }, (_, index) => `Paged note ${index}`);
  await seedNotes(
    address,
    titles.map((title) => ({ title })),
  );
  await testDb()
    .insert(encryptionStates)
    .values({ userId, generation: 2 })
    .onConflictDoUpdate({ target: encryptionStates.userId, set: { generation: 2 } });
  const archivePath = await exportVault(page, PASSWORD);

  const context = await browser.newContext({ baseURL: 'http://localhost:5005', serviceWorkers: 'block' });
  const destination = await context.newPage();
  const target = await signedIn(destination);
  await inspectArchive(destination, archivePath, PASSWORD);
  await expect(reviewHeading(destination, 'restore')).toBeVisible({ timeout: 60_000 });
  expect(await outcomeRow(destination, 'Notes')).toEqual([60, 0, 0]);
  await destination.getByRole('button', { name: 'Restore vault' }).click();
  await expect(destination.getByText('Vault restored')).toBeVisible({ timeout: 60_000 });
  await context.close();

  const restored = await testDb().select().from(notes).where(eq(notes.userId, target.userId));
  expect(restored.map((note) => note.title).sort()).toEqual([...titles].sort());
});
