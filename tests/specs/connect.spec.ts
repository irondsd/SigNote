import { test, expect } from '@playwright/test';
import { changeAccount } from '../utils/changeAccount';
import { makeAccount } from '../utils/makeAccount';
import { mockProvider } from '../utils/mockProvider';
import { shortenAddress } from '../../src/utils/shortenAddress';

const { privateKey, account } = makeAccount();

test.describe('connect wallet', () => {
  test.beforeEach(async ({ page }) => {
    await mockProvider(page);
    await page.goto('/');
    await changeAccount(page, privateKey);
  });

  test('should complete full SIWE sign-in flow', async ({ page }) => {
    // Verify unauthenticated state
    const signInButton = page.getByTestId('sign-in-button').first();
    await expect(signInButton).toBeVisible();

    // Click sign-in to open RainbowKit modal
    await signInButton.click();

    // Select Browser Wallet (injectedWallet using window.ethereum) from the RainbowKit modal
    const connectModal = page.locator('[aria-labelledby="rk_connect_title"]');
    await expect(connectModal).toBeVisible();

    // The injected connector causes continuous re-renders in the RainbowKit modal,
    // making DOM elements unstable. Click via JS to bypass Playwright stability checks.
    await page.waitForFunction(() => {
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
    });

    // Wait for the full SIWE flow to complete:
    // eth_requestAccounts → nonce fetch → personal_sign → signIn → session update
    const walletAddress = page.getByTestId('wallet-address').first();
    await expect(walletAddress).toBeVisible({ timeout: 15000 });

    // Verify the correct address is displayed
    const expectedShort = shortenAddress(account.address);
    await expect(walletAddress).toHaveText(expectedShort);

    // Verify authenticated UI — UnauthenticatedState should be gone
    await expect(page.getByText('Welcome to SigNote')).not.toBeVisible();
  });
});
