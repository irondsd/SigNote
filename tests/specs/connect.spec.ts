import { test, expect } from '@playwright/test';
import { changeAccount } from '../utils/changeAccount';
import { makeAccount } from '../utils/makeAccount';
import { mockProvider } from '../utils/mockProvider';
import { shortenAddress } from '../../src/utils/shortenAddress';

const { privateKey, account } = makeAccount();

test.describe('connect wallet', () => {
  // Tests that need a wallet account pre-configured (auto-connect or modal path)
  test.describe('authenticated flows', () => {
    test.beforeEach(async ({ page }) => {
      await mockProvider(page);
      await page.goto('/');
      await changeAccount(page, privateKey);
    });

    test('should complete full SIWE sign-in flow', async ({ page }) => {
      // Verify unauthenticated state
      const signInButton = page.getByTestId('sign-in-button').first();
      await expect(signInButton).toBeVisible();

      // Click sign-in — opens SignInModal
      await signInButton.click();

      // Click "Sign in with Ethereum" in the modal
      const siweBtn = page.getByTestId('siwe-sign-in-btn');
      await siweBtn.waitFor({ state: 'visible' });
      await siweBtn.click();

      // Race: modal appears → click Browser Wallet, OR auto-connect completes without modal
      const walletAddress = page.getByTestId('wallet-address').first();
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
        walletAddress.waitFor({ state: 'visible' }),
      ]);

      // Wait for the full SIWE flow to complete:
      // eth_requestAccounts → nonce fetch → personal_sign → signIn → session update
      await expect(walletAddress).toBeVisible();

      // Verify the correct address is displayed
      const expectedShort = shortenAddress(account.address);
      await expect(walletAddress).toHaveText(expectedShort);

      // Verify authenticated UI — UnauthenticatedState should be gone
      await expect(page.getByText('Welcome to SigNote')).not.toBeVisible();
    });

    test('should reset button when signature request is rejected', async ({ page }) => {
      // Set rejection BEFORE clicking sign-in so it is guaranteed to be in place
      // before personal_sign fires, regardless of whether auto-connect or the modal path runs.
      await page.evaluate(() => {
        window.ethereum.setRejectNextRequest('personal_sign');
      });

      const signInButton = page.getByTestId('sign-in-button').first();
      await signInButton.click();

      // Click "Sign in with Ethereum" in SignInModal to trigger the SIWE flow
      const siweBtn = page.getByTestId('siwe-sign-in-btn');
      await siweBtn.waitFor({ state: 'visible' });
      await siweBtn.click();

      // Non-blocking: if the RainbowKit modal appears click Browser Wallet to trigger the SIWE flow.
      // In the auto-connect path the modal never appears and personal_sign is rejected automatically.
      page
        .waitForSelector('[aria-labelledby="rk_connect_title"]', { timeout: 8000 })
        .then(() =>
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
        )
        .catch(() => {
          // Auto-connect path — modal never appeared; rejection fires automatically.
        });

      // After rejection the SIWE button must return to idle (enabled, original label)
      await expect(siweBtn).toBeEnabled({ timeout: 15000 });
      await expect(siweBtn).toContainText('Sign in with Ethereum');
      // User should not be signed in
      await expect(page.getByTestId('wallet-address').first()).not.toBeVisible();
    });

    test('should sign out and return to unauthenticated state', async ({ page }) => {
      const signInButton = page.getByTestId('sign-in-button').first();
      await signInButton.click();

      // Click "Sign in with Ethereum" in SignInModal
      const siweBtn = page.getByTestId('siwe-sign-in-btn');
      await siweBtn.waitFor({ state: 'visible' });
      await siweBtn.click();

      const walletAddress = page.getByTestId('wallet-address').first();
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
        walletAddress.waitFor({ state: 'visible' }),
      ]);

      await expect(walletAddress).toBeVisible();

      // Sign out
      await page.getByTestId('sign-out-button').first().click();

      // Verify unauthenticated state is restored
      await expect(signInButton).toBeVisible();
      await expect(walletAddress).not.toBeVisible();
    });
  });

  // This test needs the wallet to be DISCONNECTED so the RainbowKit modal appears.
  // It uses a minimal setup (no changeAccount) so wagmi never auto-connects.
  test.describe('modal dismissal', () => {
    test.beforeEach(async ({ page }) => {
      await mockProvider(page);
      await page.goto('/');
      // Set the key silently — no accountsChanged event, so wagmi stays disconnected
      // and openConnectModal will open the RainbowKit modal when sign-in is clicked.
      await page.evaluate((pk) => {
        window.ethereum.setPrivateKey(pk, true);
      }, privateKey);
    });

    test('should close modal and reset button when close button is clicked', async ({ page }) => {
      const signInButton = page.getByTestId('sign-in-button').first();
      await signInButton.click();

      // Click "Sign in with Ethereum" in SignInModal to trigger RainbowKit
      const siweBtn = page.getByTestId('siwe-sign-in-btn');
      await siweBtn.waitFor({ state: 'visible' });
      await siweBtn.click();

      // Wait for the RainbowKit connect modal to appear
      const modal = page.locator('[aria-labelledby="rk_connect_title"]');
      await modal.waitFor({ state: 'visible' });

      // Click the modal's close button (the X)
      const closeBtn = modal.locator('[aria-label="Close"]');
      await closeBtn.waitFor({ state: 'visible' });
      await expect(closeBtn).toBeEnabled();
      await closeBtn.click();

      // Modal must disappear
      await expect(modal).not.toBeVisible();

      // SIWE button must return to idle (enabled, original label)
      await expect(siweBtn).toBeEnabled();
      await expect(siweBtn).toContainText('Sign in with Ethereum');
    });
  });
});
