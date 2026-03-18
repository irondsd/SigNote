import { expect, type Page } from '@playwright/test';

// Mobile-aware sign-in: opens the drawer first so the sign-in button inside is visible,
// then triggers the SIWE flow. The existing signIn utility uses .first() which resolves
// to the hidden desktop sidebar element at 400px, so we handle it here explicitly.
export const mobileSignIn = async (page: Page): Promise<void> => {
  const drawer = page.getByTestId('mobile-drawer');
  const drawerWalletAddress = drawer.getByTestId('wallet-address');

  await page.getByTestId('mobile-menu-btn').click();
  await drawer.getByTestId('sign-in-button').click();

  // Race: RainbowKit modal appears (click Browser Wallet) vs auto-connect completes
  await Promise.any([
    page.waitForFunction(() => {
      const modal = document.querySelector('[aria-labelledby="rk_connect_title"]');
      const buttons = modal?.querySelectorAll('button');
      for (const btn of buttons || []) {
        if (btn.textContent?.includes('Browser Wallet')) {
          (btn as HTMLElement).scrollIntoView();
          (btn as HTMLElement).click();
          return true;
        }
      }
      return false;
    }),
    drawerWalletAddress.waitFor({ state: 'visible', timeout: 15000 }),
  ]);

  await expect(drawerWalletAddress).toBeVisible({ timeout: 15000 });
};
