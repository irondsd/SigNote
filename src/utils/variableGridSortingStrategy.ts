import { arrayMove } from '@dnd-kit/sortable';
import type { ClientRect } from '@dnd-kit/core';

// Only used if the gap cannot be read off the measured rects (a single-row grid).
// Keep in step with `gap` in styles/_grid.scss.
const FALLBACK_GAP = 12;

type Args = {
  activeNodeRect: ClientRect | null;
  activeIndex: number;
  index: number;
  rects: (ClientRect | null)[];
  overIndex: number;
};

/**
 * Where each card should sit while a drag is previewing the new order.
 *
 * The cards are variable height and the grid stretches every card in a row to the
 * tallest one, so a row's height — and therefore the top of every row after it —
 * depends on *which* cards land in it. That means the preview cannot reuse the
 * pre-drag rects as slots: translating a card onto the rect of whichever card used
 * to occupy its new slot is only correct while all rows happen to be equally tall,
 * and drifts into overlapping cards as soon as they are not. Instead, lay the grid
 * out again from the reordered card list and translate each card to where it will
 * actually end up.
 */
export function variableGridSortingStrategy({ activeIndex, overIndex, index, rects }: Args) {
  if (activeIndex === overIndex || activeIndex < 0 || overIndex < 0) return null;

  const currentRect = rects[index];
  if (!currentRect) return null;

  // Column geometry is derived from the rects rather than the breakpoints, so this
  // stays correct at 1, 2, 3 and 4 columns without knowing the media queries: every
  // card in a column shares a left edge, so the distinct left edges are the columns.
  const columnLefts = [...new Set(rects.filter((r): r is ClientRect => r != null).map((r) => Math.round(r.left)))].sort(
    (a, b) => a - b,
  );
  const cols = columnLefts.length;
  if (cols === 0) return null;

  const n = rects.length;
  const firstRow = rects.find((r): r is ClientRect => r != null);
  if (!firstRow) return null;

  // Measure the row gap instead of assuming it: row one's cards are all stretched to
  // the row height, so the distance from their bottom to row two's top is the gap.
  const secondRowTop = rects[cols]?.top;
  const gap = secondRowTop != null ? Math.max(0, secondRowTop - firstRow.bottom) : FALLBACK_GAP;

  const order = arrayMove([...Array(n).keys()], activeIndex, overIndex);
  const newIndex = order.indexOf(index);
  if (newIndex === -1) return null;

  const targetRow = Math.floor(newIndex / cols);
  let targetTop = firstRow.top;
  for (let row = 0; row < targetRow; row++) {
    let rowHeight = 0;
    for (let col = 0; col < cols; col++) {
      const slot = row * cols + col;
      if (slot >= n) break;
      rowHeight = Math.max(rowHeight, rects[order[slot]]?.height ?? 0);
    }
    targetTop += rowHeight + gap;
  }

  return {
    x: columnLefts[newIndex % cols] - currentRect.left,
    y: targetTop - currentRect.top,
    scaleX: 1,
    scaleY: 1,
  };
}
