import { test, expect } from '@playwright/test';
import { eq } from 'drizzle-orm';

import { AuthenticatorPage } from '../pages/AuthenticatorPage';
import { RotationPage } from '../pages/RotationPage';
import { testDb } from '../fixtures/db';
import { getOrCreateUserId } from '../fixtures/getOrCreateUserId';
import { seedSecrets } from '../fixtures/seedSecrets';
import { seedOtpRecords } from '../fixtures/seedOtpRecords';
import { createTestSession } from '../utils/createTestSession';
import { injectSession } from '../utils/injectSession';
import { encryptionRotations, encryptionStates } from '../../src/db/schema';
import { decryptSecretHead } from '../utils/vaultCrypto';

/**
 * What else is allowed to happen while a rotation is running, and what happens
 * to everyone who was not the one running it.
 *
 * The client-side freeze is a courtesy; the server fence is the boundary. So
 * every assertion here goes through the API rather than the UI: a write that
 * the wizard's own tab would never attempt still has to be refused.
 */

test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

const GENERATION_HEADER = 'x-signote-encryption-generation';

async function vaultWithOperation(page: import('@playwright/test').Page) {
  const rotationPage = new RotationPage(page);
  const { address, mekBytes } = await rotationPage.signInWithProfile({ navigate: false });
  const userId = await getOrCreateUserId(address);
  const [secret] = await seedSecrets(address, mekBytes, [{ title: 'Bank', content: 'account 1234' }]);
  await seedOtpRecords(address, mekBytes, [{ issuer: 'Example', account: 'alice@example.com' }]);

  await rotationPage.goto();
  await rotationPage.startFromIntro();
  await rotationPage.revokeOtherSessions();
  await rotationPage.continueStep();
  await rotationPage.acknowledgeDrafts();
  await rotationPage.continueStep();
  await rotationPage.expectStep('credentials');
  await rotationPage.enterPassphrases(RotationPage.PASSPHRASE, RotationPage.NEW_PASSPHRASE);
  await rotationPage.expectStep('confirm', 90_000);
  await rotationPage.begin();

  return { rotationPage, address, userId, mekBytes, secret };
}

/** A tRPC mutation sent straight at the API, bypassing the UI's own guards. */
const mutate = (
  page: import('@playwright/test').Page,
  procedure: string,
  input: unknown,
  generation: number | null = 0,
) =>
  page.request.post(`/api/trpc/${procedure}`, {
    headers: generation === null ? {} : { [GENERATION_HEADER]: String(generation) },
    data: input,
    failOnStatusCode: false,
  });

