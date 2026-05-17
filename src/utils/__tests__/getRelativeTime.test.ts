import { getRelativeTime } from '@/utils/getRelativeTime';

describe('getRelativeTime', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-06-01T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns "seconds ago" for < 60s', () => {
    const date = new Date('2025-06-01T11:59:30Z');
    expect(getRelativeTime(date)).toBe('seconds ago');
  });

  it('returns minutes for < 1 hour', () => {
    const date = new Date('2025-06-01T11:55:00Z');
    expect(getRelativeTime(date)).toMatch(/5 minutes ago/);
  });

  it('returns hours for < 1 day', () => {
    const date = new Date('2025-06-01T09:00:00Z');
    expect(getRelativeTime(date)).toMatch(/3 hours ago/);
  });

  it('returns days for < 1 week', () => {
    const date = new Date('2025-05-29T12:00:00Z');
    expect(getRelativeTime(date)).toMatch(/3 days ago/);
  });

  it('returns formatted date for > 1 week', () => {
    const date = new Date('2025-05-01T12:00:00Z');
    const result = getRelativeTime(date);
    expect(result).not.toMatch(/ago/);
    expect(result).toMatch(/\d/);
  });

  it('accepts string dates', () => {
    expect(getRelativeTime('2025-06-01T11:59:30Z')).toBe('seconds ago');
  });
});
