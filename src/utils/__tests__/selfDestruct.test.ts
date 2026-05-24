import { formatExpiry, formatRemaining, isSameDay, toTimeString } from '../selfDestruct';

describe('toTimeString', () => {
  it('zero-pads hours and minutes', () => {
    const d = new Date(2026, 0, 1, 3, 5);
    expect(toTimeString(d)).toBe('03:05');
  });

  it('handles end-of-day', () => {
    const d = new Date(2026, 0, 1, 23, 59);
    expect(toTimeString(d)).toBe('23:59');
  });

  it('handles midnight', () => {
    const d = new Date(2026, 0, 1, 0, 0);
    expect(toTimeString(d)).toBe('00:00');
  });
});

describe('isSameDay', () => {
  it('returns true for the same calendar day at different times', () => {
    const a = new Date(2026, 4, 24, 0, 0);
    const b = new Date(2026, 4, 24, 23, 59);
    expect(isSameDay(a, b)).toBe(true);
  });

  it('returns false for adjacent days', () => {
    const a = new Date(2026, 4, 24, 23, 59);
    const b = new Date(2026, 4, 25, 0, 0);
    expect(isSameDay(a, b)).toBe(false);
  });

  it('returns false for same day in different months', () => {
    const a = new Date(2026, 4, 24);
    const b = new Date(2026, 5, 24);
    expect(isSameDay(a, b)).toBe(false);
  });

  it('returns false for same day in different years', () => {
    const a = new Date(2025, 4, 24);
    const b = new Date(2026, 4, 24);
    expect(isSameDay(a, b)).toBe(false);
  });
});

describe('formatRemaining', () => {
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-24T12:00:00Z'));
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  it('returns "now" when the target has already passed', () => {
    const past = new Date(Date.now() - 60_000);
    expect(formatRemaining(past)).toBe('now');
  });

  it('returns "now" exactly at the target', () => {
    expect(formatRemaining(new Date(Date.now()))).toBe('now');
  });

  it('returns minutes for < 1 hour', () => {
    const target = new Date(Date.now() + 5 * 60_000);
    expect(formatRemaining(target)).toBe('5m');
  });

  it('returns whole hours when minutes are zero', () => {
    const target = new Date(Date.now() + 3 * 60 * 60_000);
    expect(formatRemaining(target)).toBe('3h');
  });

  it('returns hours and minutes when both are nonzero', () => {
    const target = new Date(Date.now() + (2 * 60 + 15) * 60_000);
    expect(formatRemaining(target)).toBe('2h 15m');
  });

  it('returns whole days when remainder hours are zero', () => {
    const target = new Date(Date.now() + 2 * 24 * 60 * 60_000);
    expect(formatRemaining(target)).toBe('2d');
  });

  it('returns days and hours when remainder is nonzero', () => {
    const target = new Date(Date.now() + (2 * 24 + 5) * 60 * 60_000);
    expect(formatRemaining(target)).toBe('2d 5h');
  });

  it('accepts an ISO string', () => {
    const target = new Date(Date.now() + 60 * 60_000).toISOString();
    expect(formatRemaining(target)).toBe('1h');
  });
});

describe('formatExpiry', () => {
  it('returns a non-empty localized string', () => {
    const d = new Date('2026-05-24T14:30:00Z');
    const out = formatExpiry(d);
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });

  it('accepts an ISO string', () => {
    expect(() => formatExpiry('2026-05-24T14:30:00Z')).not.toThrow();
  });
});
