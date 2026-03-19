import { test, expect, type Page } from '@playwright/test';
import { changeAccount } from '../utils/changeAccount';
import { makeAccount } from '../utils/makeAccount';
import { mobileSignIn } from '../utils/mobileSignIn';
import { mockProvider } from '../utils/mockProvider';
import { seedNotes } from '../fixtures/seedNotes';

test.use({ viewport: { width: 400, height: 812 } });

test.describe.configure({ mode: 'parallel' });

// Helper: base setup — no sign-in
const setup = async (page: Page) => {
  const { privateKey, account } = makeAccount();
  await mockProvider(page);
  await page.goto('/');
  await changeAccount(page, privateKey);
  return { privateKey, account };
};

// ─── Test 1: Signed-out state + sidebar opens ────────────────────────────────

test('shows signed-out state and opens sidebar drawer', async ({ page }) => {
  await setup(page);

  // Hamburger is visible on mobile
  await expect(page.getByTestId('mobile-menu-btn')).toBeVisible();

  // Signed-out: no wallet address element exists anywhere in the DOM
  await expect(page.getByTestId('wallet-address')).toHaveCount(0);

  // Open the drawer
  await page.getByTestId('mobile-menu-btn').click();

  // Drawer is open → sign-in button is accessible
  // (the drawer uses CSS transform off-screen when closed, so we verify it post-open)
  await expect(page.getByTestId('mobile-drawer').getByTestId('sign-in-button')).toBeVisible();
});

// ─── Test 2: Sign-in works ───────────────────────────────────────────────────

test('sign in works on mobile', async ({ page }) => {
  await setup(page);
  await mobileSignIn(page);

  // Wallet address visible in the open drawer confirms successful sign-in
  await expect(page.getByTestId('mobile-drawer').getByTestId('wallet-address')).toBeVisible();
});

// ─── Test 3: Notes shown in 1-column layout ──────────────────────────────────

test('shows notes in 1-column layout at 400px', async ({ page }) => {
  const { account } = await setup(page);
  await mobileSignIn(page);

  await seedNotes(account.address, [
    { title: 'Mobile Layout Note 1' },
    { title: 'Mobile Layout Note 2' },
    { title: 'Mobile Layout Note 3' },
    { title: 'Mobile Layout Note 4' },
  ]);

  await page.reload();

  // All 4 notes visible
  for (let i = 1; i <= 4; i++) {
    await expect(page.getByTestId('note-card').filter({ hasText: `Mobile Layout Note ${i}` })).toBeVisible();
  }

  // Grid renders as a single column — at 400px the first breakpoint (480px) is not matched
  const columnCount = await page.locator('main').evaluate((el) => {
    const grid = el.querySelector('[class*="grid"]');
    if (!grid) return 0;
    return getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length;
  });
  expect(columnCount).toBe(1);
});

// ─── Test 4: 50 notes load via infinite scroll ───────────────────────────────

test('loads all 50 notes via infinite scroll', async ({ page }) => {
  const { account } = await setup(page);
  await mobileSignIn(page);

  // Seed 50 notes with unique, identifiable titles.
  // seedNotes assigns ascending positions (1000, 2000, …), so note 50 has the highest
  // position and loads first. Note 1 (lowest position) will be the last to load.
  await seedNotes(
    account.address,
    Array.from({ length: 50 }, (_, i) => ({ title: `Scroll Note ${String(i + 1).padStart(2, '0')}` })),
  );

  await page.reload();

  // First page loads 30 notes
  await expect(page.getByTestId('note-card')).toHaveCount(30, { timeout: 10000 });

  // Scroll to trigger IntersectionObserver: scroll the last visible card into view,
  // which brings the sentinel element (placed right after cards) into the viewport.
  // .content grows with its children so window scroll is document-level; Playwright's
  // scrollIntoViewIfNeeded handles whichever container is the actual scroller.
  for (let attempt = 0; attempt < 5; attempt++) {
    const count = await page.getByTestId('note-card').count();
    if (count >= 50) break;

    await page.getByTestId('note-card').last().scrollIntoViewIfNeeded();

    // Wait for the count to increase before next scroll attempt
    try {
      await expect(page.getByTestId('note-card')).not.toHaveCount(count, { timeout: 5000 });
    } catch {
      // Count didn't change — sentinel may not have entered view, try again
    }
  }

  // All 50 notes loaded
  await expect(page.getByTestId('note-card')).toHaveCount(50, { timeout: 10000 });

  // Note 01 is the last to load (lowest position) — confirms full scroll-through
  await expect(page.getByTestId('note-card').filter({ hasText: 'Scroll Note 01' })).toBeVisible();
});

// ─── Test 5: Header hides on scroll down, reappears on scroll up ─────────────

test('header hides on scroll down and reappears on scroll up', async ({ page }) => {
  const { account } = await setup(page);
  await mobileSignIn(page);

  await seedNotes(
    account.address,
    Array.from({ length: 15 }, (_, i) => ({ title: `Header Scroll Note ${i + 1}` })),
  );
  await page.reload();
  await expect(page.getByTestId('note-card')).toHaveCount(15, { timeout: 10000 });

  // 1. Header visible at top of page
  const headerY = () => page.getByTestId('mobile-header').evaluate((el) => el.getBoundingClientRect().y);

  expect(await headerY()).toBeGreaterThanOrEqual(0);

  // 2. Scroll down 500px — header hides
  await page.evaluate(() => window.scrollTo(0, 500));
  await page.waitForTimeout(400);
  expect(await headerY()).toBeLessThan(0);

  // 3. Scroll up 40px (to 460px) — header slides back into view
  await page.evaluate(() => window.scrollTo(0, 460));
  await page.waitForTimeout(400);
  expect(await headerY()).toBeGreaterThanOrEqual(0);

  // 4. Scroll down 40px (back to 500px) — header hides again
  await page.evaluate(() => window.scrollTo(0, 500));
  await page.waitForTimeout(400);
  expect(await headerY()).toBeLessThan(0);
});
