import { test, expect } from '@playwright/test';
import { eq } from 'drizzle-orm';

import { RotationPage } from '../pages/RotationPage';
import { SecretsPage } from '../pages/SecretsPage';
import { testDb } from '../fixtures/db';
import { getOrCreateUserId } from '../fixtures/getOrCreateUserId';
import { seedSecrets } from '../fixtures/seedSecrets';
import { seedSeals } from '../fixtures/seedSeals';
import { seedOtpRecords } from '../fixtures/seedOtpRecords';
import { seedNotes } from '../fixtures/seedNotes';
import { seedSecretVersions, seedSealVersions } from '../fixtures/seedVersions';
import { decryptStoredFile, seedEncryptedFile } from '../fixtures/seedEncryptedFile';
import { createTestSession } from '../utils/createTestSession';
import { injectSession } from '../utils/injectSession';
import {
  encryptionProfiles,
  encryptionStates,
  notes,
  sealNotes,
  sealNoteVersions,
  secretNotes,
  secretNoteVersions,
} from '../../src/db/schema';
import {
  decryptSealHead,
  decryptSealVersion,
  decryptSecretHead,
  decryptSecretVersion,
  mekFromPassphrase,
} from '../utils/vaultCrypto';

/**
 * The release-critical rotation scenarios.
 *
 * Every assertion here compares decrypted plaintext, file bytes or preserved
 * metadata. "The wizard said it finished" is exactly what a broken
 * re-encryption would also produce, so success text alone is never the check.
 *
 * These are serial by necessity, not by preference: each run revokes every
 * other session for its own account, and each holds a rotation fence for the
 * whole operation.
 */

/**
 * Serial, and generously timed. A run derives the current device share and the
 * new one at 600,000 PBKDF2 iterations each, then re-encrypts and reads back
 * every item — none of which the default per-test budget was sized for.
 */
test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

async function mixedVault(page: import('@playwright/test').Page) {
  const rotationPage = new RotationPage(page);
  // No navigation yet: seeding must finish before the wizard freezes an
  // inventory, and a page loaded first would snapshot an empty list.
  const { address, mekBytes } = await rotationPage.signInWithProfile({ navigate: false });
  const userId = await getOrCreateUserId(address);

  const [secret] = await seedSecrets(address, mekBytes, [{ title: 'Bank', content: 'account 1234' }]);
  const [archivedSecret] = await seedSecrets(address, mekBytes, [
    { title: 'Old', content: 'archived body', archived: true },
  ]);
  const [seal] = await seedSeals(address, mekBytes, [{ title: 'Will', content: 'sealed body' }]);
  await seedSecretVersions(secret.id, mekBytes, [
    { title: 'Bank', content: 'account 1111' },
    { title: 'Bank', content: 'account 2222' },
  ]);
  await seedSealVersions(seal.id, mekBytes, [
    { title: 'Will', content: 'sealed v1' },
    { title: 'Will', content: 'sealed v2' },
  ]);
  const [plainNote] = await seedNotes(address, [{ title: 'Groceries', content: 'milk' }]);
  await seedOtpRecords(address, mekBytes, [{ issuer: 'Example', account: 'alice@example.com' }]);

  await page.goto('/');
  const file = await seedEncryptedFile(page.request, mekBytes, { bytes: 4096, filename: 'report.pdf' });

  return { rotationPage, address, userId, mekBytes, secret, archivedSecret, seal, plainNote, file };
}

