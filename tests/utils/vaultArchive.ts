import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, type Page } from '@playwright/test';

import { makeAccount } from './makeAccount';
import { createTestSession } from './createTestSession';
import { injectSession } from './injectSession';
import { getOrCreateUserId } from '../fixtures/getOrCreateUserId';

/** Drivers for the Export and Import pages, shared by the vault-* specs. */

const GOLDEN_DIR = path.resolve(__dirname, '../fixtures/vault-archives');
export const GOLDEN_ARCHIVE = path.join(GOLDEN_DIR, 'v1-sample.snvault');

export type GoldenExpected = {
  vaultPassphrase: string;
  archivePassword: string;
  note: { id: string; title: string; content: string; historyTitles: string[]; tags: string[] };
  secret: { id: string; title: string; content: string; historyTitles: string[] };
  seal: { id: string; title: string; content: string };
  authenticator: { id: string; issuer: string };
  files: Array<{ id: string; owner: 'secrets' | 'seals'; filename: string; sha256: string }>;
};

export const goldenExpected = () =>
  JSON.parse(readFileSync(path.join(GOLDEN_DIR, 'v1-sample.json'), 'utf8')) as GoldenExpected;

/**
 * Exports through the browser and returns the downloaded archive's path.
 *
 * Headless Chromium exposes the picker API but cannot service its native
 * dialog, so this exercises the production Blob fallback — which is also what
 * browsers without File System Access use for a small archive.
 */
export async function exportVault(page: Page, password: string): Promise<string> {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });
  await page.goto('/export');
  await page.getByRole('textbox', { name: /^Archive password/ }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('start-vault-export').click();
  const archivePath = await (await downloadPromise).path();
  expect(archivePath).toBeTruthy();
  await expect(page.getByText('Encrypted vault downloaded')).toBeVisible({ timeout: 60_000 });
  return archivePath!;
}

/** Picks the archive and asks the Import page to inspect it. */
export async function inspectArchive(page: Page, archivePath: string, password: string) {
  await page.goto('/import');
  await page.locator('input[type=file]').setInputFiles(archivePath);
  await page.getByRole('textbox', { name: /^Archive password/ }).fill(password);
  await page.getByRole('button', { name: 'Inspect archive' }).click();
}

/** The review heading, once analysis and the id comparison are done. */
export const reviewHeading = (page: Page, mode: 'merge' | 'restore') =>
  page.getByRole('heading', { name: mode === 'merge' ? 'Review this merge' : 'Review this restore' });

/** The outcome table's row for one category: [new, identical, conflicts]. */
export async function outcomeRow(page: Page, label: 'Notes' | 'Secrets' | 'Seals' | 'Authenticator') {
  const row = page.getByRole('row', { name: new RegExp(`^${label}\\b`) });
  return (await row.getByRole('cell').allTextContents()).map(Number);
}

/**
 * Restores the committed golden archive into a new account. The account then
 * holds the archive's vault identity, so the same archive merges back into it.
 */
export async function restoreGolden(page: Page) {
  const expected = goldenExpected();
  const { account } = makeAccount();
  await injectSession(page, await createTestSession(account.address));
  const userId = await getOrCreateUserId(account.address);
  await inspectArchive(page, GOLDEN_ARCHIVE, expected.archivePassword);
  await expect(reviewHeading(page, 'restore')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Restore vault' }).click();
  await expect(page.getByText('Vault restored')).toBeVisible({ timeout: 60_000 });
  return { expected, userId, address: account.address };
}
