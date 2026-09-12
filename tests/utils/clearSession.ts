import type { Page } from '@playwright/test';

/**
 * A navigation tore the frame down between the two sides of an `evaluate`.
 *
 * Sign-out is the case that produces it: `SidebarNav` calls
 * `signOut({ redirect: false })`, so the sign-in button appears without a
 * navigation — but any authenticated request still in flight then 401s and
 * `handleUnauthorized` finishes with `signOut({ callbackUrl: '/' })`, a real
 * one. A caller that waits on rendered state is therefore *already* past its
 * assertion when that navigation lands.
 */
const isNavigationTeardown = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Execution context was destroyed') ||
    message.includes('Target closed') ||
    message.includes('frame was detached') ||
    message.includes('Frame was detached')
  );
};

/**
 * Empties every client-side store the app writes to.
 *
 * Retried rather than pre-synchronised: there is no state to wait for that
 * proves no further navigation is coming, and a torn-down frame means the
 * storage being cleared belongs to the same origin either way — so running it
 * again on the new document is both correct and sufficient.
 */
export const clearSession = async (page: Page, attempts = 3) => {
  for (let attempt = 1; ; attempt++) {
    try {
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
      return;
    } catch (error) {
      if (attempt >= attempts || !isNavigationTeardown(error)) throw error;
      // Let the navigation that destroyed the context finish before retrying,
      // so the next attempt runs against a document that will survive it.
      await page.waitForLoadState('domcontentloaded').catch(() => undefined);
    }
  }
};
