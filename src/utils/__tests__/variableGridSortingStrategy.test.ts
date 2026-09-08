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

  it('returns null when there is no drop target', () => {
    const rects = [rect(0, 0), rect(0, 212), rect(112, 0)];
    const result = variableGridSortingStrategy({
      activeNodeRect: rects[0],
      activeIndex: 0,
      index: 2,
      rects,
      overIndex: -1,
    });
    expect(result).toBeNull();
  });

  describe('with rows of differing heights', () => {
    // Two columns, 12px gap. Each row is as tall as its tallest card, so the rows
    // start at 0, 112 and 324 — the geometry that used to break the preview.
    const rects = [
      rect(0, 0, 200, 100), // 0 A
      rect(0, 212, 200, 100), // 1 B
      rect(112, 0, 200, 200), // 2 C
      rect(112, 212, 200, 200), // 3 D
      rect(324, 0, 200, 50), // 4 E
      rect(324, 212, 200, 50), // 5 F
    ];

    // Dragging A to the last slot reorders to B C D E F A, which makes row one
    // 200 tall (C) and row two 200 tall (D) — so every row below shifts.
    const move = (index: number) =>
      variableGridSortingStrategy({ activeNodeRect: rects[0], activeIndex: 0, index, rects, overIndex: 5 });

    it('lays every card out against the reordered row heights', () => {
      expect(move(0)).toMatchObject({ x: 212, y: 424 }); // A -> row 2, col 1
      expect(move(1)).toMatchObject({ x: -212, y: 0 }); // B -> row 0, col 0
      expect(move(2)).toMatchObject({ x: 212, y: -112 }); // C -> row 0, col 1
      expect(move(3)).toMatchObject({ x: -212, y: 100 }); // D -> row 1, col 0
      expect(move(4)).toMatchObject({ x: 212, y: -112 }); // E -> row 1, col 1
      expect(move(5)).toMatchObject({ x: -212, y: 100 }); // F -> row 2, col 0
    });

    it('never overlaps two cards in the same column', () => {
      const boxes = rects.map((r, index) => {
        const t = move(index)!;
        return { left: r.left + t.x, top: r.top + t.y, bottom: r.top + t.y + r.height };
      });

      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          if (a.left !== b.left) continue;
          expect(a.top < b.bottom && b.top < a.bottom).toBe(false);
        }
      }
    });
  });
});
