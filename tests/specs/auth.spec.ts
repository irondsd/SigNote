import { test, expect } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { AuthenticatorPage } from '../pages/AuthenticatorPage';
import { seedOtpRecords, TEST_SEED } from '../fixtures/seedOtpRecords';
import { trpcData, trpcGet, trpcMutate, trpcMutationOf, trpcQuery } from '../utils/trpc';
import { setSecurityPreference } from '../utils/securityPreference';
import { seedSecrets } from '../fixtures/seedSecrets';
import { makeAccount } from '../utils/makeAccount';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';
import { getOrCreateUserId } from '../fixtures/getOrCreateUserId';
import { testDb } from '../fixtures/db';
import { encryptionProfiles } from '../../src/db/schema';

test.describe.configure({ mode: 'parallel' });

type WireRecord = { id: string; payload: unknown; archived: boolean; deletedAt: string | null };

const listRecords = async (page: import('@playwright/test').Page): Promise<WireRecord[]> => {
  const res = await trpcGet(page.request, 'otp.list');
  return ((await res.json()) as { records: WireRecord[] }).records;
};

test.describe('authenticator', () => {
  test.use({ viewport: { width: 1200, height: 900 } });

  // ─── Enrollment ────────────────────────────────────────────────────────────

  test('a new device must be enrolled before it shows codes', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [{ issuer: 'Alpha' }]);
    await page.reload();

    // Seeded rows exist server-side, but nothing renders until the device holds
    // a key: the server cannot decrypt them and neither can an unenrolled page.
    await expect(page.getByRole('heading', { name: /Set up the authenticator/i })).toBeVisible();
    await expect(authPage.cards).toHaveCount(0);

    await authPage.enroll();
    await expect(authPage.card('Alpha')).toBeVisible();
  });

  test('trusting the device survives a reload without asking again', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [{ issuer: 'Alpha' }]);
    await page.reload();
    await authPage.enroll(true);

    await page.reload();
    await expect(authPage.card('Alpha')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Set up the authenticator/i })).toBeHidden();
    await expect(page.getByPlaceholder('Your passphrase')).toBeHidden();
  });

  test('declining to trust keeps codes for the visit and warns', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [{ issuer: 'Alpha' }]);
    await page.reload();
    await authPage.enroll(false);

    await expect(authPage.card('Alpha')).toBeVisible();
    await expect(page.getByText(/not trusted/i)).toBeVisible();

    // Nothing was written to the vault store, so a reload starts over.
    await page.reload();
    await expect(page.getByRole('heading', { name: /Set up the authenticator/i })).toBeVisible();
  });

  test('enrollment leaves Secrets softly locked while remembering the passphrase', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [{ issuer: 'Alpha' }]);
    await seedSecrets(address, mekBytes, [{ title: 'Still locked', content: 'Available after soft unlock' }]);
    await page.reload();
    await authPage.enroll();

    // Reloading must preserve the explicit soft lock. The authenticator vault
    // remains available through its own key, but the MEK is not reconstructed
    // until a guarded Secrets interaction asks for it.
    await page.reload();
    await expect(authPage.card('Alpha')).toBeVisible();

    await page.goto('/secrets');
    const card = page.getByTestId('secret-card').filter({ hasText: 'Still locked' });
    await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible();
    await expect(card.getByTestId('encrypted-placeholder')).toBeVisible();

    // The retained device share gives ordinary soft-lock behavior: clicking a
    // card silently reconstructs the MEK instead of asking again.
    await card.click();
    await expect(page.getByTestId('tiptap-editor').getByText('Available after soft unlock')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByPlaceholder('Your passphrase')).toBeHidden();
  });

  // ─── Codes ────────────────────────────────────────────────────────────────

  test('renders a six digit code and a countdown', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [{ issuer: 'Alpha', secret: TEST_SEED }]);
    await page.reload();
    await authPage.enroll();

    const code = authPage.card('Alpha').getByTestId('auth-code');
    await expect(code).toHaveText(/^\d{3}\s*\d{3}$/, { timeout: 10000 });
    await expect(page.getByTestId('auth-clock')).toHaveText(/refresh in \d+s/);
  });

  test('an 8 digit credential renders eight digits', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [{ issuer: 'Alpha', digits: 8 }]);
    await page.reload();
    await authPage.enroll();

    await expect(authPage.card('Alpha').getByTestId('auth-code')).toHaveText(/^\d{4}\s*\d{4}$/, { timeout: 10000 });
  });

  test('clicking a card copies the code and shows the standard toast', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [{ issuer: 'Alpha' }]);
    await page.reload();
    await authPage.enroll();

    const code = authPage.card('Alpha').getByTestId('auth-code');
    await expect(code).toHaveText(/\d{3}/, { timeout: 10000 });
    const shown = (await code.textContent())!.replace(/\s+/g, '');

    await authPage.card('Alpha').click();

    // The app-wide toast, not a per-card badge.
    await expect(page.getByText('Copied to clipboard')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shown);
  });

  // ─── Adding ───────────────────────────────────────────────────────────────

  test('adds a credential from a pasted otpauth link', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [{ issuer: 'Existing' }]);
    await page.reload();
    await authPage.enroll();

    await page.getByTestId('auth-new').click();
    await page.getByRole('tab', { name: 'Paste link' }).click();
    await page
      .getByLabel('Setup link')
      .fill('otpauth://totp/GitHub:octocat@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub');

    const done = page.waitForResponse(trpcMutationOf('otp.create'));
    await page.getByRole('button', { name: 'Add credential' }).click();
    await done;

    await expect(authPage.card('GitHub')).toBeVisible();
    await expect(authPage.card('GitHub')).toContainText('octocat@example.com');
  });

  test('adds a credential typed in by hand', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [{ issuer: 'Existing' }]);
    await page.reload();
    await authPage.enroll();

    await page.getByTestId('auth-new').click();
    await page.getByRole('tab', { name: 'By hand' }).click();
    await page.getByLabel('Service').fill('Fastmail');
    await page.getByLabel('Account').fill('me@fastmail.com');
    // Spaced and lowercase, as a real setup screen prints it.
    await page.getByLabel('Setup key').fill('jbsw y3dp ehpk 3pxp');

    const done = page.waitForResponse(trpcMutationOf('otp.create'));
    await page.getByRole('button', { name: 'Add credential' }).click();
    await done;

    await expect(authPage.card('Fastmail')).toBeVisible();
  });

  test('rejects a malformed link without leaking it into the message', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [{ issuer: 'Existing' }]);
    await page.reload();
    await authPage.enroll();

    await page.getByTestId('auth-new').click();
    await page.getByRole('tab', { name: 'Paste link' }).click();
    await page.getByLabel('Setup link').fill('otpauth://totp/Bank:me@example.com?secret=NOT!BASE32');
    await page.getByRole('button', { name: 'Add credential' }).click();

    const alert = page.getByTestId('auth-error');
    await expect(alert).toBeVisible();
    // Security invariant: an error must never carry the seed or the identity.
    await expect(alert).not.toContainText('NOT!BASE32');
    await expect(alert).not.toContainText('Bank');
    await expect(authPage.card('Bank')).toHaveCount(0);
  });

  test('refuses a duplicate credential', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [
      { issuer: 'GitHub', account: 'octocat@example.com', secret: 'JBSWY3DPEHPK3PXP' },
    ]);
    await page.reload();
    await authPage.enroll();

    await page.getByTestId('auth-new').click();
    await page.getByRole('tab', { name: 'Paste link' }).click();
    await page
      .getByLabel('Setup link')
      .fill('otpauth://totp/GitHub:octocat@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub');
    await page.getByRole('button', { name: 'Add credential' }).click();

    await expect(page.getByTestId('auth-error')).toContainText(/already have/i);
    await expect(authPage.cards).toHaveCount(1);
  });

  test('rejects a counter-based (HOTP) link with a specific reason', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [{ issuer: 'Existing' }]);
    await page.reload();
    await authPage.enroll();

    await page.getByTestId('auth-new').click();
    await page.getByRole('tab', { name: 'Paste link' }).click();
    await page.getByLabel('Setup link').fill('otpauth://hotp/A:b?secret=JBSWY3DPEHPK3PXP&counter=1');
    await page.getByRole('button', { name: 'Add credential' }).click();

    await expect(page.getByTestId('auth-error')).toContainText(/not supported yet/i);
  });

  // ─── Archive ──────────────────────────────────────────────────────────────

  test('archiving moves a card to the archive page, still generating codes', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [{ issuer: 'Alpha' }, { issuer: 'Bravo' }]);
    await page.reload();
    await authPage.enroll();

    await authPage.setArchived('Bravo', true);

    await expect(authPage.cards).toHaveCount(1);
    await expect.poll(() => authPage.order()).toEqual(['Alpha']);

    await page.goto('/auth/archive');
    await expect(authPage.card('Bravo')).toBeVisible();
    // Archived credentials stay live — the archive is a destination, not a freezer.
    await expect(authPage.card('Bravo').getByTestId('auth-code')).toHaveText(/^\d{3}\s*\d{3}$/, { timeout: 10000 });
  });

  test('restoring from the archive brings the card back', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [{ issuer: 'Alpha' }, { issuer: 'Bravo', archived: true }]);
    await page.reload();
    await authPage.enroll();

    await expect.poll(() => authPage.order()).toEqual(['Alpha']);

    await page.goto('/auth/archive');
    await expect(authPage.card('Bravo')).toBeVisible();

    await authPage.setArchived('Bravo', false);

    await page.goto('/auth');
    await expect(authPage.card('Bravo')).toBeVisible();
  });

  // ─── Delete ───────────────────────────────────────────────────────────────

  test('deleting asks first, then tombstones the row', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    const seeded = await seedOtpRecords(address, mekBytes, [{ issuer: 'Alpha' }, { issuer: 'Bravo' }]);
    await page.reload();
    await authPage.enroll();

    await authPage.deleteCard('Bravo');

    await expect(authPage.cards).toHaveCount(1);

    // Soft delete: the row survives as a tombstone with no payload, so an
    // offline device learns the credential is gone rather than resurrecting it.
    const bravo = (await listRecords(page)).find((r) => r.id === seeded[1].id)!;
    expect(bravo.deletedAt).not.toBeNull();
    expect(bravo.payload).toBeNull();
  });

  // ─── Export ───────────────────────────────────────────────────────────────

  test('export hides the seed behind an explicit reveal', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [{ issuer: 'Alpha', secret: 'JBSWY3DPEHPK3PXP' }]);
    await page.reload();
    await authPage.enroll();

    await authPage.openExport('Alpha');

    await expect(page.getByText(/anyone who has it can generate your codes/i)).toBeVisible();
    await expect(page.getByTestId('auth-export-uri')).toHaveCount(0);

    await page.getByLabel('Encryption passphrase').fill(AuthenticatorPage.PASSPHRASE);
    await page.getByRole('button', { name: 'Reveal the setup link' }).click();
    await expect(page.getByTestId('auth-export-uri')).toContainText('otpauth://totp/');
    await expect(page.getByTestId('auth-export-uri')).toContainText('JBSWY3DPEHPK3PXP');
  });

  test('export refuses an incorrect passphrase without revealing the seed', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [{ issuer: 'Alpha', secret: 'JBSWY3DPEHPK3PXP' }]);
    await page.reload();
    await authPage.enroll();

    await authPage.openExport('Alpha');
    await page.getByLabel('Encryption passphrase').fill('definitely-wrong');
    await page.getByRole('button', { name: 'Reveal the setup link' }).click();

    await expect(page.getByText('Incorrect passphrase. Try again.')).toBeVisible();
    await expect(page.getByTestId('auth-export-uri')).toHaveCount(0);
  });

  // ─── Offline ──────────────────────────────────────────────────────────────

  test('offline keeps codes but disables writes', async ({ page, context }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [{ issuer: 'Alpha' }]);
    await page.reload();
    await authPage.enroll();
    await expect(authPage.card('Alpha').getByTestId('auth-code')).toHaveText(/\d{3}/, { timeout: 10000 });

    await context.setOffline(true);
    // The context listens for the browser's own offline event, so it does not
    // have to wait for a request to fail before disabling writes.
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));

    // Codes are local, so they keep running with no network at all.
    await expect(authPage.card('Alpha').getByTestId('auth-code')).toHaveText(/^\d{3}\s*\d{3}$/);

    // v1 queues nothing, so creating is disabled rather than failing later.
    await expect(page.getByTestId('auth-new')).toBeDisabled();
    await expect(page.getByText(/Offline\. Codes keep working/i)).toBeVisible();

    await context.setOffline(false);
  });

  test('session termination clears local codes and shows sign-in', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [{ issuer: 'Alpha' }]);
    await page.reload();
    await authPage.enroll();

    // Expire only this browser context. The app's visible sign-out control also
    // broadcasts to every same-origin tab, which would interfere with this
    // deliberately parallel spec file.
    await page.context().clearCookies();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));

    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(authPage.cards).toHaveCount(0);

    // The trusted key and encrypted record cache are gone too, rather than
    // merely hidden until the next reload.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(authPage.cards).toHaveCount(0);
  });

  test('remote session revocation signs the Auth page out and clears its codes', async ({ page, browser }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, AuthenticatorPage.PASSPHRASE);
    await seedOtpRecords(account.address, mekBytes, [{ issuer: 'Alpha' }]);

    // This page represents the device that will be revoked.
    const authPage = new AuthenticatorPage(page);
    await authPage.signInDirectly(account.address);
    await authPage.enroll();

    // A second device creates its own session and revokes the first one.
    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();
    await new AuthenticatorPage(otherPage).signInDirectly(account.address);
    await trpcQuery(otherPage.request, 'me');
    const listResponse = await trpcQuery(otherPage.request, 'sessions.list');
    const { sessions } = await trpcData<{ sessions: Array<{ _id: string; current: boolean }> }>(listResponse);
    const revoked = sessions.find((session) => !session.current);
    expect(revoked).toBeDefined();
    await trpcMutate(otherPage.request, 'sessions.revoke', { id: revoked!._id });
    await otherContext.close();

    // Focus synchronization receives the 401 and runs the shared graceful
    // sign-out path rather than leaving stale codes on screen.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByTestId('sign-in-button').first()).toBeVisible({ timeout: 10000 });
    await page.goto('/auth');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(authPage.cards).toHaveCount(0);
  });

  test('switching accounts never carries decrypted records into the next vault', async ({ page }) => {
    const accountA = makeAccount();
    const accountB = makeAccount();
    const { mekBytes: mekA } = await seedEncryptionProfile(accountA.account.address, AuthenticatorPage.PASSPHRASE);
    const { mekBytes: mekB } = await seedEncryptionProfile(accountB.account.address, AuthenticatorPage.PASSPHRASE);
    await seedOtpRecords(accountA.account.address, mekA, [{ issuer: 'Only Alpha' }]);
    await seedOtpRecords(accountB.account.address, mekB, [{ issuer: 'Only Bravo' }]);

    const authPage = new AuthenticatorPage(page);
    await authPage.signInDirectly(accountA.account.address);
    await authPage.enroll();
    await expect(authPage.card('Only Alpha')).toBeVisible();

    await page.context().clearCookies();
    await page.reload();
    await expect(page.getByTestId('sign-in-button').first()).toBeVisible();
    await authPage.signInDirectly(accountB.account.address);

    await expect(page.getByRole('heading', { name: /Set up the authenticator/i })).toBeVisible();
    await expect(authPage.card('Only Alpha')).toHaveCount(0);
    await authPage.enroll();
    await expect(authPage.card('Only Bravo')).toBeVisible();
    await expect(authPage.card('Only Alpha')).toHaveCount(0);
  });

  test('returning focus synchronizes records added elsewhere', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [{ issuer: 'Alpha' }]);
    await page.reload();
    await authPage.enroll();

    await seedOtpRecords(address, mekBytes, [{ issuer: 'Arrived remotely' }]);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));

    await expect(authPage.card('Arrived remotely')).toBeVisible({ timeout: 10000 });
  });

  test('a changed encryption profile generation invalidates the trusted device', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [{ issuer: 'Alpha' }]);
    await page.reload();
    await authPage.enroll();

    const userId = await getOrCreateUserId(address);
    await testDb().update(encryptionProfiles).set({ id: uuidv7() }).where(eq(encryptionProfiles.userId, userId));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));

    await expect(page.getByRole('heading', { name: /Set up the authenticator/i })).toBeVisible({ timeout: 10000 });
    await expect(authPage.cards).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: /Set up the authenticator/i })).toBeVisible();
  });

  test('a trusted device can be forgotten from Profile', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [{ issuer: 'Alpha' }]);
    await page.reload();
    await authPage.enroll();

    await page.goto('/profile');
    await expect(page.getByTestId('auth-device-section')).toBeVisible();
    await page.getByTestId('forget-auth-device-btn').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Forget device' }).click();
    await expect(page.getByTestId('auth-device-section')).toHaveCount(0);

    await page.goto('/auth');
    await expect(page.getByRole('heading', { name: /Set up the authenticator/i })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: /Set up the authenticator/i })).toBeVisible();
  });

  // ─── Privacy ──────────────────────────────────────────────────────────────

  test('the page is excluded from analytics autocapture', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [{ issuer: 'Alpha' }]);
    await page.reload();
    await authPage.enroll();

    // Autocapture sends the text of clicked elements; without this marker a tap
    // on a card would ship the code and the issuer to a third party.
    const guarded = await authPage.card('Alpha').evaluate((card) => !!card.closest('.ph-no-capture'));
    expect(guarded).toBe(true);
  });

  test('the server never receives a plaintext seed', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [{ issuer: 'Existing' }]);
    await page.reload();
    await authPage.enroll();

    const bodies: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/trpc/') && req.method() === 'POST') bodies.push(req.postData() ?? '');
    });

    await page.getByTestId('auth-new').click();
    await page.getByRole('tab', { name: 'Paste link' }).click();
    await page
      .getByLabel('Setup link')
      .fill('otpauth://totp/GitHub:octocat@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub');
    const done = page.waitForResponse(trpcMutationOf('otp.create'));
    await page.getByRole('button', { name: 'Add credential' }).click();
    await done;

    const sent = bodies.join('\n');
    expect(sent).not.toContain('JBSWY3DPEHPK3PXP');
    expect(sent).not.toContain('octocat@example.com');
    expect(sent).not.toContain('GitHub');

    // And the stored row is opaque too.
    const stored = JSON.stringify(await listRecords(page));
    expect(stored).not.toContain('JBSWY3DPEHPK3PXP');
    expect(stored).not.toContain('GitHub');
  });
});

// ─── Code blur preference ────────────────────────────────────────────────────

/**
 * The blur itself is a CSS rule scoped to `(hover: hover) and (pointer: fine)`,
 * which a headless run does not satisfy — so these assert the attribute the
 * rule keys off rather than a computed filter. What is worth pinning here is
 * that the preference reaches the card at all, and that it fails closed while
 * the preference is still in flight.
 */
test.describe('authenticator code blur', () => {
  test.use({ viewport: { width: 1200, height: 900 } });

  test('codes are blurred by default', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [{ issuer: 'Alpha' }]);
    await page.reload();
    await authPage.enroll(true);

    await expect(authPage.card('Alpha')).toHaveAttribute('data-blur', 'true');
  });

  test('turning the preference off unblurs them', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [{ issuer: 'Alpha' }]);
    await page.reload();
    await authPage.enroll(true);
    await expect(authPage.card('Alpha')).toHaveAttribute('data-blur', 'true');

    await page.goto('/profile');
    await setSecurityPreference(page, 'pref-blur-auth-codes', false);

    await page.goto('/auth');
    await expect(authPage.card('Alpha')).toBeVisible();
    await expect(authPage.card('Alpha')).not.toHaveAttribute('data-blur', /.*/);
  });
});
