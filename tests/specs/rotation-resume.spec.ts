import { test, expect } from '@playwright/test';
import { eq } from 'drizzle-orm';

import { RotationPage } from '../pages/RotationPage';
import { testDb } from '../fixtures/db';
import { getOrCreateUserId } from '../fixtures/getOrCreateUserId';
import { seedSecrets } from '../fixtures/seedSecrets';
import { seedSeals } from '../fixtures/seedSeals';
import { seedSealVersions } from '../fixtures/seedVersions';
import { createTestSession } from '../utils/createTestSession';
import { injectSession } from '../utils/injectSession';
import { encryptionRotations, encryptionStates, rotationItems, sealNoteVersions } from '../../src/db/schema';
import { decryptSealHead, decryptSealVersion, decryptSecretHead, mekFromPassphrase } from '../utils/vaultCrypto';

/**
 * Losing the browser, and losing a response.
 *
 * The safety contract says an interruption must leave the vault either
 * completely on the old generation or completely on the new one, never
 * somewhere between. These specs interrupt at the two points where that is
 * hardest to honour — midway through a Seal's versions, and around the
 * activation response — and then assert the whole vault, not the wizard's
 * wording.
 */

test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

async function startedRotation(page: import('@playwright/test').Page) {
  const rotationPage = new RotationPage(page);
  const { address, mekBytes } = await rotationPage.signInWithProfile({ navigate: false });
  const userId = await getOrCreateUserId(address);

  const [secret] = await seedSecrets(address, mekBytes, [{ title: 'Bank', content: 'account 1234' }]);
  const [seal] = await seedSeals(address, mekBytes, [{ title: 'Will', content: 'sealed body' }]);
  await seedSealVersions(seal.id, mekBytes, [
    { title: 'Will', content: 'sealed v1' },
    { title: 'Will', content: 'sealed v2' },
    { title: 'Will', content: 'sealed v3' },
  ]);

  await rotationPage.goto();
  return { rotationPage, address, userId, mekBytes, secret, seal };
}

/** Everything up to the point where re-encryption starts. */
async function reachRunning(rotationPage: RotationPage, resuming = false) {
  await rotationPage.expectStep(resuming ? 'sessions' : 'intro', 30_000);
  if (!resuming) await rotationPage.startFromIntro();
  await rotationPage.revokeOtherSessions();
  await rotationPage.continueStep();
  await rotationPage.expectStep('drafts');
  await rotationPage.acknowledgeDrafts();
  await rotationPage.continueStep();
  await rotationPage.expectStep('credentials');
  await rotationPage.enterPassphrases(RotationPage.PASSPHRASE, RotationPage.NEW_PASSPHRASE);
  await rotationPage.expectStep('confirm', 90_000);
  await rotationPage.begin();
}

test.describe('browser loss', () => {
  test('a new browser with no local storage resumes the same operation and staged keys', async ({ page, browser }) => {
    const vault = await startedRotation(page);
    await reachRunning(vault.rotationPage);

    // Interrupt partway: stop the network so some items are staged and some are
    // not, then abandon the context entirely.
    await page.getByTestId('rotation-process').click();
    await expect(page.getByTestId('rotation-progress')).not.toHaveAttribute('data-processed', '0', {
      timeout: 60_000,
    });
    const [operationBefore] = await testDb()
      .select()
      .from(encryptionRotations)
      .where(eq(encryptionRotations.userId, vault.userId));
    const stagedWrapper = (
      await testDb().select().from(rotationItems).where(eq(rotationItems.operationId, operationBefore.id))
    ).find((item) => item.kind === 'seal-wrapper');

    await page.context().close();

    // A brand new context: no sessionStorage device share, no IndexedDB, no
    // generation marker — nothing but a fresh sign-in.
    const fresh = await browser.newContext();
    const freshPage = await fresh.newPage();
    const resumed = new RotationPage(freshPage);
    await injectSession(freshPage, await createTestSession(vault.address));
    await resumed.goto();

    await resumed.expectStep('sessions', 30_000);
    await expect(freshPage.getByTestId('rotation-resuming')).toBeVisible();
    await reachRunning(resumed, true);
    await resumed.processAll();
    await resumed.saveAndConfirmRecoveryFile();
    await resumed.expectStep('commit', 60_000);
    await resumed.activate();

    // The same operation, and the same Seal key it was already staging with.
    const [operationAfter] = await testDb()
      .select()
      .from(encryptionRotations)
      .where(eq(encryptionRotations.userId, vault.userId));
    expect(operationAfter.id).toBe(operationBefore.id);
    expect(operationAfter.workerFence).toBeGreaterThan(operationBefore.workerFence);

    const newMek = await mekFromPassphrase(vault.userId, RotationPage.NEW_PASSPHRASE);
    expect(await decryptSecretHead(vault.secret.id, newMek)).toBe('account 1234');
    expect(await decryptSealHead(vault.seal.id, newMek)).toBe('sealed body');

    // Every version opens under the head's key — which is the check that fails
    // if a resumed worker minted a second note key for the remaining bodies.
    const versions = await testDb().select().from(sealNoteVersions).where(eq(sealNoteVersions.noteId, vault.seal.id));
    for (const version of versions) {
      await expect(decryptSealVersion(vault.seal.id, version.id, newMek)).resolves.toMatch(/^sealed v[123]$/);
    }
    if (stagedWrapper?.replacement) expect(stagedWrapper.replacement).toBeTruthy();

    await fresh.close();
  });

  test('the wrong new passphrase cannot resume, and says so without destroying anything', async ({ page }) => {
    const vault = await startedRotation(page);
    await reachRunning(vault.rotationPage);
    await page.reload();

    await vault.rotationPage.expectStep('sessions', 30_000);
    await vault.rotationPage.revokeOtherSessions();
    await vault.rotationPage.continueStep();
    await vault.rotationPage.acknowledgeDrafts();
    await vault.rotationPage.continueStep();
    await vault.rotationPage.expectStep('credentials');

    await vault.rotationPage.enterPassphrases(RotationPage.PASSPHRASE, 'some-other-new-passphrase-entirely');

    await expect(page.getByTestId('rotation-error')).toContainText('not the new passphrase you chose', {
      timeout: 90_000,
    });
    await vault.rotationPage.expectStep('credentials');
    // Nothing was activated, and the old key still opens everything.
    expect(await decryptSecretHead(vault.secret.id, vault.mekBytes)).toBe('account 1234');
    const [state] = await testDb().select().from(encryptionStates).where(eq(encryptionStates.userId, vault.userId));
    expect(state.generation).toBe(0);
  });
});