test('first opens after rotation use fresh ciphertext even with slow list responses', async ({ page }) => {
  page.setDefaultTimeout(15_000);
  const vault = await mixedVault(page);
  const secretsPage = new SecretsPage(page);
  const nav = (path: string) => page.locator(`a[href="${path}"]:visible`).first().click();

  // Warm both in-memory lists and the persister, using client navigation so
  // they survive into the wizard (page.goto would hide this regression).
  await nav('/secrets');
  await expect(secretsPage.secretCard('Bank')).toBeVisible();
  await secretsPage.unlock(RotationPage.PASSPHRASE);
  await nav('/seals');
  await expect(page.getByTestId('secret-card').filter({ hasText: 'Will' })).toBeVisible();
  await nav('/profile');
  await page.getByTestId('profile-rotate-keys').click();
  await vault.rotationPage.runUntilActivation();
  await vault.rotationPage.activate();
  await expect(page.getByTestId('unlock-button')).toHaveAttribute('aria-pressed', 'false');

  // Old cache data must not be rendered during a slow revalidation.
  await page.route('**/api/trpc/**', async (route) => {
    const url = route.request().url();
    if (url.includes('secrets.list') || url.includes('seals.list')) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    await route.continue();
  });
  await page.getByTestId('rotation-finish').click();
  await secretsPage.unlock(RotationPage.NEW_PASSPHRASE);
  await secretsPage.secretCard('Bank').click();
  await expect(page.getByTestId('tiptap-editor')).toContainText('account 1234');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await nav('/seals');
  await page.getByTestId('secret-card').filter({ hasText: 'Will' }).click();
  await page.getByTestId('decrypt-btn').click();
  await expect(page.getByTestId('tiptap-editor')).toContainText('sealed body');
  await expect(page.getByText('Failed to decrypt. The note may be corrupted.')).not.toBeVisible();
});

test.describe('full rotation on a mixed vault', () => {
  test('re-encrypts everything, preserves plaintext and metadata, and blocks the old key', async ({ page }) => {
    const vault = await mixedVault(page);
    const before = {
      secret: await testDb().select().from(secretNotes).where(eq(secretNotes.id, vault.secret.id)),
      seal: await testDb().select().from(sealNotes).where(eq(sealNotes.id, vault.seal.id)),
      versions: await testDb().select().from(secretNoteVersions).where(eq(secretNoteVersions.noteId, vault.secret.id)),
    };

    await vault.rotationPage.goto();
    await vault.rotationPage.runUntilActivation();
    await vault.rotationPage.activate();

    // ── The new key opens everything, with the same plaintext ──────────────
    const newMek = await mekFromPassphrase(vault.userId, RotationPage.NEW_PASSPHRASE);
    expect(await decryptSecretHead(vault.secret.id, newMek)).toBe('account 1234');
    expect(await decryptSecretHead(vault.archivedSecret.id, newMek)).toBe('archived body');
    expect(await decryptSealHead(vault.seal.id, newMek)).toBe('sealed body');

    const secretVersions = await testDb()
      .select()
      .from(secretNoteVersions)
      .where(eq(secretNoteVersions.noteId, vault.secret.id))
      .orderBy(secretNoteVersions.seq);
    expect(await Promise.all(secretVersions.map((row) => decryptSecretVersion(row.id, newMek)))).toEqual([
      'account 1111',
      'account 2222',
    ]);

    const sealVersions = await testDb()
      .select()
      .from(sealNoteVersions)
      .where(eq(sealNoteVersions.noteId, vault.seal.id))
      .orderBy(sealNoteVersions.seq);
    expect(await Promise.all(sealVersions.map((row) => decryptSealVersion(vault.seal.id, row.id, newMek)))).toEqual([
      'sealed v1',
      'sealed v2',
    ]);

    // ── The old key opens nothing it produced ──────────────────────────────
    const oldMek = vault.mekBytes;
    await expect(decryptSecretHead(vault.secret.id, oldMek)).rejects.toThrow();
    await expect(decryptSealHead(vault.seal.id, oldMek)).rejects.toThrow();

    // ── Identity, ordering and metadata survive ───────────────────────────
    const [secretAfter] = await testDb().select().from(secretNotes).where(eq(secretNotes.id, vault.secret.id));
    expect(secretAfter.id).toBe(before.secret[0].id);
    expect(secretAfter.title).toBe(before.secret[0].title);
    expect(secretAfter.position).toBe(before.secret[0].position);
    // updatedAt drives the search sort and the "edited" label; rotation is not
    // an edit, so it must not move.
    expect(secretAfter.updatedAt.getTime()).toBe(before.secret[0].updatedAt.getTime());
    expect(secretVersions.map((row) => row.seq)).toEqual(before.versions.map((row) => row.seq));
    expect(secretVersions).toHaveLength(before.versions.length);

    // ── Plaintext Notes are untouched ─────────────────────────────────────
    const [noteAfter] = await testDb().select().from(notes).where(eq(notes.id, vault.plainNote.id));
    expect(noteAfter.content).toContain('milk');

    // ── The encrypted attachment keeps its id and its exact bytes ─────────
    const rotatedBytes = await decryptStoredFile(page.request, vault.file.fileId, newMek, 1);
    expect(Buffer.from(rotatedBytes)).toEqual(Buffer.from(vault.file.plaintext));

    // ── And a client still claiming the old generation is refused ─────────
    const stale = await page.request.get(`/api/files/${vault.file.fileId}`, {
      headers: { 'x-signote-encryption-generation': '0' },
    });
    expect(stale.status()).toBe(409);

    // ── The account moved to the next generation ──────────────────────────
    const [state] = await testDb().select().from(encryptionStates).where(eq(encryptionStates.userId, vault.userId));
    expect(state.generation).toBe(1);
    expect(state.activeRotationId).toBeNull();
  });

  test('keeping the same passphrase still replaces every key', async ({ page }) => {
    const vault = await mixedVault(page);
    const [profileBefore] = await testDb()
      .select()
      .from(encryptionProfiles)
      .where(eq(encryptionProfiles.userId, vault.userId));
    const [sealBefore] = await testDb().select().from(sealNotes).where(eq(sealNotes.id, vault.seal.id));

    await vault.rotationPage.goto();
    await vault.rotationPage.runUntilActivation(RotationPage.PASSPHRASE, RotationPage.PASSPHRASE);
    await vault.rotationPage.activate();

    const [profileAfter] = await testDb()
      .select()
      .from(encryptionProfiles)
      .where(eq(encryptionProfiles.userId, vault.userId));
    const [sealAfter] = await testDb().select().from(sealNotes).where(eq(sealNotes.id, vault.seal.id));

    // A fresh salt is what makes the device share differ even for an unchanged
    // passphrase, so every stored half changes.
    expect(profileAfter.salt).not.toBe(profileBefore.salt);
    expect(profileAfter.serverShare).not.toBe(profileBefore.serverShare);
    expect(profileAfter.keyCheck.ciphertext).not.toBe(profileBefore.keyCheck.ciphertext);
    // The profile id is deliberately stable: the account was not reset.
    expect(profileAfter.id).toBe(profileBefore.id);
    expect(sealAfter.wrappedNoteKey?.ciphertext).not.toBe(sealBefore.wrappedNoteKey?.ciphertext);

    const sameMek = await mekFromPassphrase(vault.userId, RotationPage.PASSPHRASE);
    expect(await decryptSealHead(vault.seal.id, sameMek)).toBe('sealed body');
    await expect(decryptSealHead(vault.seal.id, vault.mekBytes)).rejects.toThrow();
  });

  test('a different passphrase makes the old one stop working', async ({ page }) => {
    const vault = await mixedVault(page);

    await vault.rotationPage.goto();
    await vault.rotationPage.runUntilActivation();
    await vault.rotationPage.activate();

    await expect(mekFromPassphrase(vault.userId, RotationPage.PASSPHRASE)).rejects.toThrow();
    await expect(mekFromPassphrase(vault.userId, RotationPage.NEW_PASSPHRASE)).resolves.toBeTruthy();
  });
});

