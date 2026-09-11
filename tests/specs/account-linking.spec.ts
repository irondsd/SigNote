import { test, expect, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import type { Address } from 'viem';
import { makeAccount } from '../utils/makeAccount';
import { createTestSession } from '../utils/createTestSession';
import { createGoogleTestSession } from '../utils/createGoogleTestSession';
import { injectSession } from '../utils/injectSession';
import { configureGoogleUser } from '../utils/googleAuth';
import { mockProvider } from '../utils/mockProvider';
import { getOrCreateUserId } from '../fixtures/getOrCreateUserId';
import { testDb } from '../fixtures/db';
import { authIdentities } from '../../src/db/schema';
import { addGoogleIdentityToUser } from '../fixtures/addIdentityToUser';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';
import { seedSecrets } from '../fixtures/seedSecrets';
import { seedSeals } from '../fixtures/seedSeals';

test.describe.configure({ mode: 'parallel' });

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Clicks the "Link Ethereum wallet" button and handles the RainbowKit modal
 * (same flow as signIn.ts). Returns after the wallet connects and signs.
 */
async function clickLinkSiwe(page: Page): Promise<void> {
  await page.getByTestId('connect-siwe').click();

  // Race: RainbowKit modal may appear (click Browser Wallet) or wallet auto-connects
  await Promise.any([
    page.waitForFunction(() => {
      const modal = document.querySelector('[aria-labelledby="rk_connect_title"]');
      const buttons = modal?.querySelectorAll('button');
      for (const btn of buttons || []) {
        if (btn.textContent?.includes('Browser Wallet')) {
          btn.scrollIntoView();
          btn.click();
          return true;
        }
      }
      return false;
    }),
    // If wallet auto-connects, just wait for the page to settle
    page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => null),
  ]);
}

// ─── SIWE primary → link Google ──────────────────────────────────────────────

test.describe('SIWE primary → link Google', () => {
  test('links Google account and shows success toast', async ({ page }) => {
    const { account } = makeAccount();
    const token = await createTestSession(account.address);
    await injectSession(page, token);

    await configureGoogleUser(page, {
      sub: 'google-link-primary-01',
      name: 'Test User',
      email: 'google-link-primary@example.com',
    });

    await page.goto('/profile');
    await expect(page.getByTestId('identity-siwe')).toBeVisible();
    await expect(page.getByTestId('connect-google')).toBeVisible();

    await page.getByTestId('connect-google').click();

    // Full OAuth redirect: initiate → mock /auth → callback → /profile?linked=google
    await page.waitForURL(/\/profile/, { timeout: 20000 });
    await expect(page.getByText('Google account linked successfully.').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('identity-siwe')).toBeVisible();
    await expect(page.getByTestId('identity-google')).toBeVisible();
  });
});

// ─── Google primary → link SIWE ──────────────────────────────────────────────

test.describe('Google primary → link SIWE', () => {
  test('links Ethereum wallet and shows success toast', async ({ page }) => {
    const token = await createGoogleTestSession('google-link-siwe-primary-01', 'google-primary@example.com');
    await injectSession(page, token);

    // Inject mock wallet provider before navigating to profile
    await mockProvider(page);
    await page.goto('/profile');

    await expect(page.getByTestId('identity-google')).toBeVisible();
    await expect(page.getByTestId('connect-siwe')).toBeVisible();

    await clickLinkSiwe(page);

    // On success, handleLinkSiwe calls window.location.reload()
    // Wait for the page to reload and both identities to appear
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    await expect(page.getByTestId('identity-google')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('identity-siwe')).toBeVisible({ timeout: 10000 });
  });
});

// ─── Conflict: wallet with encrypted data ────────────────────────────────────

test.describe('link wallet with encrypted data', () => {
  test('fails with conflict error when wallet has secrets', async ({ page }) => {
    // Inject Google user A session and mock provider, then navigate to profile.
    const googleToken = await createGoogleTestSession('google-conflict-secrets-01', 'conflict-secrets@example.com');
    await injectSession(page, googleToken);
    await mockProvider(page);
    await page.goto('/profile');

    await expect(page.getByTestId('identity-google')).toBeVisible();
    await expect(page.getByTestId('connect-siwe')).toBeVisible();

    // Get the browser wallet address (mock provider generates it on page load)
    const walletAddress = await page.evaluate(() =>
      (window as unknown as { ethereum: { getCurrentAddress: () => string } }).ethereum.getCurrentAddress(),
    );

    // Seed user B: SIWE user with that wallet address + secrets
    await getOrCreateUserId(walletAddress as Address);
    const { mekBytes } = await seedEncryptionProfile(walletAddress as Address, 'test-pass-secrets');
    await seedSecrets(walletAddress as Address, mekBytes, [{ title: 'Secret Note' }]);

    // Now click link — browser signs with the same wallet address
    await clickLinkSiwe(page);

    // Expect conflict error toast
    await expect(page.getByText('This wallet has encrypted data')).toBeVisible({ timeout: 15000 });

    // SIWE should still show as unlinked (Connect button visible)
    await expect(page.getByTestId('connect-siwe')).toBeVisible();
  });

  test('fails with conflict error when wallet has seals', async ({ page }) => {
    const googleToken = await createGoogleTestSession('google-conflict-seals-01', 'conflict-seals@example.com');
    await injectSession(page, googleToken);
    await mockProvider(page);
    await page.goto('/profile');

    await expect(page.getByTestId('connect-siwe')).toBeVisible();

    const walletAddress = await page.evaluate(() =>
      (window as unknown as { ethereum: { getCurrentAddress: () => string } }).ethereum.getCurrentAddress(),
    );

    // Seed user B with seals
    await getOrCreateUserId(walletAddress as Address);
    const { mekBytes } = await seedEncryptionProfile(walletAddress as Address, 'test-pass-seals');
    await seedSeals(walletAddress as Address, mekBytes, [{ title: 'Seal Note' }]);

    await clickLinkSiwe(page);

    await expect(page.getByText('This wallet has encrypted data')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('connect-siwe')).toBeVisible();
  });

  test('succeeds when wallet has only an encryption profile (no secrets or seals)', async ({ page }) => {
    const googleToken = await createGoogleTestSession('google-conflict-ep-only-01', 'conflict-ep-only@example.com');
    await injectSession(page, googleToken);
    await mockProvider(page);
    await page.goto('/profile');

    await expect(page.getByTestId('connect-siwe')).toBeVisible();

    const walletAddress = await page.evaluate(() =>
      (window as unknown as { ethereum: { getCurrentAddress: () => string } }).ethereum.getCurrentAddress(),
    );

    // Seed user B: encryption profile only, no secrets or seals
    await getOrCreateUserId(walletAddress as Address);
    await seedEncryptionProfile(walletAddress as Address, 'test-pass-ep-only');
    // No seedSecrets / seedSeals — user B has no encrypted notes

    await clickLinkSiwe(page);

    // Migration succeeds: user B is merged into user A
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    await expect(page.getByTestId('identity-google')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('identity-siwe')).toBeVisible({ timeout: 10000 });
  });
});