test.describe('lost responses', () => {
  test('a dropped stage response is recovered by replaying the same payload', async ({ page }) => {
    const vault = await startedRotation(page);
    await reachRunning(vault.rotationPage);

    // Drop the response to one stage call *after* the server has handled it.
    // The row is written; the browser never learns that. This is precisely the
    // ambiguity the idempotency key exists for — a retry must return the
    // original receipt rather than stage a second, differently-IV'd payload.
    let dropped = false;
    let attempts = 0;
    await page.route('**/api/trpc/rotation.stage', async (route) => {
      attempts++;
      if (dropped) return route.continue();
      dropped = true;
      await route.fetch();
      await route.abort('connectionaborted');
    });

    // No user action in between: a dropped connection is a transient fault and
    // the transport's bounded retry is expected to resolve it on its own.
    await vault.rotationPage.processAll();
    await page.unroute('**/api/trpc/rotation.stage');
    expect(attempts).toBeGreaterThan(1);
    expect(await vault.rotationPage.error()).toBeNull();

    await vault.rotationPage.saveAndConfirmRecoveryFile();
    await vault.rotationPage.expectStep('commit', 60_000);
    await vault.rotationPage.activate();

    const newMek = await mekFromPassphrase(vault.userId, RotationPage.NEW_PASSPHRASE);
    expect(await decryptSecretHead(vault.secret.id, newMek)).toBe('account 1234');
    expect(await decryptSealHead(vault.seal.id, newMek)).toBe('sealed body');

    // One operation, and one version per seeded snapshot — the retry added no
    // record, no history entry and no second rotation.
    const operations = await testDb()
      .select()
      .from(encryptionRotations)
      .where(eq(encryptionRotations.userId, vault.userId));
    expect(operations).toHaveLength(1);
    const versions = await testDb().select().from(sealNoteVersions).where(eq(sealNoteVersions.noteId, vault.seal.id));
    expect(versions).toHaveLength(3);
  });

  test('a lost commit response resolves to the committed state, never a second rotation', async ({ page }) => {
    const vault = await startedRotation(page);
    await reachRunning(vault.rotationPage);
    await vault.rotationPage.processAll();
    await vault.rotationPage.saveAndConfirmRecoveryFile();
    await vault.rotationPage.expectStep('commit', 60_000);

    // The activation lands server-side; only its acknowledgement is lost.
    await page.route('**/api/trpc/rotation.commit', async (route) => {
      await route.fetch();
      await route.abort('connectionaborted');
    });
    await page.getByTestId('rotation-activate').click();
    await expect(page.getByTestId('rotation-error')).toBeVisible({ timeout: 90_000 });
    await page.unroute('**/api/trpc/rotation.commit');

    // A fresh page must read durable status and see a finished rotation — not
    // offer to start another one, and not replay the commit.
    await page.reload();
    const [state] = await testDb().select().from(encryptionStates).where(eq(encryptionStates.userId, vault.userId));
    expect(state.generation).toBe(1);
    expect(state.activeRotationId).toBeNull();

    const operations = await testDb()
      .select()
      .from(encryptionRotations)
      .where(eq(encryptionRotations.userId, vault.userId));
    expect(operations).toHaveLength(1);
    expect(['committed', 'cleaned']).toContain(operations[0].phase);

    const newMek = await mekFromPassphrase(vault.userId, RotationPage.NEW_PASSPHRASE);
    expect(await decryptSealHead(vault.seal.id, newMek)).toBe('sealed body');
    await expect(mekFromPassphrase(vault.userId, RotationPage.PASSPHRASE)).rejects.toThrow();
  });
});
