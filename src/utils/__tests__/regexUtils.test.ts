import { escapeRegExp } from '@/utils/regexUtils';

describe('escapeRegExp', () => {
  it('escapes all special regex characters', () => {
    expect(escapeRegExp('.*+?^${}()|[]\\')).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
  });

  it('returns empty string unchanged', () => {
    expect(escapeRegExp('')).toBe('');
  });

  it('passes through strings without special chars', () => {
    expect(escapeRegExp('hello world')).toBe('hello world');
  });

  it('escapes mixed content', () => {
    expect(escapeRegExp('price is $10.00 (USD)')).toBe('price is \\$10\\.00 \\(USD\\)');
  });
});
