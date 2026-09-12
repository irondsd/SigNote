import { test, expect } from '@playwright/test';
import { eq } from 'drizzle-orm';

import { RotationPage } from '../pages/RotationPage';
import { testDb } from '../fixtures/db';
import { getOrCreateUserId } from '../fixtures/getOrCreateUserId';
import { seedSecrets } from '../fixtures/seedSecrets';
import { decryptStoredFile, seedEncryptedFile, type SeededFile } from '../fixtures/seedEncryptedFile';
import { encryptionStates, fileAttachments, rotationCleanup } from '../../src/db/schema';
import { decryptSecretHead, mekFromPassphrase } from '../utils/vaultCrypto';

/**
 * Encrypted attachments, which are the only part of a rotation that leaves the
 * app server entirely.
 *
 * File bodies go browser → presigned URL → object store and back, so what has
 * to be proved here is different from the database tiers: the bytes that come
 * out are identical, the pointer still names a file the rest of the app can
 * fetch, damaged source data blocks completion instead of being papered over,
 * and a storage fault is survivable rather than destructive.
 */

test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

const control = (action: string, body: unknown = {}) =>
  fetch(`${process.env.MOCK_S3_CONTROL_URL}/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

async function vaultWithFiles(page: import('@playwright/test').Page, sizes: number[]) {
  const rotationPage = new RotationPage(page);
  const { address, mekBytes } = await rotationPage.signInWithProfile({ navigate: false });
  const userId = await getOrCreateUserId(address);
  const [secret] = await seedSecrets(address, mekBytes, [{ title: 'Bank', content: 'account 1234' }]);

  await page.goto('/');
  const files: SeededFile[] = [];
  for (const [index, bytes] of sizes.entries()) {
    files.push(await seedEncryptedFile(page.request, mekBytes, { bytes, filename: `file-${index}.bin` }));
  }

  await rotationPage.goto();
  return { rotationPage, address, userId, mekBytes, secret, files };
}

async function runToActivation(rotationPage: RotationPage) {
  await rotationPage.runUntilActivation();
  await rotationPage.activate();
}

test.beforeEach(async () => {
  await control('reset');
});

test.describe('transfer', () => {
  test('files across the size range come back byte-identical and keep their ids', async ({ page }) => {
    // 16 bytes is the smallest an AES-GCM object can be (the tag alone), and
    // just under 5 MiB is the largest the upload route accepts once the tag is
    // added. Both boundaries, plus an ordinary one in between.
    const vault = await vaultWithFiles(page, [16, 64 * 1024, 5 * 1024 * 1024 - 32]);
    const before = await testDb().select().from(fileAttachments).where(eq(fileAttachments.userId, vault.userId));

    await runToActivation(vault.rotationPage);

    const newMek = await mekFromPassphrase(vault.userId, RotationPage.NEW_PASSPHRASE);
    for (const file of vault.files) {
      const bytes = await decryptStoredFile(page.request, file.fileId, newMek, 1);
      expect(Buffer.from(bytes)).toEqual(Buffer.from(file.plaintext));
    }

    const after = await testDb().select().from(fileAttachments).where(eq(fileAttachments.userId, vault.userId));
    // The id is what note HTML embeds, so it has to survive; the object key and
    // the IV are what rotation replaces.
    expect(after.map((row) => row.id).sort()).toEqual(before.map((row) => row.id).sort());
    for (const row of after) {
      const original = before.find((candidate) => candidate.id === row.id)!;
      expect(row.s3Key).not.toBe(original.s3Key);
      expect(row.encryptionIv).not.toBe(original.encryptionIv);
      expect(row.size).toBe(original.size);
      expect(row.filename).toBe(original.filename);
    }
  });

  test('the superseded objects are queued for cleanup, not deleted inside activation', async ({ page }) => {
    const vault = await vaultWithFiles(page, [4096]);
    const [before] = await testDb().select().from(fileAttachments).where(eq(fileAttachments.userId, vault.userId));

    await runToActivation(vault.rotationPage);

    const queued = await testDb().select().from(rotationCleanup).where(eq(rotationCleanup.userId, vault.userId));
    expect(queued.map((task) => task.objectKey)).toContain(before.s3Key);
    // Still present: activation does no storage I/O, so reclaiming the old body
    // is background work whose failure cannot roll back a committed rotation.
    const objects = (await (await fetch(`${process.env.MOCK_S3_CONTROL_URL}/objects`)).json()) as {
      objects: { key: string }[];
    };
    expect(objects.objects.some((object) => object.key.includes(before.s3Key))).toBe(true);
  });
});

test.describe('damaged and unavailable data', () => {
  test('a missing source object blocks completion and leaves the old vault intact', async ({ page }) => {
    const vault = await vaultWithFiles(page, [4096]);
    const [attachment] = await testDb().select().from(fileAttachments).where(eq(fileAttachments.userId, vault.userId));
    await control('delete', { keyPattern: attachment.s3Key });

    await vault.rotationPage.startFromIntro();
    await vault.rotationPage.revokeOtherSessions();
    await vault.rotationPage.continueStep();
    await vault.rotationPage.acknowledgeDrafts();
    await vault.rotationPage.continueStep();
    await vault.rotationPage.enterPassphrases(RotationPage.PASSPHRASE, RotationPage.NEW_PASSPHRASE);
    await vault.rotationPage.expectStep('confirm', 90_000);
    await vault.rotationPage.begin();
    await page.getByTestId('rotation-process').click();

    await expect(page.getByTestId('rotation-error')).toBeVisible({ timeout: 120_000 });
    // Still on the worker step: the run cannot reach the recovery file, let
    // alone activation, while an item it must replace cannot be read.
    await vault.rotationPage.expectStep('running');
    const [state] = await testDb().select().from(encryptionStates).where(eq(encryptionStates.userId, vault.userId));
    expect(state.generation).toBe(0);
    expect(await decryptSecretHead(vault.secret.id, vault.mekBytes)).toBe('account 1234');
  });

  test('a corrupted source object is caught by decryption, not by a size check', async ({ page }) => {
    const vault = await vaultWithFiles(page, [4096]);
    const [attachment] = await testDb().select().from(fileAttachments).where(eq(fileAttachments.userId, vault.userId));
    // Same length, different bytes: only an authenticated decrypt notices.
    await control('corrupt', { keyPattern: attachment.s3Key });

    await vault.rotationPage.startFromIntro();
    await vault.rotationPage.revokeOtherSessions();
    await vault.rotationPage.continueStep();
    await vault.rotationPage.acknowledgeDrafts();
    await vault.rotationPage.continueStep();
    await vault.rotationPage.enterPassphrases(RotationPage.PASSPHRASE, RotationPage.NEW_PASSPHRASE);
    await vault.rotationPage.expectStep('confirm', 90_000);
    await vault.rotationPage.begin();
    await page.getByTestId('rotation-process').click();

    await expect(page.getByTestId('rotation-error')).toBeVisible({ timeout: 120_000 });
    const [state] = await testDb().select().from(encryptionStates).where(eq(encryptionStates.userId, vault.userId));
    expect(state.generation).toBe(0);
  });

  test('a transient storage failure is retried and the run still finishes', async ({ page }) => {
    const vault = await vaultWithFiles(page, [4096]);
    // One 500 on the upload. Transient by classification, so the transport's
    // bounded retry should absorb it without the user doing anything.
    await control('fail', { method: 'PUT', keyPattern: 'rotation/', status: 500, times: 1 });

    await runToActivation(vault.rotationPage);

    const newMek = await mekFromPassphrase(vault.userId, RotationPage.NEW_PASSPHRASE);
    const bytes = await decryptStoredFile(page.request, vault.files[0].fileId, newMek, 1);
    expect(Buffer.from(bytes)).toEqual(Buffer.from(vault.files[0].plaintext));
  });
});