test.describe('prerequisites', () => {
  test('cannot continue past the sessions step without revoking', async ({ page }) => {
    const vault = await mixedVault(page);
    await vault.rotationPage.goto();
    await vault.rotationPage.startFromIntro();

    await expect(page.getByTestId('rotation-next')).toBeDisabled();

    await vault.rotationPage.revokeOtherSessions();
    await expect(page.getByTestId('rotation-next')).toBeEnabled();
  });

  test('cannot continue past the drafts step without the acknowledgement', async ({ page }) => {
    const vault = await mixedVault(page);
    await vault.rotationPage.goto();
    await vault.rotationPage.startFromIntro();
    await vault.rotationPage.revokeOtherSessions();
    await vault.rotationPage.continueStep();
    await vault.rotationPage.expectStep('drafts');

    await page.getByTestId('rotation-rescan-drafts').click();
    await expect(page.getByTestId('rotation-next')).toBeDisabled();

    await page.getByTestId('rotation-ack-other-devices').check();
    await expect(page.getByTestId('rotation-next')).toBeEnabled();
  });

  test('an unsaved encrypted draft blocks the drafts step until it is resolved', async ({ page }) => {
    const vault = await mixedVault(page);
    await vault.rotationPage.goto();
    await page.evaluate(() => {
      localStorage.setItem(
        'sn_draft:pending-e2e',
        JSON.stringify({
          type: 'secret',
          title: 'Half-written',
          enc: { alg: 'A256GCM', iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA==' },
          savedAt: Date.now(),
          draftId: 'pending-e2e',
        }),
      );
    });

    await vault.rotationPage.startFromIntro();
    await vault.rotationPage.revokeOtherSessions();
    await vault.rotationPage.continueStep();
    await vault.rotationPage.expectStep('drafts');
    await page.getByTestId('rotation-rescan-drafts').click();
    await page.getByTestId('rotation-ack-other-devices').check();

    await expect(page.getByTestId('rotation-draft-list')).toContainText('Half-written');
    await expect(page.getByTestId('rotation-next')).toBeDisabled();

    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByTestId('rotation-next')).toBeEnabled();
  });

  test('a wrong current passphrase does not start a rotation', async ({ page }) => {
    const vault = await mixedVault(page);
    await vault.rotationPage.goto();
    await vault.rotationPage.startFromIntro();
    await vault.rotationPage.revokeOtherSessions();
    await vault.rotationPage.continueStep();
    await vault.rotationPage.acknowledgeDrafts();
    await vault.rotationPage.continueStep();
    await vault.rotationPage.expectStep('credentials');

    await vault.rotationPage.enterPassphrases('not the passphrase at all', RotationPage.NEW_PASSPHRASE);

    await expect(page.getByTestId('rotation-error')).toContainText('Incorrect passphrase', { timeout: 60_000 });
    await vault.rotationPage.expectStep('credentials');
    const [state] = await testDb().select().from(encryptionStates).where(eq(encryptionStates.userId, vault.userId));
    expect(state.activeRotationId).toBeNull();
    expect(state.generation).toBe(0);
  });
});

