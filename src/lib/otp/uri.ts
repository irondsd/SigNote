/**
 * `otpauth://` Key URI parsing and serialisation.
 *
 * Every thrown message is constant text. A URI carries a seed, an issuer and an
 * account name, so an error that quoted its input would push all three into an
 * exception report the moment PostHog's `capture_exceptions` saw it (security
 * invariant 2 and 10).
 *
 * @see https://github.com/google/google-authenticator/wiki/Key-Uri-Format
 */

import { Base32Error, decodeBase32, normalizeBase32 } from './base32';
import {
  DEFAULT_ALGORITHM,
  DEFAULT_DIGITS,
  DEFAULT_PERIOD,
  OTP_ALGORITHMS,
  OTP_DIGITS,
  type OtpAlgorithm,
  type OtpDigits,
} from './totp';

export class OtpUriError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OtpUriError';
  }
}

export type ParsedOtpUri = {
  type: 'totp';
  issuer: string;
  account: string;
  /** Normalised Base32 — uppercase, unpadded, no separators. */
  secret: string;
  algorithm: OtpAlgorithm;
  digits: OtpDigits;
  period: number;
};

function decodeComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new OtpUriError('The link contains invalid percent-encoding');
  }
}

/**
 * Splits `Issuer:Account`, `Issuer: Account` or a bare `Account` label.
 * Only the first colon separates; account names legitimately contain more.
 */
function splitLabel(label: string): { issuer: string; account: string } {
  const colon = label.indexOf(':');
  if (colon === -1) return { issuer: '', account: label.trim() };
  return {
    issuer: label.slice(0, colon).trim(),
    account: label.slice(colon + 1).trim(),
  };
}

export function parseOtpUri(raw: string): ParsedOtpUri {
  const input = raw.trim();

  if (/^otpauth-migration:/i.test(input)) {
    throw new OtpUriError('Google Authenticator export links are not supported yet');
  }
  if (!/^otpauth:\/\//i.test(input)) {
    throw new OtpUriError('Not an otpauth:// link');
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new OtpUriError('The link could not be read');
  }

  const type = url.host.toLowerCase();
  if (type === 'hotp') {
    throw new OtpUriError('Counter-based (HOTP) credentials are not supported yet');
  }
  if (type !== 'totp') {
    throw new OtpUriError('Only time-based (TOTP) credentials are supported');
  }

  const params = url.searchParams;

  // `counter` is the other marker of an HOTP credential; some exporters emit it
  // on an otherwise totp-typed URI.
  if (params.has('counter')) {
    throw new OtpUriError('Counter-based (HOTP) credentials are not supported yet');
  }

  const label = decodeComponent(url.pathname.replace(/^\//, ''));
  const fromLabel = splitLabel(label);

  // The explicit issuer parameter wins over the label prefix when both exist.
  const issuerParam = params.get('issuer')?.trim() ?? '';
  const issuer = issuerParam || fromLabel.issuer;
  const account = fromLabel.account;

  const rawSecret = params.get('secret');
  if (!rawSecret) throw new OtpUriError('The link has no secret');
  const secret = normalizeBase32(rawSecret);
  try {
    decodeBase32(secret); // validate; the bytes themselves are not kept here
  } catch (err) {
    if (err instanceof Base32Error) throw new OtpUriError('The secret in the link is not valid Base32');
    throw err;
  }

  const algorithmRaw = params.get('algorithm');
  let algorithm: OtpAlgorithm = DEFAULT_ALGORITHM;
  if (algorithmRaw) {
    const upper = algorithmRaw.trim().toUpperCase().replace(/-/g, '');
    if (!(OTP_ALGORITHMS as readonly string[]).includes(upper)) {
      throw new OtpUriError('The link uses an unsupported algorithm');
    }
    algorithm = upper as OtpAlgorithm;
  }

  const digitsRaw = params.get('digits');
  let digits: OtpDigits = DEFAULT_DIGITS;
  if (digitsRaw) {
    const n = Number(digitsRaw);
    if (!(OTP_DIGITS as readonly number[]).includes(n)) {
      throw new OtpUriError('The link asks for an unsupported number of digits');
    }
    digits = n as OtpDigits;
  }

  const periodRaw = params.get('period');
  let period = DEFAULT_PERIOD;
  if (periodRaw) {
    const n = Number(periodRaw);
    if (!Number.isInteger(n) || n <= 0 || n > 3600) {
      throw new OtpUriError('The link asks for an unsupported period');
    }
    period = n;
  }

  return { type: 'totp', issuer, account, secret, algorithm, digits, period };
}

/**
 * Serialises back to a Key URI for single-credential export. Always writes the
 * issuer in both the label and the query parameter — the combination every
 * other authenticator reads reliably.
 */
export function buildOtpUri(record: {
  issuer: string;
  account: string;
  secret: string;
  algorithm: OtpAlgorithm;
  digits: number;
  period: number;
}): string {
  const label = record.issuer ? `${record.issuer}:${record.account}` : record.account;
  const params = new URLSearchParams({ secret: normalizeBase32(record.secret) });
  if (record.issuer) params.set('issuer', record.issuer);
  params.set('algorithm', record.algorithm);
  params.set('digits', String(record.digits));
  params.set('period', String(record.period));

  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}
