import { POSITION_STEP } from '@/config/constants';
import { calculatePosition } from '@/utils/calculatePosition';
import { compareAuthRecords, isDegeneratePosition, nextAuthPosition, renumberPositions } from '../order';

const rec = (id: string, position: number) => ({ id, position });

/** UUIDv7-shaped, ascending with time so `b` is newer than `a`. */
const ID_A = '019917e0-0000-7000-8000-000000000001';
const ID_B = '019917e0-0000-7000-8000-000000000002';
const ID_C = '019917e0-0000-7000-8000-000000000003';

describe('compareAuthRecords', () => {
  it('sorts highest position first, like the note tiers', () => {
    const sorted = [rec('a', 1000), rec('c', 3000), rec('b', 2000)].sort(compareAuthRecords);
    expect(sorted.map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('is a total order — tied positions never depend on input order', () => {
    // The actual bug: with a comparator that returned 0 here, a stable sort
    // left tied records wherever the input array put them, so rebuilding that
    // array moved the card.
    const forwards = [rec(ID_A, 1000), rec(ID_B, 1000), rec(ID_C, 1000)].sort(compareAuthRecords);
    const backwards = [rec(ID_C, 1000), rec(ID_B, 1000), rec(ID_A, 1000)].sort(compareAuthRecords);
    const shuffled = [rec(ID_B, 1000), rec(ID_A, 1000), rec(ID_C, 1000)].sort(compareAuthRecords);

    expect(forwards.map((r) => r.id)).toEqual(backwards.map((r) => r.id));
    expect(forwards.map((r) => r.id)).toEqual(shuffled.map((r) => r.id));
    // Newer id first, since UUIDv7 sorts with time.
    expect(forwards.map((r) => r.id)).toEqual([ID_C, ID_B, ID_A]);
  });

  it('keeps a record in place when only its style changed', () => {
    // Recolouring rewrites the record but not its position; the rendered order
    // must be byte-identical before and after.
    const before = [rec(ID_C, 3000), rec(ID_B, 2000), rec(ID_A, 1000)];
    const after = before.map((r) => (r.id === ID_B ? { ...r } : r));

    expect([...after].sort(compareAuthRecords).map((r) => r.id)).toEqual(
      [...before].sort(compareAuthRecords).map((r) => r.id),
    );
  });

  it('returns 0 only for the same record', () => {
    expect(compareAuthRecords(rec(ID_A, 1000), rec(ID_A, 1000))).toBe(0);
    expect(compareAuthRecords(rec(ID_A, 1000), rec(ID_B, 1000))).not.toBe(0);
  });
});

describe('nextAuthPosition', () => {
  it('puts the first credential at one step', () => {
    expect(nextAuthPosition([])).toBe(POSITION_STEP);
  });

  it('puts a new credential above everything', () => {
    const records = [rec('a', 1000), rec('b', 2000)];
    const next = nextAuthPosition(records);
    expect(next).toBeGreaterThan(2000);
    expect([...records, rec('new', next)].sort(compareAuthRecords)[0].id).toBe('new');
  });

  it('copes with negative positions left by the old arithmetic', () => {
    expect(nextAuthPosition([rec('a', -2000), rec('b', -1000)])).toBe(-1000 + POSITION_STEP);
  });
});

describe('isDegeneratePosition', () => {
  it('accepts an ordinary midpoint', () => {
    expect(isDegeneratePosition(calculatePosition(2000, 1000), 2000, 1000)).toBe(false);
  });

  it('accepts a drop at either end of a healthy list', () => {
    expect(isDegeneratePosition(calculatePosition(null, 1000), null, 1000)).toBe(false);
    expect(isDegeneratePosition(calculatePosition(1000, null), 1000, null)).toBe(false);
  });

  it('flags neighbours that have collided', () => {
    // No value can sit strictly between two equal positions.
    expect(isDegeneratePosition(calculatePosition(1000, 1000), 1000, 1000)).toBe(true);
  });

  it('flags a drop below a non-positive position', () => {
    // `calculatePosition(above, null)` returns above/2, which only moves the
    // card downwards while `above` is positive.
    expect(isDegeneratePosition(calculatePosition(0, null), 0, null)).toBe(true);
    expect(isDegeneratePosition(calculatePosition(-1000, null), -1000, null)).toBe(true);
  });

  it('flags a midpoint that bisection has ground down to nothing', () => {
    const above = Number.MIN_VALUE * 2;
    const below = Number.MIN_VALUE;
    expect(isDegeneratePosition(calculatePosition(above, below), above, below)).toBe(true);
  });

  it('flags a non-finite position', () => {
    expect(isDegeneratePosition(Number.NaN, 1, 0)).toBe(true);
    expect(isDegeneratePosition(Number.POSITIVE_INFINITY, null, 0)).toBe(true);
  });
});

describe('renumberPositions', () => {
  it('spaces the given order out, descending', () => {
    const items = renumberPositions([rec('c', 1000), rec('b', 1000), rec('a', 1000)]);
    expect(items).toEqual([
      { id: 'c', position: 3000 },
      { id: 'b', position: 2000 },
      { id: 'a', position: 1000 },
    ]);
  });

  it('produces positions that sort back into the same order', () => {
    const order = ['c', 'b', 'a'];
    const items = renumberPositions(order.map((id) => rec(id, 1000)));
    expect([...items].sort(compareAuthRecords).map((r) => r.id)).toEqual(order);
  });

  it('leaves room to drop between any two neighbours', () => {
    const items = renumberPositions([rec('b', 0), rec('a', 0)]);
    const mid = calculatePosition(items[0].position, items[1].position);
    expect(isDegeneratePosition(mid, items[0].position, items[1].position)).toBe(false);
  });
});
