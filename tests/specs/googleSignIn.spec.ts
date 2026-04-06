import { test, expect, type Page } from '@playwright/test';
import { configureGoogleUser, setGoogleError } from '../utils/googleAuth';

test.describe.configure({ mode: 'parallel' });

test.describe('Google sign-in', () => {
  async function clickGoogleSignIn(page: Page) {
    // In dev mode the Next.js portal overlay can intercept pointer events when
    // there are console issues (e.g. from concurrent OAuth activity). Neutralise
    // it so the sign-in button click lands on the right element.
    await page.evaluate(() => {
      document.querySelectorAll<HTMLElement>('nextjs-portal').forEach((el) => {
        el.style.pointerEvents = 'none';
      });
    });

    const signInButton = page.getByTestId('sign-in-button').first();
    await expect(signInButton).toBeVisible();
    await signInButton.click();

    const googleBtn = page.getByTestId('google-sign-in-btn');
    await googleBtn.waitFor({ state: 'visible' });
    await googleBtn.click();
  }

  test('new user signing in with Google creates an account and establishes a session', async ({ page }) => {
    await configureGoogleUser(page, { sub: 'g-new-001', name: 'Alice Test', email: 'alice@example.com' });

    await page.goto('/');
    await clickGoogleSignIn(page);

    // NextAuth redirects browser → mock /auth → mock auto-redirects → NextAuth callback
    // → server-side token exchange → signIn callback creates user → session set → app
    const displayName = page.getByTestId('display-name').first();
    await expect(displayName).toBeVisible({ timeout: 20000 });
    await expect(displayName).toHaveText('Alice Test');

    // Unauthenticated state should be gone
    await expect(page.getByTestId('sign-in-button').first()).not.toBeVisible();
  });

  test('returning user signing in with the same Google account reuses the existing record', async ({ page }) => {
    const profile = { sub: 'g-returning-002', name: 'Bob Return', email: 'bob@example.com' };

    // ── First sign-in: creates the user ──────────────────────────────────────
    await configureGoogleUser(page, profile);
    await page.goto('/');
    await clickGoogleSignIn(page);

    const displayName = page.getByTestId('display-name').first();
    await expect(displayName).toBeVisible({ timeout: 20000 });

    // Capture the session user ID from the NextAuth session endpoint
    const sessionRes = await page.request.get('/api/auth/session');
    const firstSession = (await sessionRes.json()) as { user?: { id?: string } };
    const firstUserId = firstSession.user?.id;
    expect(firstUserId).toBeTruthy();

    // ── Sign out ──────────────────────────────────────────────────────────────
    await page.getByTestId('sign-out-button').first().click();
    await expect(page.getByTestId('sign-in-button').first()).toBeVisible({ timeout: 10000 });

    // ── Second sign-in: same Google sub ──────────────────────────────────────
    await configureGoogleUser(page, profile);
    await page.goto('/');
    await page.keyboard.press('Escape');
    await clickGoogleSignIn(page);
    await expect(displayName).toBeVisible({ timeout: 20000 });

    const sessionRes2 = await page.request.get('/api/auth/session');
    const secondSession = (await sessionRes2.json()) as { user?: { id?: string } };
    const secondUserId = secondSession.user?.id;

    // Must be the same MongoDB user — no duplicate created
    expect(secondUserId).toBe(firstUserId);
  });

  test('Google OAuth error leaves the user unauthenticated', async ({ page }) => {
    await setGoogleError(page, 'access_denied');

    await page.goto('/');
    await clickGoogleSignIn(page);

    // NextAuth receives the error from the OAuth callback and redirects to its
    // own error page at /api/auth/error. Wait for that navigation to complete.
    await page.waitForURL(/\/api\/auth\/error|[?&]error=/, { timeout: 15000 });

    // Navigate back to the app and confirm no session was established.
    await page.goto('/');
    await expect(page.getByTestId('sign-in-button').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('display-name').first()).not.toBeVisible();
  });
});
