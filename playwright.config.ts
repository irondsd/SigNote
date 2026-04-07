import { defineConfig, devices } from '@playwright/test';

const BASE_TIMEOUT = 5000; // 5 seconds

/**
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : 8,
  /* Reporter to use. Add html for richer downloadable artifact on CI */
  reporter: [process.env.CI ? ['html', { outputFolder: 'playwright-report', open: 'never' }] : ['list']],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'http://localhost:5005',

    /* Run headless by default, override with --headed flag */
    headless: true,

    /* Take a screenshot on failure */
    screenshot: 'only-on-failure',
  },
  // per-test timeout (ms)
  timeout: BASE_TIMEOUT * 10,
  // expect API timeout (ms)
  expect: { timeout: BASE_TIMEOUT },
  /* Where to put test artifacts like traces, screenshots, videos */
  outputDir: 'test-results',

  /* Configure projects for tests on chrome */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // The dev server is started inside globalSetup (after MongoDB) so that it
  // inherits the dynamic MONGODB_URI. webServer is intentionally omitted here.
  globalSetup: './tests/setup/globalSetup.ts',
  globalTeardown: './tests/setup/globalTeardown.ts',
});
