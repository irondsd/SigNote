import { MAX_CIPHER, MAX_SEARCH, MAX_TAGS_PER_NOTE } from '@/config/constants';
import { NOTE_COLORS, NOTE_PATTERNS } from '@/config/noteStyles';
import { encryptedPayload, listParams, noteColor, notePattern, tagIdList } from '../common';

const OID = '507f1f77bcf86cd799439011';

// Validation contract for the shared list/create/setX schemas — the rejections
// the old polymorphic PATCH/list routes enforced by hand, now expressed as Zod.
describe('listParams', () => {
  it('applies the lenient defaults', () => {
    const parsed = listParams.parse({});
    expect(parsed).toMatchObject({ tagMode: 'or', limit: 30, offset: 0 });
  });

  it('clamps limit into [1, 100] rather than rejecting', () => {
    expect(listParams.parse({ limit: 9999 }).limit).toBe(100);
    expect(listParams.parse({ limit: 0 }).limit).toBe(1);
  });

  it('clamps a negative offset to 0', () => {
    expect(listParams.parse({ offset: -5 }).offset).toBe(0);
  });

  it('trims the search string', () => {
    expect(listParams.parse({ search: '  hi  ' }).search).toBe('hi');
  });

  // Regression: an over-long search must TRUNCATE (old `.slice(0, MAX_SEARCH)`),
  // not reject — otherwise pasting a long string fails the whole list query.
  it('truncates an over-long search instead of rejecting', () => {
    const long = 'a'.repeat(MAX_SEARCH + 50);
    const parsed = listParams.parse({ search: long });
    expect(parsed.search).toHaveLength(MAX_SEARCH);
  });
});

describe('noteColor / notePattern', () => {
  it('accepts a valid color and null', () => {
    expect(noteColor.parse(NOTE_COLORS[0])).toBe(NOTE_COLORS[0]);
    expect(noteColor.parse(null)).toBeNull();
  });

  it('rejects an unknown color', () => {
    expect(noteColor.safeParse('chartreuse').success).toBe(false);
  });

  it('accepts a valid pattern and null', () => {
    expect(notePattern.parse(NOTE_PATTERNS[0])).toBe(NOTE_PATTERNS[0]);
    expect(notePattern.parse(null)).toBeNull();
  });

  it('rejects an unknown pattern', () => {
    expect(notePattern.safeParse('polka').success).toBe(false);
  });
});

describe('tagIdList', () => {
  it('accepts up to MAX_TAGS_PER_NOTE ids', () => {
    expect(tagIdList.safeParse(Array(MAX_TAGS_PER_NOTE).fill(OID)).success).toBe(true);
  });

  it('rejects more than MAX_TAGS_PER_NOTE ids', () => {
    expect(tagIdList.safeParse(Array(MAX_TAGS_PER_NOTE + 1).fill(OID)).success).toBe(false);
  });
});

describe('encryptedPayload', () => {
  const valid = { alg: 'A256GCM', iv: 'aaaa', ciphertext: 'bbbb' };

  it('accepts a well-formed payload', () => {
    expect(encryptedPayload.safeParse(valid).success).toBe(true);
  });

  it('rejects a wrong algorithm', () => {
    expect(encryptedPayload.safeParse({ ...valid, alg: 'A128GCM' }).success).toBe(false);
  });

  it('rejects ciphertext over MAX_CIPHER (the old 413 guard)', () => {
    expect(encryptedPayload.safeParse({ ...valid, ciphertext: 'c'.repeat(MAX_CIPHER + 1) }).success).toBe(false);
  });
});
