import { test, expect } from '@playwright/test';
import { NotesPage } from '../pages/NotesPage';

test.describe.configure({ mode: 'parallel' });

test.describe('multi-tab logout', () => {
  test('logging out in one tab immediately logs out other tabs', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    // Open a second tab in the same browser context — shares cookies and BroadcastChannel
    const page2 = await page.context().newPage();
    await page2.goto('/');
    await page2.waitForLoadState('networkidle');

    // Both tabs are authenticated
    await expect(page.getByTestId('sign-out-button').first()).toBeVisible();
    await expect(page2.getByTestId('sign-out-button').first()).toBeVisible();

    // Log out from the first tab
    await page.getByTestId('sign-out-button').first().click();

    // Second tab should immediately transition to unauthenticated state via BroadcastChannel
    await expect(page2.getByTestId('sign-in-button').first()).toBeVisible({ timeout: 5000 });
  });
});
