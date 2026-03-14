import { type Page, expect } from '@playwright/test';
import type { Address } from 'viem';

import { shortenAddress } from '../../src/utils/shortenAddress';
import { clearSession } from '../utils/clearSession';

export abstract class BasePage {
  constructor(protected page: Page) {}

  // Navigate to the page. Should be implemented by each page class.
  abstract goto(): Promise<void>;

  // Connect a wallet and complete the full SIWE sign-in flow
  async connectWallet(expectedAddress: Address) {
    await clearSession(this.page); // ensure no wallet is connected

    const connectButton = this.page.getByTestId('sign-in-button').first();
    const walletAddress = this.page.getByTestId('wallet-address').first();

    // Check if already signed in
    if (await walletAddress.isVisible().catch(() => false)) {
      const shortenedAddress = shortenAddress(expectedAddress);
      await expect(walletAddress).toHaveText(shortenedAddress);
      return;
    }

    await expect(connectButton).toBeVisible();

    // Click sign-in to open RainbowKit modal
    await connectButton.click();

    // RainbowKit modal — click Browser Wallet via JS to bypass stability issues
    // caused by continuous re-renders from the injected wallet connector
    await this.page.waitForFunction(() => {
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

    // After clicking Browser Wallet, the full SIWE flow runs:
    // eth_requestAccounts → nonce fetch → personal_sign → signIn → session update
    // The sign-in button disappears and is replaced by the wallet address in sidebar
    const shortenedAddress = shortenAddress(expectedAddress);
    await expect(walletAddress).toBeVisible({ timeout: 15000 });
    await expect(walletAddress).toHaveText(shortenedAddress);
  }

  // Helper method to get elements by test ID
  protected getByTestId(testId: string) {
    return this.page.getByTestId(testId);
  }
}
