import { test, expect, type Page } from '@playwright/test';
import { makeAccount } from '../utils/makeAccount';
import { createTestSession } from '../utils/createTestSession';
import { injectSession } from '../utils/injectSession';
import { seedNotes } from '../fixtures/seedNotes';
import { NotesPage } from '../pages/NotesPage';
import { clearSession } from '../utils/clearSession';

test.describe.configure({ mode: 'parallel' });

// Perform a desktop drag: mousedown → 8px activation move → move to target → mouseup.
// Set up patchDone BEFORE calling this so the waitForResponse is already listening.
const startDrag = async (page: Page, sourceTitle: string, targetTitle: string) => {
  const notesPage = new NotesPage(page);
  const sourceBox = await notesPage.noteCard(sourceTitle).boundingBox();
  const targetBox = await notesPage.noteCard(targetTitle).boundingBox();
  if (!sourceBox || !targetBox) throw new Error('Card bounding box not found');
  const sx = sourceBox.x + sourceBox.width / 2;
  const sy = sourceBox.y + sourceBox.height / 2;
  const tx = targetBox.x + targetBox.width / 2;
  const ty = targetBox.y + targetBox.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 15, sy, { steps: 5 }); // cross 8px PointerSensor threshold
  await page.mouse.move(tx, ty, { steps: 20 });
  return { tx, ty };
};

const dragCard = async (page: Page, sourceTitle: string, targetTitle: string) => {
  const patchDone = page.waitForResponse((r) => r.url().includes('/api/notes/') && r.request().method() === 'PATCH');
  await startDrag(page, sourceTitle, targetTitle);
  await page.mouse.up();
  await patchDone;
};

// ─── Desktop Tests (3-column layout) ─────────────────────────────────────────

