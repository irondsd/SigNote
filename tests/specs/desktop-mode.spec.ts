import { expect, test } from '@playwright/test';
import { createGoogleTestSession } from '../utils/createGoogleTestSession';
import { injectSession } from '../utils/injectSession';

test.describe('desktop mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'signoteDesktop', {
        configurable: false,
        value: Object.freeze({
          isDesktop: true,
          platform: 'macos',
          appVersion: '0.1.0-test',
          startBrowserLogin: async (url: string) => {
            sessionStorage.setItem('desktop-browser-login-url', url);
          },
        }),
      });
    });
    await page.goto('/');
  });

  test('shows only the browser-based Google sign-in flow', async ({ page }) => {
    await page.getByTestId('sign-in-button').first().click();

    await expect(page.getByTestId('desktop-google-sign-in-btn')).toBeVisible();
    await expect(page.getByTestId('google-sign-in-btn')).toHaveCount(0);
    await expect(page.getByTestId('siwe-sign-in-btn')).toHaveCount(0);

    await page.getByTestId('desktop-google-sign-in-btn').click();

    await expect(page.getByRole('status')).toContainText('Finish signing in in your browser');
    await expect(page.getByTestId('desktop-google-sign-in-btn')).toBeDisabled();
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem('desktop-browser-login-url')))
      .toBe('http://localhost:5005/desktop/login');
  });

  test('hides Ethereum identity management from the profile', async ({ page }) => {
    const token = await createGoogleTestSession('desktop-mode-google-user', 'desktop-mode@example.com');
    await injectSession(page, token);
    await page.goto('/profile');

    await expect(page.getByTestId('identity-google')).toBeVisible();
    await expect(page.getByTestId('identity-siwe')).toHaveCount(0);
    await expect(page.getByTestId('connect-siwe')).toHaveCount(0);
  });
});
