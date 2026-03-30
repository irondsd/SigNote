import { expect, type Page } from '@playwright/test';

export const signIn = async (page: Page): Promise<void> => {
  const walletAddress = page.getByTestId('wallet-address').first();

  // If already authenticated, skip
  if (await walletAddress.isVisible().catch(() => false)) return;

  const connectButton = page.getByTestId('sign-in-button').first();
  await expect(connectButton).toBeVisible();
  await connectButton.click();

  // Wait for SignInModal and click "Sign in with Ethereum"
  const siweBtn = page.getByTestId('siwe-sign-in-btn');
  await siweBtn.waitFor({ state: 'visible' });
  await siweBtn.click();

  // Race: RainbowKit modal appears (click Browser Wallet) vs auto-connect completes without modal
  // Promise.any: resolves when either succeeds; rejects only when both fail
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
    walletAddress.waitFor({ state: 'visible', timeout: 15000 }),
  ]);

  // After clicking Browser Wallet, the full SIWE flow runs:
  // eth_requestAccounts → nonce fetch → personal_sign → signIn → session update
  await expect(walletAddress).toBeVisible({ timeout: 15000 });
};
