import { test, expect } from '@playwright/test';
import { mockProvider } from '../utils/mockProvider';
import { changeAccount } from '../utils/changeAccount';
import { makeAccount } from '../utils/makeAccount';

const { privateKey } = makeAccount();

test.describe('basic tests', () => {
  test.beforeEach(async ({ page }) => {
    await mockProvider(page);

    await page.goto('/');

    await changeAccount(page, privateKey);
  });

  test('should load the homepage successfully', async ({ page }) => {
    // Wait for the page to load
    await page.waitForLoadState('networkidle');

    // Check that the page has loaded successfully
    expect(page.url()).toBe('http://localhost:5000/');

    // Check that the page has rendered successfully by looking for the Next.js root element
    const nextRoot = page.locator('main');
    await expect(nextRoot).toBeVisible();

    // Check that there are no JavaScript errors on the page
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Wait a moment to catch any console errors
    await page.waitForTimeout(2000);

    // Verify no critical console errors occurred
    expect(consoleErrors).toHaveLength(0);
  });
});
