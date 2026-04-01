import { test, expect } from '@playwright/test';

test.describe('basic tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
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

  test('should switch themes via the theme toggle', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const html = page.locator('html');

    // Switch to dark
    await page.getByTestId('dark-theme-btn').first().click();
    await expect(html).toHaveClass(/dark/);

    // Switch to light
    await page.getByTestId('light-theme-btn').first().click();
    await expect(html).not.toHaveClass(/dark/);
    await expect(html).toHaveClass(/light/);

    // Ensure a deterministic color scheme before switching back to system
    await page.emulateMedia({ colorScheme: 'light' });

    // Switch back to system
    await page.getByTestId('system-theme-btn').first().click();
    await expect(html).toHaveClass(/light/);
  });
});
