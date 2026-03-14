import type { Page } from '@playwright/test';

export const clearSession = async (page: Page) => {
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    // close all open indexedDB connections
    const databases = await indexedDB.databases();
    for (const db of databases) {
      if (db.name) {
        indexedDB.deleteDatabase(db.name);
      }
    }
  });
};