test.describe('while an operation is in flight', () => {
  test('ordinary writes to the encrypted tiers are refused', async ({ page }) => {
    const vault = await vaultWithOperation(page);

    const response = await mutate(page, 'secrets.create', {
      title: 'Written mid-rotation',
      encryptedBody: { alg: 'A256GCM', iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA==' },
    });

    expect(response.status()).toBe(409);
    expect(await response.text()).toContain('ROTATION_IN_PROGRESS');
    // And the frozen source row is untouched.
    expect(await decryptSecretHead(vault.secret.id, vault.mekBytes)).toBe('account 1234');
  });

  test('a second rotation cannot be started alongside the first', async ({ page }) => {
    const vault = await vaultWithOperation(page);

    const response = await mutate(page, 'rotation.begin', {
      operationId: '00000000-0000-7000-8000-0000000000ff',
      sourceGeneration: 0,
      profileId: 'whatever',
      material: {
        version: 1,
        salt: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        serverShare: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000, length: 32 },
        keyCheck: { alg: 'A256GCM', iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA==' },
      },
      protocolVersion: 1,
      acknowledgements: { localDraftsResolved: true, otherDeviceDraftLoss: true },
    });

    expect(response.status()).toBeGreaterThanOrEqual(400);
    const operations = await testDb()
      .select()
      .from(encryptionRotations)
      .where(eq(encryptionRotations.userId, vault.userId));
    expect(operations).toHaveLength(1);
  });

  test('a new sign-in invalidates the session prerequisite until it is repeated', async ({ page, browser }) => {
    const vault = await vaultWithOperation(page);

    // A second device signs in. It cannot mutate the frozen vault, but its
    // arrival does clear the server's record of which session owns the
    // rotation — which is what the wizard has to notice.
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await injectSession(otherPage, await createTestSession(vault.address));
    await otherPage.goto('/secrets');

    const [state] = await testDb().select().from(encryptionStates).where(eq(encryptionStates.userId, vault.userId));
    expect(state.rotationSessionSid).toBeNull();

    // The worker's next call is refused, and the wizard says what to do.
    await page.getByTestId('rotation-process').click();
    await expect(page.getByTestId('rotation-error')).toContainText('Revoke other sessions again', {
      timeout: 120_000,
    });

    // Nothing was activated.
    const [after] = await testDb().select().from(encryptionStates).where(eq(encryptionStates.userId, vault.userId));
    expect(after.generation).toBe(0);
    expect(await decryptSecretHead(vault.secret.id, vault.mekBytes)).toBe('account 1234');
    await other.close();
  });
});

test.describe('after activation', () => {
  test('a tab still claiming the old generation is rejected on read and on write', async ({ page }) => {
    const vault = await vaultWithOperation(page);
    await vault.rotationPage.processAll();
    await vault.rotationPage.saveAndConfirmRecoveryFile();
    await vault.rotationPage.expectStep('commit', 60_000);
    await vault.rotationPage.activate();

    const staleRead = await page.request.get('/api/trpc/secrets.list?input=%7B%7D', {
      headers: { [GENERATION_HEADER]: '0' },
      failOnStatusCode: false,
    });
    expect(staleRead.status()).toBe(409);

    const staleWrite = await mutate(
      page,
      'secrets.create',
      {
        title: 'Written by a stale tab',
        encryptedBody: { alg: 'A256GCM', iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA==' },
      },
      0,
    );
    expect(staleWrite.status()).toBe(409);
    expect(await staleWrite.text()).toContain('GENERATION_MISMATCH');

    // A legacy client sending no generation at all fails the same way, rather
    // than being treated as generation zero.
    const legacy = await page.request.get('/api/trpc/secrets.list?input=%7B%7D', { failOnStatusCode: false });
    expect(legacy.status()).toBe(409);

    // And the same request naming the new generation is served.
    const current = await page.request.get('/api/trpc/secrets.list?input=%7B%7D', {
      headers: { [GENERATION_HEADER]: '1' },
      failOnStatusCode: false,
    });
    expect(current.status()).toBe(200);
  });

  test('the Authenticator on this device returns to not-enrolled', async ({ page }) => {
    // Set the account up first, enrol the Authenticator against the *old*
    // generation, and only then rotate — the order is the whole point.
    const rotationPage = new RotationPage(page);
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await rotationPage.signInWithProfile({ navigate: false });
    const userId = await getOrCreateUserId(address);
    await seedOtpRecords(address, mekBytes, [{ issuer: 'Example', account: 'alice@example.com' }]);

    await page.goto('/auth');
    await authPage.enroll();
    await expect(authPage.card('Example')).toBeVisible();

    await rotationPage.goto();
    await rotationPage.startFromIntro();
    await rotationPage.revokeOtherSessions();
    await rotationPage.continueStep();
    await rotationPage.acknowledgeDrafts();
    await rotationPage.continueStep();
    await rotationPage.expectStep('credentials');
    await rotationPage.enterPassphrases(RotationPage.PASSPHRASE, RotationPage.NEW_PASSPHRASE);
    await rotationPage.expectStep('confirm', 90_000);
    await rotationPage.begin();
    await rotationPage.processAll();
    await rotationPage.saveAndConfirmRecoveryFile();
    await rotationPage.expectStep('commit', 60_000);
    await rotationPage.activate();

    // The vault key this device held was derived from the old MEK. What must be
    // on screen is the trust prompt — not a list of codes it can no longer
    // generate, and not a silently empty page.
    await page.goto('/auth');
    await expect(page.getByRole('heading', { name: /Set up the authenticator/i })).toBeVisible({ timeout: 30_000 });
    await expect(authPage.cards).toHaveCount(0);

    // Re-enrolling under the new passphrase brings the same record back, which
    // is the proof that the seed itself survived the rotation.
    await authPage.enroll(true, RotationPage.NEW_PASSPHRASE);
    await expect(authPage.card('Example')).toBeVisible();

    const [state] = await testDb().select().from(encryptionStates).where(eq(encryptionStates.userId, userId));
    expect(state.generation).toBe(1);
  });
});
