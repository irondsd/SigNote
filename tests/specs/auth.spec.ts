import { test, expect } from '@playwright/test';

import { AuthenticatorPage } from '../pages/AuthenticatorPage';
import { seedOtpRecords, TEST_SEED } from '../fixtures/seedOtpRecords';
import { trpcGet, trpcMutationOf } from '../utils/trpc';

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

    await page.getByRole('button', { name: 'Reveal the setup link' }).click();
    await expect(page.getByTestId('auth-export-uri')).toContainText('otpauth://totp/');
    await expect(page.getByTestId('auth-export-uri')).toContainText('JBSWY3DPEHPK3PXP');
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
