/**
 * RFC 4648 Base32, tolerant on input and strict on output.
 *
 * Real setup screens print seeds lowercase, in space- or hyphen-separated
 * groups of four, and with the `=` padding dropped. All of those decode here.
 * Anything outside the alphabet is rejected — and the error never echoes the
 * input, because a parse failure must not carry a seed into a log or an
 * exception report (security invariant 2).
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export class Base32Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Base32Error';
  }
}

/** Strips separators, uppercases, drops padding. Does not validate. */
export function normalizeBase32(input: string): string {
  return input.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
}

export function decodeBase32(input: string): Uint8Array<ArrayBuffer> {
  const s = normalizeBase32(input);
  if (s.length === 0) throw new Base32Error('Secret is empty');

  const out = new Uint8Array(Math.floor((s.length * 5) / 8));
  let bits = 0;
  let value = 0;
  let index = 0;

  for (let i = 0; i < s.length; i++) {
    const idx = ALPHABET.indexOf(s[i]);
    if (idx === -1) throw new Base32Error('Secret contains characters that are not valid Base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out[index++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }

  // Leftover bits must be zero padding, never a truncated byte.
  if (bits >= 5 || (value & ((1 << bits) - 1)) !== 0) {
    throw new Base32Error('Secret is not a whole number of bytes');
  }
  if (index === 0) throw new Base32Error('Secret is too short');

  return out.subarray(0, index) as Uint8Array<ArrayBuffer>;
}

export function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';

  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];

  return out;
}

/** RFC 4226 asks for ≥128-bit seeds; plenty of real services ship less. */
export const MIN_RECOMMENDED_SECRET_BYTES = 16;

export function isWeakSecret(bytes: Uint8Array): boolean {
  return bytes.length < MIN_RECOMMENDED_SECRET_BYTES;
}
