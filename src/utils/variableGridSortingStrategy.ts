import { arrayMove } from '@dnd-kit/sortable';
import type { ClientRect } from '@dnd-kit/core';
import type { SortingStrategy } from '@dnd-kit/sortable';

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

type ItemHeights = readonly number[] | null | undefined;

/**
 * Measure what each grid item needs before CSS Grid stretches it to the height
 * of the tallest card in its row. The style change and both layouts happen in
 * one JavaScript task, so the temporary unstretched grid is never painted.
 */
export function measureNaturalGridItemHeights(grid: HTMLElement | null): number[] | null {
  if (!grid) return null;

  const previousAlignItems = grid.style.alignItems;
  let heights: number[];
  try {
    grid.style.alignItems = 'start';
    heights = Array.from(grid.children, (child) => child.getBoundingClientRect().height);
  } finally {
    grid.style.alignItems = previousAlignItems;
  }

  return heights.every((height) => height > 0) ? heights : null;
}

/** Bind one grid's drag-time measurements to dnd-kit's strategy callback. */
export function createVariableGridSortingStrategy(itemHeights: ItemHeights): SortingStrategy {
  return (args) => variableGridSortingStrategy(args, itemHeights);
}

/**
 * Where each card should sit while a drag is previewing the new order.
 *
 * The cards are variable height and the grid stretches every card in a row to the
 * tallest one, so a row's height — and therefore the top of every row after it —
 * depends on *which* cards land in it. That means the preview cannot reuse the
 * pre-drag rects as slots: translating a card onto the rect of whichever card used
 * to occupy its new slot is only correct while all rows happen to be equally tall,
 * and drifts into overlapping cards as soon as they are not. The measured rects
 * also cannot reveal a card's own height because every item in a CSS Grid row has
 * already been stretched. Instead, lay the grid out again from drag-start intrinsic
 * heights and resize each preview surface to the row it will actually occupy.
 */
export function variableGridSortingStrategy({ activeIndex, overIndex, index, rects }: Args, itemHeights?: ItemHeights) {
  if (activeIndex === overIndex || activeIndex < 0 || overIndex < 0) return null;

  const currentRect = rects[index];
  if (!currentRect) return null;

  // Column geometry is derived from the rects rather than the breakpoints, so this
  // stays correct at 1, 2, 3 and 4 columns without knowing the media queries: every
  // card in a column shares a left edge, so the distinct left edges are the columns.
  const columnLefts = rects
    .filter((r): r is ClientRect => r != null)
    .map((r) => r.left)
    .sort((a, b) => a - b)
    .filter((left, index, lefts) => index === 0 || Math.abs(left - lefts[index - 1]) > 0.5);
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

  const rowHeights: number[] = [];
  for (let slot = 0; slot < n; slot++) {
    const itemIndex = order[slot];
    const height = itemHeights?.[itemIndex] ?? rects[itemIndex]?.height ?? 0;
    const row = Math.floor(slot / cols);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, height);
  }

  const targetRow = Math.floor(newIndex / cols);
  let targetTop = firstRow.top;
  for (let row = 0; row < targetRow; row++) {
    targetTop += rowHeights[row] + gap;
  }

  const targetHeight = rowHeights[targetRow] || currentRect.height;

  return {
    x: columnLefts[newIndex % cols] - currentRect.left,
    y: targetTop - currentRect.top,
    scaleX: 1,
    // SortableWrapper interprets scaleY as a requested box height, not a CSS
    // scale, so the surface resizes without stretching its text and icons.
    scaleY: targetHeight / currentRect.height,
  };
}
