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
          onAuthCallback: () => () => undefined,
        }),
      });
    });
    await page.goto('/');
  });

  test('shows browser-based Google and WalletConnect SIWE sign-in', async ({ page }) => {
    await page.getByTestId('sign-in-button').first().click();

    await expect(page.getByTestId('desktop-google-sign-in-btn')).toBeVisible();
    await expect(page.getByTestId('google-sign-in-btn')).toHaveCount(0);
    await expect(page.getByTestId('siwe-sign-in-btn')).toBeVisible();

    await page.getByTestId('desktop-google-sign-in-btn').click();

    await expect(page.getByRole('status')).toContainText('Finish signing in in your browser');
    await expect(page.getByTestId('desktop-google-sign-in-btn')).toBeDisabled();
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem('desktop-browser-login-url')))
      .toContain('http://localhost:5005/desktop/login?');
    const browserLoginUrl = await page.evaluate(() => sessionStorage.getItem('desktop-browser-login-url'));
    expect(new URL(browserLoginUrl!).searchParams.get('attempt')).toHaveLength(32);
    expect(new URL(browserLoginUrl!).searchParams.get('state')).toHaveLength(43);
  });

  test('offers WalletConnect Ethereum identity management on the profile', async ({ page }) => {
    const token = await createGoogleTestSession('desktop-mode-google-user', 'desktop-mode@example.com');
    await injectSession(page, token);
    await page.goto('/profile');

    await expect(page.getByTestId('identity-google')).toBeVisible();
    await expect(page.getByTestId('identity-siwe')).toBeVisible();
    await expect(page.getByTestId('connect-siwe')).toBeVisible();
  });

  test('offers only the QR-compatible WalletConnect connector', async ({ page }) => {
    await page.getByTestId('sign-in-button').first().click();
    await page.getByTestId('siwe-sign-in-btn').click();

    const walletModal = page.locator('[aria-labelledby="rk_connect_title"]');
    await expect(walletModal).toBeVisible();
    await expect(walletModal.getByText('WalletConnect', { exact: true })).toBeVisible();
    await expect(walletModal.getByText('Browser Wallet', { exact: true })).toHaveCount(0);
    await expect(walletModal.getByText('MetaMask', { exact: true })).toHaveCount(0);
  });
});