test.describe('desktop reorder', () => {
  test.use({ viewport: { width: 1200, height: 800 } });

  // ─── Test 1: Cross-row drag (mixed card heights) ──────────────────────────

  test('cross-row drag: note 5 to note 2 position (short row 1, tall row 2)', async ({ page }) => {
    const notesPage = new NotesPage(page);
    const { address } = await notesPage.signInDirectly();
    const tag = `cr${Date.now()}`;
    const longContent = Array.from({ length: 10 }, (_, i) => `<p>paragraph ${i + 1}</p>`).join('');

    // Seed reversed so UI visual order is Note 1 … Note 6.
    // Positions: Note 6=1000, Note 5=2000, Note 4=3000, Note 3=4000, Note 2=5000, Note 1=6000
    await seedNotes(address, [
      { title: `${tag} Note 6`, content: longContent },
      { title: `${tag} Note 5`, content: longContent },
      { title: `${tag} Note 4`, content: longContent },
      { title: `${tag} Note 3`, content: '<p>123</p>' },
      { title: `${tag} Note 2`, content: '<p>123</p>' },
      { title: `${tag} Note 1`, content: '<p>123</p>' },
    ]);

    await clearSession(page);
    await page.reload();
    await expect(notesPage.noteCard(`${tag} Note 1`)).toBeVisible({ timeout: 10000 });

    // Confirm 3-column layout
    const cols = await page.locator('main').evaluate((el) => {
      const grid = el.querySelector('[class*="grid"]');
      return grid ? getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length : 0;
    });
    expect(cols).toBe(3);

    // Drag Note 5 (row 2, col 2) onto Note 2 (row 1, col 2)
    await dragCard(page, `${tag} Note 5`, `${tag} Note 2`);

    await expect(page.getByTestId('note-card').locator('h3')).toHaveText([
      `${tag} Note 1`,
      `${tag} Note 5`,
      `${tag} Note 2`,
      `${tag} Note 3`,
      `${tag} Note 4`,
      `${tag} Note 6`,
    ]);

    // Confirm server state (API returns notes sorted by position desc)
    const resp = await page.request.get('/api/notes');
    const notes = await resp.json();
    const titles = notes.map((n: { title: string }) => n.title).filter((t: string) => t.startsWith(tag));
    expect(titles).toEqual([
      `${tag} Note 1`,
      `${tag} Note 5`,
      `${tag} Note 2`,
      `${tag} Note 3`,
      `${tag} Note 4`,
      `${tag} Note 6`,
    ]);
  });

  // ─── Test 2: Drag last card to first (9 equal notes) ─────────────────────

  test('drag last card to first position (9 equal notes)', async ({ page }) => {
    const notesPage = new NotesPage(page);
    const { address } = await notesPage.signInDirectly();
    const tag = `last${Date.now()}`;

    // Seed reversed: i=0 → Note 9 (position 1000), i=8 → Note 1 (position 9000)
    // UI order (descending position): Note 1, Note 2, …, Note 9
    await seedNotes(
      address,
      Array.from({ length: 9 }, (_, i) => ({ title: `${tag} Note ${9 - i}` })),
    );

    await clearSession(page);
    await page.reload();
    await expect(notesPage.noteCard(`${tag} Note 1`)).toBeVisible({ timeout: 10000 });

    await dragCard(page, `${tag} Note 9`, `${tag} Note 1`);

    await expect(page.getByTestId('note-card').locator('h3')).toHaveText([
      `${tag} Note 9`,
      `${tag} Note 1`,
      `${tag} Note 2`,
      `${tag} Note 3`,
      `${tag} Note 4`,
      `${tag} Note 5`,
      `${tag} Note 6`,
      `${tag} Note 7`,
      `${tag} Note 8`,
    ]);
  });

  // ─── Test 3: Preview switches before drop (no drop, desktop) ─────────────

  test('drag preview: cards switch places before drop', async ({ page }) => {
    const notesPage = new NotesPage(page);
    const { address } = await notesPage.signInDirectly();
    const tag = `prev${Date.now()}`;

    // Seed reversed: Note 3=1000, Note 2=2000, Note 1=3000
    // UI order: Note 1 (col 1), Note 2 (col 2), Note 3 (col 3)
    await seedNotes(address, [{ title: `${tag} Note 3` }, { title: `${tag} Note 2` }, { title: `${tag} Note 1` }]);

    await clearSession(page);
    await page.reload();
    await expect(notesPage.noteCard(`${tag} Note 1`)).toBeVisible({ timeout: 10000 });

    // Start dragging Note 2 toward Note 1 — do NOT release mouse
    await startDrag(page, `${tag} Note 2`, `${tag} Note 1`);

    // 1. The dragged card's wrapper has opacity 0.4 (placeholder ghost in place)
    const hasGhost = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="note-card"]')).some(
        (c) => (c.parentElement as HTMLElement)?.style.opacity === '0.4',
      ),
    );
    expect(hasGhost).toBe(true);

    // 2. At least one card has a non-zero CSS transform (preview shift)
    const hasShift = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="note-card"]')).some((c) => {
        const t = (c.parentElement as HTMLElement)?.style.transform;
        return t && t !== 'none' && !t.startsWith('translate3d(0px, 0px');
      }),
    );
    expect(hasShift).toBe(true);

    // 3. DragOverlay portal is present — a fixed-positioned ancestor wraps a note-card.
    // dnd-kit renders: body > portal-div > div[position:fixed] > card, so walk up from cards.
    const hasOverlay = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="note-card"]')).some((card) => {
        let el: Element | null = card;
        while (el && el !== document.body) {
          if ((el as HTMLElement).style?.position === 'fixed') return true;
          el = el.parentElement;
        }
        return false;
      }),
    );
    expect(hasOverlay).toBe(true);

    // Cleanup — release mouse (PATCH may or may not fire; we don't assert on order here)
    await page.mouse.up();
  });

  // ─── Test 4: Two sequential reorders ─────────────────────────────────────

  test('two sequential reorders: 1,2,3,4,5,6 → 1,3,2,4,5,6 → 3,1,2,4,5,6', async ({ page }) => {
    const notesPage = new NotesPage(page);
    const { address } = await notesPage.signInDirectly();
    const tag = `seq${Date.now()}`;

    // Seed reversed: Note 6=1000 … Note 1=6000
    // UI order: Note 1, Note 2, Note 3, Note 4, Note 5, Note 6
    await seedNotes(
      address,
      Array.from({ length: 6 }, (_, i) => ({ title: `${tag} Note ${6 - i}` })),
    );

    await clearSession(page);
    await page.reload();
    await expect(notesPage.noteCard(`${tag} Note 1`)).toBeVisible({ timeout: 10000 });

    // First reorder: drag Note 3 → Note 2 position → order 1,3,2,4,5,6
    await dragCard(page, `${tag} Note 3`, `${tag} Note 2`);
    await expect(page.getByTestId('note-card').locator('h3')).toHaveText([
      `${tag} Note 1`,
      `${tag} Note 3`,
      `${tag} Note 2`,
      `${tag} Note 4`,
      `${tag} Note 5`,
      `${tag} Note 6`,
    ]);

    // Second reorder: drag Note 3 (now at index 1) → Note 1 (index 0) → order 3,1,2,4,5,6
    await dragCard(page, `${tag} Note 3`, `${tag} Note 1`);
    await expect(page.getByTestId('note-card').locator('h3')).toHaveText([
      `${tag} Note 3`,
      `${tag} Note 1`,
      `${tag} Note 2`,
      `${tag} Note 4`,
      `${tag} Note 5`,
      `${tag} Note 6`,
    ]);
  });
});

// ─── Mobile Tests ─────────────────────────────────────────────────────────────

