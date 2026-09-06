import { Base32Error, decodeBase32, encodeBase32, isWeakSecret, normalizeBase32 } from '../base32';

const bytes = (s: string) => Array.from(new TextEncoder().encode(s));

describe('decodeBase32 — RFC 4648 §10 vectors', () => {
  const VECTORS: [string, string][] = [
    ['MY======', 'f'],
    ['MZXQ====', 'fo'],
    ['MZXW6===', 'foo'],
    ['MZXW6YQ=', 'foob'],
    ['MZXW6YTB', 'fooba'],
    ['MZXW6YTBOI======', 'foobar'],
  ];

  it.each(VECTORS)('%s → %s', (encoded, expected) => {
    expect(Array.from(decodeBase32(encoded))).toEqual(bytes(expected));
  });

  it.each(VECTORS)('round-trips %s', (encoded, plain) => {
    expect(encodeBase32(new TextEncoder().encode(plain))).toBe(normalizeBase32(encoded));
  });
});

describe('input tolerance', () => {
  // All four are the same seed as printed by real setup screens.
  const SAME_SEED = ['MZXW6YTBOI======', 'MZXW6YTBOI', 'mzxw6ytboi', 'MZXW 6YTB OI', 'MZXW-6YTB-OI'];

  it.each(SAME_SEED)('accepts %s', (input) => {
    expect(Array.from(decodeBase32(input))).toEqual(bytes('foobar'));
  });

  it('normalizes without validating', () => {
    expect(normalizeBase32(' mzxw-6ytb oi== ')).toBe('MZXW6YTBOI');
    expect(normalizeBase32('a=b=')).toBe('A=B');
  });
});

describe('rejection', () => {
  it('rejects characters outside the alphabet', () => {
    // 0, 1, 8 and 9 are deliberately absent from RFC 4648 Base32.
    for (const bad of ['MZXW6YTB0I', 'MZXW6YTB1I', 'MZXW6YTB8I', 'ABC!DEF', 'ABCÅDEF']) {
      expect(() => decodeBase32(bad)).toThrow(Base32Error);
    }
  });

  it('rejects an empty secret', () => {
    expect(() => decodeBase32('')).toThrow(Base32Error);
    expect(() => decodeBase32('   ')).toThrow(Base32Error);
    expect(() => decodeBase32('====')).toThrow(Base32Error);
  });

  it('rejects a truncated final byte', () => {
    // A single character carries 5 bits — not a whole byte.
    expect(() => decodeBase32('M')).toThrow(Base32Error);
    // Trailing bits that are not zero padding mean the seed was mangled.
    expect(() => decodeBase32('MZXW6YTBOB')).toThrow(Base32Error);
  });

  it('never echoes the input in the message', () => {
    // Security invariant 2: a parse error must not carry a seed into a log.
    const seed = 'JBSWY3DPEHPK3PXP!';
    try {
      decodeBase32(seed);
      throw new Error('expected a throw');
    } catch (err) {
      expect((err as Error).message).not.toContain('JBSWY3DP');
      expect((err as Error).message).toBe('Secret contains characters that are not valid Base32');
    }
  });
});

describe('isWeakSecret', () => {
  it('flags seeds below 128 bits but still decodes them', () => {
    const short = decodeBase32('MZXW6YTBOI'); // 6 bytes
    expect(isWeakSecret(short)).toBe(true);

    const ok = decodeBase32(encodeBase32(new Uint8Array(20)));
    expect(isWeakSecret(ok)).toBe(false);
  });
});
