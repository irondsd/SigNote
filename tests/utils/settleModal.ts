import { expect, type Page } from '@playwright/test';

/**
 * Waits for an open modal to stop moving and resizing before anything inside it
 * is clicked.
 *
 * Two things change a note modal's geometry after it first paints: the ~350ms
 * entrance transform, and Tiptap — which builds its DOM in an effect
 * (`immediatelyRender: false`), so the body grows by the whole height of the
 * editor a frame or more after the modal is already visible. The backdrop
 * centres the modal, so that growth moves every footer button down by half the
 * delta — tens of pixels, more than an icon button is tall.
 *
 * Playwright's own actionability check only compares two consecutive frames, so
 * a shift that lands between the check and the dispatched event slips through:
 * the mousedown hits the button, the mouseup hits whatever moved under the
 * cursor, and the browser fires `click` on their common ancestor. The click
 * reports success, the React handler never runs, and the test waits out its
 * timeout on a mutation that was never sent.
 */
export async function settleModal(page: Page): Promise<void> {
  const modal = page.getByTestId('note-modal');
  await expect(modal).toBeVisible();
  await modal.evaluate(async (el) => {
    let previous = -1;
    let stable = 0;
    for (let i = 0; i < 180; i++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const animating = el.getAnimations({ subtree: true }).some((a) => a.playState === 'running');
      const { height, top } = el.getBoundingClientRect();
      const settled = Math.abs(height + top - previous) < 0.5;
      stable = !animating && settled ? stable + 1 : 0;
      previous = height + top;
      if (stable >= 6) return;
    }
  });
}

/**
 * Opens the note-style picker and picks one swatch by its title.
 *
 * The picker expands inside the same centred modal, so opening it moves
 * everything in the modal by half its height — the swatches included. Picking
 * one before that settles loses the click exactly as described above, and the
 * only symptom is a colour or pattern that never reaches the server.
 */
export async function pickNoteStyle(page: Page, swatch: string): Promise<void> {
  await settleModal(page);
  await page.getByTitle('Note style').click();
  await expect(page.getByTitle(swatch)).toBeVisible();
  await settleModal(page);
  await page.getByTitle(swatch).click();
}
