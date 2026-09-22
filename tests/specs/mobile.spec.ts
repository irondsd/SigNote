import { test, expect } from '@playwright/test';
import { changeAccount } from '../utils/changeAccount';
import { makeAccount } from '../utils/makeAccount';
import { mobileSignIn } from '../utils/mobileSignIn';
import { mockProvider } from '../utils/mockProvider';
import { createTestSession } from '../utils/createTestSession';
import { injectSession } from '../utils/injectSession';
import { seedNotes } from '../fixtures/seedNotes';
import { clearSession } from '../utils/clearSession';
import { NotesPage } from '../pages/NotesPage';
import { settleModal } from '../utils/settleModal';

test.use({ viewport: { width: 400, height: 812 } });

test.describe.configure({ mode: 'parallel' });

// ─── Test 1: Signed-out state + sidebar opens ────────────────────────────────

test('shows signed-out state and opens sidebar drawer', async ({ page }) => {
  await page.goto('/');

  // Hamburger is visible on mobile
  await expect(page.getByTestId('mobile-menu-btn')).toBeVisible();

  // Signed-out: no wallet address element exists anywhere in the DOM
  await expect(page.getByTestId('display-name')).toHaveCount(0);

  // Open the drawer
  await page.getByTestId('mobile-menu-btn').click();

  // Drawer is open → sign-in button is accessible
  await expect(page.getByTestId('mobile-drawer').getByTestId('sign-in-button')).toBeVisible();
});

// ─── Test 2: Sign-in works (keeps full UI flow — this tests the mobile sign-in UX) ──

test('sign in works on mobile', async ({ page }) => {
  const { privateKey } = makeAccount();
  await mockProvider(page);
  await page.goto('/');
  await changeAccount(page, privateKey);
  await mobileSignIn(page);

  // Wallet address visible in the open drawer confirms successful sign-in
  await expect(page.getByTestId('mobile-drawer').getByTestId('display-name')).toBeVisible();
});

// ─── Test 3: Notes shown in 1-column layout ──────────────────────────────────

test('shows notes in 1-column layout at 400px', async ({ page }) => {
  const { account } = makeAccount();
  const token = await createTestSession(account.address);
  await injectSession(page, token);
  await page.goto('/');

  await seedNotes(account.address, [
    { title: 'Mobile Layout Note 1' },
    { title: 'Mobile Layout Note 2' },
    { title: 'Mobile Layout Note 3' },
    { title: 'Mobile Layout Note 4' },
  ]);

  await clearSession(page);
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
  const { account } = makeAccount();
  const token = await createTestSession(account.address);
  await injectSession(page, token);
  await page.goto('/');

  // Seed 50 notes with unique, identifiable titles.
  await seedNotes(
    account.address,
    Array.from({ length: 50 }, (_, i) => ({ title: `Scroll Note ${String(i + 1).padStart(2, '0')}` })),
  );

  await clearSession(page);
  await page.reload();

  // First page loads 30 notes
  await expect(page.getByTestId('note-card')).toHaveCount(30, { timeout: 10000 });

  for (let attempt = 0; attempt < 5; attempt++) {
    const count = await page.getByTestId('note-card').count();
    if (count >= 50) break;

    await page.getByTestId('note-card').last().scrollIntoViewIfNeeded();

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
  const { account } = makeAccount();
  const token = await createTestSession(account.address);
  await injectSession(page, token);
  await page.goto('/');

  await seedNotes(
    account.address,
    Array.from({ length: 15 }, (_, i) => ({ title: `Header Scroll Note ${i + 1}` })),
  );
  await clearSession(page);
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

// ─── Test 6: Note modal follows the keyboard-visible viewport ────────────────

test('long note can scroll back to its first line above a simulated PWA keyboard', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { height: 812, offsetTop: 0 };
    const viewport = new EventTarget();

    Object.defineProperties(viewport, {
      height: { configurable: true, get: () => state.height },
      width: { configurable: true, get: () => window.innerWidth },
      offsetTop: { configurable: true, get: () => state.offsetTop },
      offsetLeft: { configurable: true, get: () => 0 },
      pageTop: { configurable: true, get: () => state.offsetTop },
      pageLeft: { configurable: true, get: () => 0 },
      scale: { configurable: true, get: () => 1 },
    });

    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: viewport,
    });
    Object.defineProperty(window, '__setTestVisualViewport', {
      configurable: true,
      value: (height: number, offsetTop: number) => {
        state.height = height;
        state.offsetTop = offsetTop;
        viewport.dispatchEvent(new Event('resize'));
        viewport.dispatchEvent(new Event('scroll'));
      },
    });
  });

  const { account } = makeAccount();
  const title = `Keyboard Viewport ${Date.now()}`;
  const firstLine = 'FIRST EDITABLE LINE';
  const content = [firstLine, ...Array.from({ length: 100 }, (_, i) => `Long line ${i + 1}`)]
    .map((line) => `<p>${line}</p>`)
    .join('');
  await seedNotes(account.address, [{ title, content }]);

  const notesPage = new NotesPage(page);
  await notesPage.signInDirectly(account.address);
  await notesPage.openInEditMode(title);
  await settleModal(page);

  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __setTestVisualViewport: (height: number, offsetTop: number) => void;
    };
    testWindow.__setTestVisualViewport(360, 24);
  });

  const backdrop = page.locator('[data-backdrop="true"]');
  await expect(backdrop).toHaveCSS('height', '360px');
  await expect(backdrop).toHaveCSS('top', '24px');

  const body = page.getByTestId('note-modal-body');
  await body.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await body.evaluate((element) => {
    element.scrollTop = 0;
  });

  const geometry = await page.evaluate(() => {
    const modal = document.querySelector<HTMLElement>('[data-testid="note-modal"]')!;
    const bodyElement = document.querySelector<HTMLElement>('[data-testid="note-modal-body"]')!;
    const firstParagraph = document.querySelector<HTMLElement>('[data-testid="tiptap-editor"] .ProseMirror p')!;
    const viewport = window.visualViewport!;
    const modalRect = modal.getBoundingClientRect();
    const bodyRect = bodyElement.getBoundingClientRect();
    const firstRect = firstParagraph.getBoundingClientRect();

    return {
      viewportTop: viewport.offsetTop,
      viewportBottom: viewport.offsetTop + viewport.height,
      modalTop: modalRect.top,
      modalBottom: modalRect.bottom,
      bodyTop: bodyRect.top,
      bodyBottom: bodyRect.bottom,
      firstTop: firstRect.top,
      firstBottom: firstRect.bottom,
      scrollTop: bodyElement.scrollTop,
    };
  });

  expect(geometry.modalTop).toBeGreaterThanOrEqual(geometry.viewportTop - 1);
  expect(geometry.modalBottom).toBeLessThanOrEqual(geometry.viewportBottom + 1);
  expect(geometry.scrollTop).toBe(0);
  expect(geometry.firstTop).toBeGreaterThanOrEqual(geometry.bodyTop - 1);
  expect(geometry.firstBottom).toBeLessThanOrEqual(geometry.bodyBottom + 1);
  await expect(body).toContainText(firstLine);
});
