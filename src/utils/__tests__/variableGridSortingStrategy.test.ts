import { variableGridSortingStrategy } from '@/utils/variableGridSortingStrategy';
import type { ClientRect } from '@dnd-kit/core';

function rect(top: number, left: number, width = 200, height = 100): ClientRect {
  return { top, left, width, height, right: left + width, bottom: top + height };
}

describe('variableGridSortingStrategy', () => {
  it('returns null when activeIndex equals overIndex', () => {
    const rects = [rect(0, 0), rect(0, 212), rect(100, 0)];
    const result = variableGridSortingStrategy({
      activeNodeRect: rects[0],
      activeIndex: 1,
      index: 0,
      rects,
      overIndex: 1,
    });
    expect(result).toBeNull();
  });

  it('returns null when current rect is null', () => {
    const rects: (ClientRect | null)[] = [rect(0, 0), null, rect(100, 0)];
    const result = variableGridSortingStrategy({
      activeNodeRect: rects[0],
      activeIndex: 0,
      index: 1,
      rects,
      overIndex: 2,
    });
    expect(result).toBeNull();
  });

  it('computes vertical offset for single-column layout', () => {
    const rects = [rect(0, 0, 200, 80), rect(92, 0, 200, 120), rect(224, 0, 200, 80)];
    const result = variableGridSortingStrategy({
      activeNodeRect: rects[0],
      activeIndex: 0,
      index: 2,
      rects,
      overIndex: 2,
    });
    expect(result).not.toBeNull();
    expect(result!.x).toBe(0);
    expect(result!.scaleX).toBe(1);
    expect(result!.scaleY).toBe(1);
  });

  it('computes x and y offsets for multi-column layout', () => {
    const rects = [rect(0, 0), rect(0, 212), rect(112, 0), rect(112, 212)];
    const result = variableGridSortingStrategy({
      activeNodeRect: rects[0],
      activeIndex: 0,
      index: 1,
      rects,
      overIndex: 2,
    });
    expect(result).not.toBeNull();
    expect(result!.scaleX).toBe(1);
    expect(result!.scaleY).toBe(1);
  });
});
