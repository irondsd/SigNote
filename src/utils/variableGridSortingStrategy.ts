import { arrayMove } from '@dnd-kit/sortable';
import type { ClientRect } from '@dnd-kit/core';

const GAP = 12;

type Transform = { x: number; y: number; scaleX?: number; scaleY?: number };

export function variableGridSortingStrategy(args: {
  activeNodeRect: ClientRect | null;
  activeIndex: number;
  index: number;
  rects: (ClientRect | null)[];
  overIndex: number;
}): Transform | null {
  const { activeIndex, overIndex, index, rects } = args;
  if (activeIndex === overIndex) return null;
  const currentRect = rects[index];
  if (!currentRect) return null;

  const n = rects.length;
  const newOrder = arrayMove([...Array(n).keys()], activeIndex, overIndex);
  const newIdx = newOrder.indexOf(index);

  // Cumulative y: item at new position k starts after sum of previous items' heights + gaps
  let newY = rects[0]?.top ?? 0;
  for (let k = 0; k < newIdx; k++) {
    newY += (rects[newOrder[k]]?.height ?? 0) + GAP;
  }

  return { x: 0, y: newY - currentRect.top };
}
