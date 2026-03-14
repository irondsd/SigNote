import { type Page } from '@playwright/test';
import { clearSession } from './clearSession';

export const changeAccount = async (page: Page, privateKey: `0x${string}`) => {
  await clearSession(page); // ensure no wallet is connected

  await page.evaluate((pk) => {
    // ! window.ethereum is only available AFTER page.goto()
    if (!window.ethereum) {
      throw new Error('window.ethereum is not available. Make sure mockProvider is set up first.');
    }
    window.ethereum.setPrivateKey(pk);
  }, privateKey);
};
