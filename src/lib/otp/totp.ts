/**
 * RFC 4226 / RFC 6238 code generation over Web Crypto.
 *
 * `crypto.subtle` HMAC covers SHA-1, SHA-256 and SHA-512, which is every
 * algorithm the Key URI format defines, so there is no third-party dependency
 * here. Everything is a pure function over `Uint8Array` so the RFC vectors run
 * under Jest's `node` environment with no DOM.
 */

export const OTP_ALGORITHMS = ['SHA1', 'SHA256', 'SHA512'] as const;
export type OtpAlgorithm = (typeof OTP_ALGORITHMS)[number];

export const OTP_DIGITS = [6, 7, 8] as const;
export type OtpDigits = (typeof OTP_DIGITS)[number];

export const DEFAULT_ALGORITHM: OtpAlgorithm = 'SHA1';
export const DEFAULT_DIGITS: OtpDigits = 6;
export const DEFAULT_PERIOD = 30;

const SUBTLE_HASH: Record<OtpAlgorithm, string> = {
  SHA1: 'SHA-1',
  SHA256: 'SHA-256',
  SHA512: 'SHA-512',
};

/** Big-endian 8-byte counter — the RFC 4226 `C` value. */
export function counterToBytes(counter: number): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(8);
  // Counters stay far below 2^53, so a BigInt is unnecessary; split at 32 bits.
  let hi = Math.floor(counter / 0x1_0000_0000);
  let lo = counter >>> 0;
  for (let i = 7; i >= 4; i--) {
    buf[i] = lo & 0xff;
    lo = Math.floor(lo / 256);
  }
  for (let i = 3; i >= 0; i--) {
    buf[i] = hi & 0xff;
    hi = Math.floor(hi / 256);
  }
  return buf as Uint8Array<ArrayBuffer>;
}

/** RFC 4226 §5.3 dynamic truncation. */
export function truncateHmac(hmac: Uint8Array, digits: number): string {
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const code = binary % 10 ** digits;
  return code.toString().padStart(digits, '0');
}

export async function hotp(
  secret: Uint8Array<ArrayBuffer>,
  counter: number,
  { algorithm = DEFAULT_ALGORITHM, digits = DEFAULT_DIGITS }: { algorithm?: OtpAlgorithm; digits?: number } = {},
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    secret,
    { name: 'HMAC', hash: { name: SUBTLE_HASH[algorithm] } },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, counterToBytes(counter));
  return truncateHmac(new Uint8Array(mac), digits);
}

export type TotpParams = {
  algorithm?: OtpAlgorithm;
  digits?: number;
  period?: number;
  /** Unix milliseconds. Defaults to `Date.now()`; callers pass a clock-corrected value. */
  now?: number;
};

export function totpCounter(nowMs: number, period: number): number {
  return Math.floor(nowMs / 1000 / period);
}

export async function totp(secret: Uint8Array<ArrayBuffer>, params: TotpParams = {}): Promise<string> {
  const { algorithm = DEFAULT_ALGORITHM, digits = DEFAULT_DIGITS, period = DEFAULT_PERIOD, now = Date.now() } = params;
  return hotp(secret, totpCounter(now, period), { algorithm, digits });
}

/** Milliseconds until the current step ends — drives the countdown ring. */
export function msUntilNextStep(nowMs: number, period: number): number {
  const periodMs = period * 1000;
  return periodMs - (nowMs % periodMs);
}

export function secondsRemaining(nowMs: number, period: number): number {
  return Math.ceil(msUntilNextStep(nowMs, period) / 1000);
}
