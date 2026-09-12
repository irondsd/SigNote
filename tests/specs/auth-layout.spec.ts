import { test, expect, type Page } from '@playwright/test';

import { AuthenticatorPage } from '../pages/AuthenticatorPage';
import { seedNotes } from '../fixtures/seedNotes';
import { seedOtpRecords } from '../fixtures/seedOtpRecords';

test.describe.configure({ mode: 'parallel' });

/**
 * Issuers and accounts long enough to have a real min-content width. The
 * overflow bug only showed with content that cannot wrap — a bare `1fr` track
 * is `minmax(auto, 1fr)`, whose floor is the item's min-content size, so a card
 * with a nowrap identity line and 28px monospace digits pushed its track wider
 * than its share and the row ran off the page.
 */
const LONG = [
  { issuer: 'Token23311', account: 'wex@example.com' },
  { issuer: 'fdsfsdd', account: 'wex@example.com' },
  { issuer: 'Token2', account: 'wex@example.com' },
  { issuer: 'AVeryLongIssuerNameIndeed', account: 'an.extremely.long.account.name@somewhere.example.com' },
  { issuer: 'Cloudflare', account: 'k@signote.tech' },
  { issuer: 'Ünïcødé Issuer Name', account: 'ünïcødé.account@example.com' },
];

type Overflow = {
  documentOverflows: boolean;
  gridOverflows: boolean;
  columns: number;
  widest: number;
  gridWidth: number;
  strays: string[];
};

const measure = (page: Page): Promise<Overflow> =>
  page.evaluate(() => {
    const grid = document.querySelector('[class*="grid"]') as HTMLElement;
    const cards = Array.from(document.querySelectorAll('[data-testid="auth-card"]')) as HTMLElement[];
    const gridBox = grid.getBoundingClientRect();

    return {
      // 1px of slack absorbs sub-pixel rounding at fractional device ratios.
      documentOverflows: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      gridOverflows: grid.scrollWidth > grid.clientWidth + 1,
      columns: getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length,
      widest: Math.max(...cards.map((c) => c.getBoundingClientRect().width)),
      gridWidth: gridBox.width,
      // Any card whose right edge escapes the grid's right edge.
      strays: cards
        .filter((c) => c.getBoundingClientRect().right > gridBox.right + 1)
        .map((c) => c.textContent?.slice(0, 24) ?? '?'),
    };
  });

test.describe('authenticator card sizing', () => {
  // Each viewport sits just inside one of the grid's breakpoints.
  const VIEWPORTS: { name: string; width: number; columns: number }[] = [
    { name: 'phone', width: 390, columns: 1 },
    { name: 'small tablet', width: 700, columns: 2 },
    { name: 'laptop', width: 1200, columns: 3 },
    { name: 'wide', width: 1700, columns: 4 },
  ];

  for (const viewport of VIEWPORTS) {
    test(`cards stay inside the grid at ${viewport.name} (${viewport.width}px)`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: 900 });

      const authPage = new AuthenticatorPage(page);
      const { address, mekBytes } = await authPage.signInDirectly();
      await seedOtpRecords(address, mekBytes, LONG);
      await page.reload();
      await authPage.enroll();
      await expect(authPage.cards).toHaveCount(LONG.length);

      const result = await measure(page);

      expect(result.columns).toBe(viewport.columns);
      expect(result.strays).toEqual([]);
      expect(result.gridOverflows).toBe(false);
      expect(result.documentOverflows).toBe(false);

      // Every track gets an equal share, so no card may exceed it.
      const share = (result.gridWidth - 12 * (viewport.columns - 1)) / viewport.columns;
      expect(result.widest).toBeLessThanOrEqual(share + 1);
    });
  }

  /** The identity line is the part with no break opportunity — it must ellipsis
   *  rather than widen the card. */
  test('a very long issuer and account are clipped, not allowed to widen the card', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });

    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [
      { issuer: 'Short', account: 'a@b.co' },
      { issuer: 'X'.repeat(120), account: `${'y'.repeat(120)}@example.com` },
    ]);
    await page.reload();
    await authPage.enroll();
    await expect(authPage.cards).toHaveCount(2);

    const widths = await authPage.cards.evaluateAll((cards) =>
      cards.map((c) => Math.round(c.getBoundingClientRect().width)),
    );
    // The extreme card is exactly as wide as the ordinary one.
    expect(widths[0]).toBe(widths[1]);

    const result = await measure(page);
    expect(result.documentOverflows).toBe(false);
    expect(result.strays).toEqual([]);
  });

  /** Auth cards were asked to match note cards; assert that literally. */
  test('auth cards are the same width as note cards at the same viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });

    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, LONG.slice(0, 3));

    await seedNotes(address, [{ title: 'Note one' }, { title: 'Note two' }, { title: 'Note three' }]);

    await page.reload();
    await authPage.enroll();
    await expect(authPage.cards).toHaveCount(3);
    const authWidth = await authPage.cards.first().evaluate((c) => Math.round(c.getBoundingClientRect().width));

    await page.goto('/');
    await expect(page.getByTestId('note-card').first()).toBeVisible({ timeout: 10000 });
    const noteWidth = await page
      .getByTestId('note-card')
      .first()
      .evaluate((c) => Math.round(c.getBoundingClientRect().width));

    expect(authWidth).toBe(noteWidth);
  });

  /** The header clock used to be hidden below 560px; it should always show. */
  test('the refresh clock stays visible on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [{ issuer: 'Alpha' }]);
    await page.reload();
    await authPage.enroll();

    const clock = page.getByTestId('auth-clock');
    await expect(clock).toBeVisible();
    await expect(clock).toHaveText(/refresh in \d+s/);

    // Visible and inside the viewport, not merely present in the DOM.
    const box = await clock.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  });
});
