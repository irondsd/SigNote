import { expect, type Locator, type Page } from '@playwright/test';
import { countCodes, waitForCode } from './emailInbox';

/** For waits gated on a code being issued and mailed, not on a render. */
export const SERVER_ROUND_TRIP_MS = 20000;
/** OAuth callbacks can include several local server round trips under load. */
export const AUTH_NAVIGATION_TIMEOUT_MS = 30000;
import { clearSession } from './clearSession';

/**
 * Drives the sign-in modal's email flow end to end: open, request a code, read
 * it out of the captured mailbox, submit it.
 */
export async function signInWithEmail(page: Page, email: string): Promise<void> {
  const before = countCodes(email);

  await openSignInModal(page);
  await requestCodeInModal(page, email);

  const code = await waitForCode(email, before + 1);
  await submitCode(page, code);
}

/** Opens the email step and asks for a code, stopping before the code is entered. */
export async function requestCodeInModal(page: Page, email: string): Promise<void> {
  const emailBtn = page.getByTestId('email-sign-in-btn');
  await emailBtn.waitFor({ state: 'visible' });
  await emailBtn.click();

  await fillStable(page.getByTestId('signin-email-email-input'), email);
  await page.getByTestId('signin-email-submit').click();
  // Longer than the global expect timeout on purpose: this waits on a server
  // round trip that renders an email template under whatever parallel load the
  // run has.
  await expect(page.getByTestId('signin-email-code-input')).toBeVisible({ timeout: SERVER_ROUND_TRIP_MS });
}

export async function submitCode(page: Page, code: string): Promise<void> {
  await fillStable(page.getByTestId('signin-email-code-input'), code);
  await page.getByTestId('signin-email-submit').click();
}

/**
 * Fills a controlled input and waits for the value to survive a render.
 *
 * Playwright can type into the DOM before React has attached its handlers: the
 * box looks filled, component state is still empty, and the form submits
 * nothing. `toHaveValue` retries, so this waits out hydration.
 */
export async function fillStable(locator: Locator, value: string): Promise<void> {
  await locator.waitFor({ state: 'visible' });
  await locator.fill(value);
  await expect(locator).toHaveValue(value);
}

export const expectSignedIn = async (page: Page) => {
  await expect(page.getByTestId('display-name').first()).toBeVisible({ timeout: AUTH_NAVIGATION_TIMEOUT_MS });
};

/**
 * Signs out through the app's own button rather than `/api/auth/signout`, which
 * only renders NextAuth's confirmation form and leaves the session intact.
 */
export async function signOut(page: Page): Promise<void> {
  const button = page.getByTestId('sign-out-button').first();
  await button.waitFor({ state: 'visible' });
  await button.click();
  await expect(page.getByTestId('sign-in-button').first()).toBeVisible({ timeout: 15000 });
  await clearSession(page);
}

/**
 * The Next.js error overlay renders a full-viewport portal that swallows clicks
 * whenever it has something to say.
 *
 * A stylesheet rather than the one-shot `querySelectorAll` the Google spec
 * uses: the rule is installed before any page script and applies to the portal
 * however late it mounts, so a re-render mid-test can't put it back.
 */
export async function disableDevOverlay(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const install = () => {
      const style = document.createElement('style');
      style.textContent = 'nextjs-portal { pointer-events: none !important; }';
      document.head?.appendChild(style);
    };
    if (document.head) install();
    else document.addEventListener('DOMContentLoaded', install, { once: true });
  });
}

/** Opens the sign-in modal from the unauthenticated state. */
export async function openSignInModal(page: Page): Promise<void> {
  const signInButton = page.getByTestId('sign-in-button').first();
  await expect(signInButton).toBeVisible();
  await signInButton.click();
}
