import { test, expect, type Page } from '@playwright/test';
import { makeAccount } from '../utils/makeAccount';
import { seedNotes } from '../fixtures/seedNotes';
import { NotesPage } from '../pages/NotesPage';

test.describe.configure({ mode: 'parallel' });

/** Wait for the modal's open-from-card animation to settle. */
async function waitForModalStable(page: Page) {
  await page.getByTestId('note-modal').evaluate(async (el) => {
    let prev = -1;
    let stable = 0;
    for (let i = 0; i < 180; i++) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const animating = el.getAnimations({ subtree: true }).some((a) => a.playState === 'running');
      const h = el.getBoundingClientRect().height;
      if (!animating && Math.abs(h - prev) < 0.5) stable++;
      else stable = 0;
      prev = h;
      if (stable >= 6) return;
    }
  });
}

/** Read the visible titles of `note-card`s in DOM order. */
async function cardTitles(notesPage: NotesPage): Promise<string[]> {
  const cards = notesPage.page.getByTestId('note-card');
  const count = await cards.count();
  const titles: string[] = [];
  for (let i = 0; i < count; i++) {
    const text = (await cards.nth(i).innerText()).split('\n')[0]?.trim();
    if (text) titles.push(text);
  }
  return titles;
}

/** Filter cards to just the ones belonging to this test's tag. */
async function taggedTitles(notesPage: NotesPage, tag: string): Promise<string[]> {
  return (await cardTitles(notesPage)).filter((t) => t.startsWith(tag));
}

async function openMoreActionsAndClickPinToggle(notesPage: NotesPage, title: string): Promise<void> {
  const page = notesPage.page;
  await notesPage.noteCard(title).click();
  await expect(page.getByTestId('note-title')).toBeVisible();

  // The modal animates in (≈350ms transform) — wait for it before clicking.
  await waitForModalStable(page);
  await page.getByTestId('more-actions-btn').click();

  // Wait for the PATCH that the menu item click will trigger.
  const patchPromise = page.waitForResponse(
    (r) => r.url().includes('/api/notes/') && r.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: /(pin to top|unpin from top)/i }).click();
  await patchPromise;

  // Close the modal so the grid behind is interactive again.
  await waitForModalStable(page);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('note-title')).toHaveCount(0);
}