test.describe('cancellation', () => {
  test('cancelling at the last pre-commit moment leaves every old value readable', async ({ page }) => {
    const vault = await mixedVault(page);
    await vault.rotationPage.goto();
    // Everything staged, verified, and the recovery file confirmed — the last
    // moment at which cancelling is still completely lossless.
    await vault.rotationPage.runUntilActivation();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await vault.rotationPage.expectStep('intro', 30_000);

    // The old passphrase still works, the old data is still there, and the new
    // passphrase opens nothing.
    expect(await decryptSecretHead(vault.secret.id, vault.mekBytes)).toBe('account 1234');
    expect(await decryptSealHead(vault.seal.id, vault.mekBytes)).toBe('sealed body');
    await expect(mekFromPassphrase(vault.userId, RotationPage.NEW_PASSPHRASE)).rejects.toThrow();
    await expect(mekFromPassphrase(vault.userId, RotationPage.PASSPHRASE)).resolves.toBeTruthy();

    const [state] = await testDb().select().from(encryptionStates).where(eq(encryptionStates.userId, vault.userId));
    expect(state.generation).toBe(0);
    expect(state.activeRotationId).toBeNull();
  });

  test('revoked sessions stay revoked after a cancellation', async ({ page, browser }) => {
    const vault = await mixedVault(page);

    // A second browser context signed into the same account, as a second device
    // would be. Its session is what the sessions step revokes.
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    const otherRotation = new RotationPage(otherPage);
    await injectSession(otherPage, await createTestSession(vault.address));
    await otherPage.goto('/secrets');
    await expect(otherPage.getByTestId('sign-in-button').first()).toBeHidden();

    await vault.rotationPage.goto();
    await vault.rotationPage.startFromIntro();
    await vault.rotationPage.revokeOtherSessions();
    await vault.rotationPage.continueStep();
    await vault.rotationPage.acknowledgeDrafts();
    await vault.rotationPage.continueStep();
    await vault.rotationPage.expectStep('credentials');
    await page.goto('/secrets');

    // Revocation is deliberately irreversible, even though no rotation ran.
    const refused = await otherPage.request.get('/api/trpc/me');
    expect(refused.status()).toBe(401);
    expect(otherRotation).toBeTruthy();
    await other.close();
  });
});
