import { isInArchive, isSnoozeDue, isSnoozed } from '@/lib/snooze';

const NOW = Date.parse('2026-11-09T12:00:00Z');
const before = '2026-11-08T00:00:00Z';
const after = '2026-12-25T00:00:00Z';

describe('snooze state', () => {
  it('a plain active note is none of the three', () => {
    const note = { archived: false, snoozedUntil: null };
    expect(isSnoozed(note, NOW)).toBe(false);
    expect(isSnoozeDue(note, NOW)).toBe(false);
    expect(isInArchive(note, NOW)).toBe(false);
  });

  it('a plainly archived note is in the archive', () => {
    expect(isInArchive({ archived: true }, NOW)).toBe(true);
    expect(isSnoozed({ archived: true }, NOW)).toBe(false);
  });

  it('a note snoozed to a future date is in the archive', () => {
    const note = { archived: true, snoozedUntil: after };
    expect(isSnoozed(note, NOW)).toBe(true);
    expect(isSnoozeDue(note, NOW)).toBe(false);
    expect(isInArchive(note, NOW)).toBe(true);
  });

  it('a note whose date has passed is back among the active ones', () => {
    const note = { archived: true, snoozedUntil: before };
    expect(isSnoozed(note, NOW)).toBe(false);
    expect(isSnoozeDue(note, NOW)).toBe(true);
    expect(isInArchive(note, NOW)).toBe(false);
  });

  it('is due at the exact moment, matching the server filter', () => {
    expect(isSnoozeDue({ archived: true, snoozedUntil: new Date(NOW) }, NOW)).toBe(true);
  });
});