test.describe('mobile reorder', () => {
  test.use({ viewport: { width: 400, height: 812 } });

  const setup = async (page: Page) => {
    const { account } = makeAccount();
    const token = await createTestSession(account.address);
    await injectSession(page, token);
    await page.goto('/');
    return { address: account.address };
  };

  // ─── Test 5: Tap + immediate drag scrolls window, does not reorder ────────

  test('tap + immediate drag does not activate reorder (no 200ms hold)', async ({ page }) => {
    const { address } = await setup(page);
    const tag = `mob5${Date.now()}`;

    // Seed reversed: Note 6=1000 … Note 1=6000 (enough notes to scroll)
    await seedNotes(
      address,
      Array.from({ length: 6 }, (_, i) => ({ title: `${tag} Note ${6 - i}` })),
    );

    await clearSession(page);
    await page.reload();

    const notesPage = new NotesPage(page);
    await expect(notesPage.noteCard(`${tag} Note 1`)).toBeVisible({ timeout: 10000 });

    let patchFired = false;
    page.on('request', (req) => {
      if (req.url().includes('/api/notes/') && req.method() === 'PATCH') patchFired = true;
    });

    const box = await notesPage.noteCard(`${tag} Note 1`).boundingBox();
    if (!box) throw new Error('Card not found');
    const sx = box.x + box.width / 2;
    const sy = box.y + box.height / 2;

    // Dispatch all three events synchronously (no 200ms gap) with >5px movement.
    // This exceeds the TouchSensor tolerance before the delay completes → no drag.
    await page.evaluate(
      ({ sx, sy }) => {
        const el = document.elementFromPoint(sx, sy)!;
        const mkT = (x: number, y: number) =>
          new Touch({
            identifier: 1,
            target: el,
            clientX: x,
            clientY: y,
            radiusX: 1,
            radiusY: 1,
            rotationAngle: 0,
            force: 1,
          });
        el.dispatchEvent(
          new TouchEvent('touchstart', {
            touches: [mkT(sx, sy)],
            changedTouches: [mkT(sx, sy)],
            bubbles: true,
            cancelable: true,
          }),
        );
        el.dispatchEvent(
          new TouchEvent('touchmove', {
            touches: [mkT(sx, sy + 30)],
            changedTouches: [mkT(sx, sy + 30)],
            bubbles: true,
            cancelable: true,
          }),
        );
        el.dispatchEvent(
          new TouchEvent('touchend', {
            touches: [],
            changedTouches: [mkT(sx, sy + 30)],
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      { sx, sy },
    );

    await page.waitForTimeout(500);
    expect(patchFired).toBe(false);
  });

  // ─── Test 6: Drag reorders cards on mobile ───────────────────────────────
  // Uses pointer events (PointerSensor is active alongside TouchSensor in BaseGrid).
  // Touch-specific activation delay is covered by test 5.

  test('drag reorders cards on mobile viewport', async ({ page }) => {
    const { address } = await setup(page);
    const tag = `mob6${Date.now()}`;

    // Seed reversed: Note 3=1000, Note 2=2000, Note 1=3000
    // UI order: Note 1, Note 2, Note 3
    await seedNotes(address, [{ title: `${tag} Note 3` }, { title: `${tag} Note 2` }, { title: `${tag} Note 1` }]);

    await clearSession(page);
    await page.reload();

    const notesPage = new NotesPage(page);
    await expect(notesPage.noteCard(`${tag} Note 1`)).toBeVisible({ timeout: 10000 });

    await dragCard(page, `${tag} Note 1`, `${tag} Note 2`);

    await expect(page.getByTestId('note-card').locator('h3')).toHaveText([
      `${tag} Note 2`,
      `${tag} Note 1`,
      `${tag} Note 3`,
    ]);
  });

  // ─── Test 7: Drag preview switches (no drop, mobile) ─────────────────────

  test('drag preview: cards switch places before drop on mobile', async ({ page }) => {
    const { address } = await setup(page);
    const tag = `mob7${Date.now()}`;

    // Seed reversed: Note 3=1000, Note 2=2000, Note 1=3000
    // UI order: Note 1, Note 2, Note 3
    await seedNotes(address, [{ title: `${tag} Note 3` }, { title: `${tag} Note 2` }, { title: `${tag} Note 1` }]);

    await clearSession(page);
    await page.reload();

    const notesPage = new NotesPage(page);
    await expect(notesPage.noteCard(`${tag} Note 1`)).toBeVisible({ timeout: 10000 });

    // Start dragging Note 1 toward Note 2 — do NOT release
    await startDrag(page, `${tag} Note 1`, `${tag} Note 2`);

    // 1. Dragged card's wrapper has opacity 0.4 (placeholder ghost in place)
    const hasGhost = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="note-card"]')).some(
        (c) => (c.parentElement as HTMLElement)?.style.opacity === '0.4',
      ),
    );
    expect(hasGhost).toBe(true);

    // 2. At least one card has a non-zero CSS transform (preview shift)
    const hasShift = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="note-card"]')).some((c) => {
        const t = (c.parentElement as HTMLElement)?.style.transform;
        return t && t !== 'none' && !t.startsWith('translate3d(0px, 0px');
      }),
    );
    expect(hasShift).toBe(true);

    // 3. DragOverlay portal present — fixed-positioned ancestor wraps a note-card
    const hasOverlay = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="note-card"]')).some((card) => {
        let el: Element | null = card;
        while (el && el !== document.body) {
          if ((el as HTMLElement).style?.position === 'fixed') return true;
          el = el.parentElement;
        }
        return false;
      }),
    );
    expect(hasOverlay).toBe(true);

    // Cleanup — release mouse to reset dnd-kit state
    await page.mouse.up();
  });
});
