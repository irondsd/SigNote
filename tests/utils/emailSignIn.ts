import { expect, type Page } from '@playwright/test';
import { countCodes, waitForCode } from './emailInbox';
import { clearSession } from './clearSession';

/**
 * Drives the sign-in modal's email flow end to end: open, request a code, read
 * it out of the captured mailbox, submit it.
 */
export async function signInWithEmail(page: Page, email: string): Promise<void> {
  const before = countCodes(email);

  await neutraliseDevOverlay(page);
  const signInButton = page.getByTestId('sign-in-button').first();
  await expect(signInButton).toBeVisible();
  await signInButton.click();

  await requestCodeInModal(page, email);

  const code = await waitForCode(email, before + 1);
  await submitCode(page, code);
}

/** Opens the email step and asks for a code, stopping before the code is entered. */
export async function requestCodeInModal(page: Page, email: string): Promise<void> {
  const emailBtn = page.getByTestId('email-sign-in-btn');
  await emailBtn.waitFor({ state: 'visible' });
  await emailBtn.click();

  await page.getByTestId('signin-email-email-input').fill(email);
  await page.getByTestId('signin-email-submit').click();
  await expect(page.getByTestId('signin-email-code-input')).toBeVisible();
}

export async function submitCode(page: Page, code: string): Promise<void> {
  await page.getByTestId('signin-email-code-input').fill(code);
  await page.getByTestId('signin-email-submit').click();
}

export const expectSignedIn = async (page: Page) => {
  await expect(page.getByTestId('display-name').first()).toBeVisible({ timeout: 15000 });
};

/**
 * Signs out through the app's own button rather than `/api/auth/signout`, which
 * only renders NextAuth's confirmation form and leaves the session intact.
 */
export async function signOut(page: Page): Promise<void> {
  await neutraliseDevOverlay(page);
  const button = page.getByTestId('sign-out-button').first();
  await button.waitFor({ state: 'visible' });
  await button.click();
  await expect(page.getByTestId('sign-in-button').first()).toBeVisible({ timeout: 15000 });
  await clearSession(page);
}

/**
 * The Next.js dev overlay renders a full-viewport portal that swallows clicks
 * whenever it has something to say. Tests aren't interested in it, and the
 * Google spec already does exactly this.
 */
export async function neutraliseDevOverlay(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll<HTMLElement>('nextjs-portal').forEach((el) => {
      el.style.pointerEvents = 'none';
    });
  });
}