// ─── Already linked: no additional link buttons ───────────────────────────────

test.describe('already linked state', () => {
  test('shows no link buttons when both providers are already linked', async ({ page }) => {
    const { account } = makeAccount();
    const userId = await getOrCreateUserId(account.address);
    await addGoogleIdentityToUser(userId, 'google-already-linked-01', 'already-linked@example.com');

    const token = await createTestSession(account.address);
    await injectSession(page, token);
    await page.goto('/profile');

    await expect(page.getByTestId('identity-siwe')).toBeVisible();
    await expect(page.getByTestId('identity-google')).toBeVisible();

    // No link buttons: both providers are already connected
    await expect(page.getByTestId('connect-siwe')).not.toBeAttached();
    await expect(page.getByTestId('connect-google')).not.toBeAttached();
  });
});

// ─── Unlink ───────────────────────────────────────────────────────────────────

test.describe('unlink identity', () => {
  test('unlinks one identity and disables the remaining unlink button', async ({ page }) => {
    const { account } = makeAccount();
    const userId = await getOrCreateUserId(account.address);
    await addGoogleIdentityToUser(userId, 'google-unlink-test-01', 'unlink-test@example.com');

    const token = await createTestSession(account.address);
    await injectSession(page, token);
    await page.goto('/profile');

    // Both identities visible, both unlink buttons enabled
    await expect(page.getByTestId('identity-siwe')).toBeVisible();
    await expect(page.getByTestId('identity-google')).toBeVisible();
    await expect(page.getByTestId('unlink-google')).toBeEnabled();
    await expect(page.getByTestId('unlink-siwe')).toBeEnabled();

    // Unlink Google
    await page.getByTestId('unlink-google').click();
    await expect(page.getByText('Sign-in method removed.')).toBeVisible({ timeout: 10000 });

    // Google identity unlinked: row shows Connect button; SIWE remains linked
    await expect(page.getByTestId('connect-google')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('unlink-siwe')).toBeVisible();

    // Unlink button for SIWE is now disabled (last identity)
    await expect(page.getByTestId('unlink-siwe')).toBeDisabled();
  });
});

// ─── Authorization flows are bound to the browser that started them ──────────

test.describe('Google link state binding', () => {
  /**
   * The state JWT travels through Google, so it is visible to anyone the
   * initiating user can reach — in a chat message, a Referer, a provider log.
   * On its own it used to be a bearer token for "attach an identity to user X":
   * an attacker started a link on their own account and got a victim to open
   * the resulting URL, and the victim's Google account became a way into the
   * attacker's SigNote account. The one-time cookie set at initiate is what
   * separates "the browser that asked for this" from "a browser handed a URL".
   */
  test('rejects an authorization flow completed in a different browser', async ({ page, browser }) => {
    const attacker = makeAccount().account;
    await injectSession(page, await createTestSession(attacker.address));

    const initiated = await page.request.get('/api/auth/link/google/initiate', { maxRedirects: 0 });
    expect(initiated.status()).toBe(307);
    const authorizationUrl = initiated.headers().location;

    // A browser with no SigNote session, which never initiated a link.
    const victimContext = await browser.newContext();
    try {
      const victim = await victimContext.newPage();
      const subject = `link-csrf-victim-${crypto.randomUUID()}`;
      await configureGoogleUser(victim, { sub: subject, name: 'Victim', email: `${subject}@example.com` });

      // Assert on the callback's own redirect, not on where the victim's tab
      // settles: signed out, /profile sends the visitor to / by itself, and a
      // toHaveURL on the error page was racing that second redirect — a fast
      // run read http://localhost:5005/ and failed. The refusal is what this
      // test is about, and it is fully decided by the time the callback
      // answers.
      const refusal = victim.waitForResponse((res) => new URL(res.url()).pathname === '/api/auth/link/google/callback');
      await victim.goto(authorizationUrl, { waitUntil: 'commit' });

      const response = await refusal;
      expect(response.status()).toBe(307);
      expect(response.headers().location).toMatch(/\/profile\?link_error=invalid_state$/);

      const rows = await testDb().select().from(authIdentities).where(eq(authIdentities.providerSubject, subject));
      expect(rows).toHaveLength(0);
    } finally {
      await victimContext.close();
    }
  });
});