test.describe('pin', () => {
  test('seeded pinned note appears first', async ({ page }) => {
    const { account } = makeAccount();
    const tag = `pin-seed-${Date.now()}`;
    await seedNotes(account.address, [
      { title: `${tag} A` },
      { title: `${tag} B` },
      { title: `${tag} C`, pinned: true },
    ]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await expect(notesPage.noteCard(`${tag} C`)).toBeVisible();

    expect((await taggedTitles(notesPage, tag))[0]).toBe(`${tag} C`);
  });

  test('seeded pinned note shows the pin flag, unpinned does not', async ({ page }) => {
    const { account } = makeAccount();
    const tag = `pin-flag-${Date.now()}`;
    await seedNotes(account.address, [
      { title: `${tag} unpinned` },
      { title: `${tag} pinned`, pinned: true },
    ]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    await expect(notesPage.noteCard(`${tag} pinned`).getByTestId('pin-flag')).toBeVisible();
    await expect(notesPage.noteCard(`${tag} unpinned`).getByTestId('pin-flag')).toHaveCount(0);
  });

  test('pin via menu moves the note to the top', async ({ page }) => {
    const { account } = makeAccount();
    const tag = `pin-action-${Date.now()}`;
    await seedNotes(account.address, [{ title: `${tag} A` }, { title: `${tag} B` }, { title: `${tag} C` }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await expect(notesPage.noteCard(`${tag} A`)).toBeVisible();

    // Default order: most recent (highest position) first → C, B, A.
    expect((await taggedTitles(notesPage, tag))[0]).toBe(`${tag} C`);

    await openMoreActionsAndClickPinToggle(notesPage, `${tag} A`);

    // First wait for the pin flag to appear on the card — Playwright auto-retries.
    await expect(notesPage.noteCard(`${tag} A`).getByTestId('pin-flag')).toBeVisible();

    // Then wait for the refetch to land and re-sort the grid.
    await expect.poll(async () => (await taggedTitles(notesPage, tag))[0]).toBe(`${tag} A`);
  });

  test('unpin via menu drops the note back into chronological order', async ({ page }) => {
    const { account } = makeAccount();
    const tag = `unpin-${Date.now()}`;
    await seedNotes(account.address, [
      { title: `${tag} A`, pinned: true },
      { title: `${tag} B` },
      { title: `${tag} C` },
    ]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await expect(notesPage.noteCard(`${tag} A`)).toBeVisible();

    // Initially A is pinned and at the top.
    expect((await taggedTitles(notesPage, tag))[0]).toBe(`${tag} A`);

    await openMoreActionsAndClickPinToggle(notesPage, `${tag} A`);

    // Flag should disappear (auto-retries).
    await expect(notesPage.noteCard(`${tag} A`).getByTestId('pin-flag')).toHaveCount(0);

    // After refetch the new order is C, B, A.
    await expect.poll(async () => taggedTitles(notesPage, tag)).toEqual([`${tag} C`, `${tag} B`, `${tag} A`]);
  });

  test('two pinned notes both appear before any unpinned note', async ({ page }) => {
    const { account } = makeAccount();
    const tag = `pin-two-${Date.now()}`;
    await seedNotes(account.address, [
      { title: `${tag} P1`, pinned: true },
      { title: `${tag} U1` },
      { title: `${tag} P2`, pinned: true },
      { title: `${tag} U2` },
    ]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await expect(notesPage.noteCard(`${tag} P1`)).toBeVisible();

    const order = await taggedTitles(notesPage, tag);
    const firstUnpinnedIdx = order.findIndex((t) => t.includes('U'));
    const pinnedBeforeUnpinned = order.slice(0, firstUnpinnedIdx).every((t) => t.includes('P'));
    expect(pinnedBeforeUnpinned).toBe(true);
    expect(firstUnpinnedIdx).toBe(2);
  });

  test('pinned persists across reload', async ({ page }) => {
    const { account } = makeAccount();
    const tag = `pin-reload-${Date.now()}`;
    const [seededA] = await seedNotes(account.address, [{ title: `${tag} A` }, { title: `${tag} B` }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await expect(notesPage.noteCard(`${tag} A`)).toBeVisible();

    await openMoreActionsAndClickPinToggle(notesPage, `${tag} A`);

    // Verify via API that the PATCH persisted (source of truth, no UI/cache race).
    await expect
      .poll(async () => {
        const res = await page.request.get('/api/notes');
        const notes = (await res.json()) as { _id: string; pinned: boolean }[];
        return notes.find((n) => n._id === seededA._id.toString())?.pinned;
      })
      .toBe(true);

    // Reload and verify the UI reflects the same.
    await page.reload();
    await expect(notesPage.noteCard(`${tag} A`)).toBeVisible();
    await expect(notesPage.noteCard(`${tag} A`).getByTestId('pin-flag')).toBeVisible();
    // Order can lag the UI by a refetch; poll until the grid re-sorts.
    await expect.poll(async () => (await taggedTitles(notesPage, tag))[0]).toBe(`${tag} A`);
  });

  test('pinned note keeps the flag and shows at top of the archive view', async ({ page }) => {
    const { account } = makeAccount();
    const tag = `pin-arch-${Date.now()}`;
    await seedNotes(account.address, [
      { title: `${tag} arch-pinned`, archived: true, pinned: true },
      { title: `${tag} arch-plain`, archived: true },
    ]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await page.goto('/archive');

    await expect(notesPage.noteCard(`${tag} arch-pinned`)).toBeVisible();
    await expect(notesPage.noteCard(`${tag} arch-pinned`).getByTestId('pin-flag')).toBeVisible();

    expect((await taggedTitles(notesPage, tag))[0]).toBe(`${tag} arch-pinned`);
  });

  test('pin survives an archive → unarchive cycle', async ({ page }) => {
    const { account } = makeAccount();
    const tag = `pin-cycle-${Date.now()}`;
    const [seeded] = await seedNotes(account.address, [{ title: `${tag} A`, pinned: true }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await expect(notesPage.noteCard(`${tag} A`)).toBeVisible();

    // Archive + unarchive via API — we're testing pin persistence, not the
    // archive UI (covered by notes.spec.ts).
    const archiveRes = await page.request.patch(`/api/notes/${seeded._id.toString()}`, {
      data: { archived: true },
    });
    expect(archiveRes.ok()).toBe(true);
    const restoreRes = await page.request.patch(`/api/notes/${seeded._id.toString()}`, {
      data: { archived: false },
    });
    expect(restoreRes.ok()).toBe(true);

    await page.reload();
    await expect(notesPage.noteCard(`${tag} A`)).toBeVisible();
    await expect(notesPage.noteCard(`${tag} A`).getByTestId('pin-flag')).toBeVisible();
  });
});
