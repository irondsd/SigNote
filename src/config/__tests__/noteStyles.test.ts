import { autoTagColor, NOTE_COLORS, TAG_COLORS } from '../noteStyles';

describe('autoTagColor', () => {
  it('reuses the note palette (no separate tag palette)', () => {
    expect(TAG_COLORS).toBe(NOTE_COLORS);
  });

  it('always returns a valid note color', () => {
    for (const name of ['work', 'personal', 'urgent', 'a', 'finance-2025', '日本語']) {
      expect(NOTE_COLORS).toContain(autoTagColor(name));
    }
  });

  it('is deterministic and case/whitespace insensitive', () => {
    expect(autoTagColor('Work')).toBe(autoTagColor('  work '));
    expect(autoTagColor('finance')).toBe(autoTagColor('finance'));
  });

  it('spreads names across more than one color', () => {
    const names = ['work', 'personal', 'urgent', 'ideas', 'finance', 'music', 'docs', 'research', 'archive'];
    const distinct = new Set(names.map(autoTagColor));
    expect(distinct.size).toBeGreaterThan(1);
  });
});
