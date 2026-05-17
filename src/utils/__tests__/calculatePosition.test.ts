import { calculatePosition } from '@/utils/calculatePosition';
import { POSITION_STEP } from '@/config/constants';

describe('calculatePosition', () => {
  it('returns POSITION_STEP when both neighbors are null', () => {
    expect(calculatePosition(null, null)).toBe(POSITION_STEP);
  });

  it('returns below + POSITION_STEP when dropping at top (above is null)', () => {
    expect(calculatePosition(null, 500)).toBe(500 + POSITION_STEP);
  });

  it('returns above / 2 when dropping at bottom (below is null)', () => {
    expect(calculatePosition(200, null)).toBe(100);
  });

  it('returns midpoint when both neighbors exist', () => {
    expect(calculatePosition(1000, 500)).toBe(750);
  });

  it('handles adjacent positions', () => {
    expect(calculatePosition(101, 100)).toBe(100.5);
  });
});
