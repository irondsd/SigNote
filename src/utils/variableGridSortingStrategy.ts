import { arrayMove } from '@dnd-kit/sortable';
import type { ClientRect } from '@dnd-kit/core';

const GAP = 12;

export function variableGridSortingStrategy(args: {
  activeNodeRect: ClientRect | null;
  activeIndex: number;
  index: number;
  rects: (ClientRect | null)[];
  overIndex: number;
}) {
  const { activeIndex, overIndex, index, rects } = args;
  if (activeIndex === overIndex) return null;
  const currentRect = rects[index];
  if (!currentRect) return null;

  const n = rects.length;
  const newOrder = arrayMove([...Array(n).keys()], activeIndex, overIndex);
  const newIdx = newOrder.indexOf(index);

  // Detect column count from first row
  const firstTop = rects[0]?.top;
  let cols = 1;
  if (firstTop != null) {
    for (let i = 1; i < n; i++) {
      if (rects[i]?.top === firstTop) cols++;
      else break;
    }
  }

  if (cols === 1) {
    // Single column: compute cumulative heights for accurate positioning
    let newY = rects[0]?.top ?? 0;
    for (let k = 0; k < newIdx; k++) {
      newY += (rects[newOrder[k]]?.height ?? 0) + GAP;
    }
    return { x: 0, y: newY - currentRect.top, scaleX: 1, scaleY: 1 };
  }

  // Multi-column: use rect positions directly
  const targetRect = rects[newIdx];
  if (!targetRect) return null;

  return {
    x: targetRect.left - currentRect.left,
    y: targetRect.top - currentRect.top,
    scaleX: 1,
    scaleY: 1,
  };
}
