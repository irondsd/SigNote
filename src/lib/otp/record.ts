/**
 * The authenticator record: what it holds in the clear on the device, and how
 * it is sealed before it ever reaches the server.
 *
 * Issuer and account name are inside the ciphertext, not beside it. They name
 * the services and identities the user holds accounts with, which is exactly
 * the metadata a hosted authenticator normally leaks. Search therefore happens
 * locally, after decryption — there is no server-side index to build.
 */

import { z } from 'zod';

import { getOtpRecordAad, OTP_PAYLOAD_VERSION } from '@/config/constants';
import { decryptAesGcm, encryptAesGcm } from '@/lib/crypto';
import type { EncryptedPayload } from '@/types/crypto';
import { decodeBase32, normalizeBase32 } from './base32';
import { OTP_ALGORITHMS, totp, type OtpAlgorithm, type OtpDigits } from './totp';

export const MAX_ISSUER_LENGTH = 128;
export const MAX_ACCOUNT_LENGTH = 256;
export const MAX_NOTE_LENGTH = 512;
export const MAX_SECRET_LENGTH = 512;

/** The decrypted body. `v` is the payload format, bumped only by a shape change. */
export const otpSecretsSchema = z.object({
  v: z.literal(OTP_PAYLOAD_VERSION),
  type: z.literal('totp'),
  issuer: z.string().max(MAX_ISSUER_LENGTH),
  account: z.string().max(MAX_ACCOUNT_LENGTH),
  secret: z.string().min(1).max(MAX_SECRET_LENGTH),
  algorithm: z.enum(OTP_ALGORITHMS),
  digits: z.union([z.literal(6), z.literal(7), z.literal(8)]),
  period: z.number().int().positive().max(3600),
  note: z.string().max(MAX_NOTE_LENGTH).optional(),
});

export type OtpSecrets = z.infer<typeof otpSecretsSchema>;

export type OtpDraft = {
  issuer: string;
  account: string;
  secret: string;
  algorithm?: OtpAlgorithm;
  digits?: OtpDigits;
  period?: number;
  note?: string;
};

export class OtpRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OtpRecordError';
  }
}

/** Normalises a draft into a storable body, validating the seed on the way. */
export function toOtpSecrets(draft: OtpDraft): OtpSecrets {
  const secret = normalizeBase32(draft.secret);
  decodeBase32(secret); // throws Base32Error on a malformed seed

  const candidate: OtpSecrets = {
    v: OTP_PAYLOAD_VERSION,
    type: 'totp',
    issuer: draft.issuer.trim(),
    account: draft.account.trim(),
    secret,
    algorithm: draft.algorithm ?? 'SHA1',
    digits: (draft.digits ?? 6) as OtpDigits,
    period: draft.period ?? 30,
    ...(draft.note?.trim() ? { note: draft.note.trim() } : {}),
  };

  const parsed = otpSecretsSchema.safeParse(candidate);
  if (!parsed.success) throw new OtpRecordError('The credential details are not valid');
  return parsed.data;
}

// ─── Encryption ──────────────────────────────────────────────────────────────

/**
 * Ids are generated on the client so a record can be sealed under its own id
 * before it is ever sent — which is what makes the AAD binding possible, and
 * what lets a create be retried idempotently.
 */
export async function encryptOtpRecord(
  vaultKey: CryptoKey,
  recordId: string,
  secrets: OtpSecrets,
): Promise<EncryptedPayload> {
  return encryptAesGcm(vaultKey, JSON.stringify(secrets), getOtpRecordAad(recordId));
}

export async function decryptOtpRecord(
  vaultKey: CryptoKey,
  recordId: string,
  payload: EncryptedPayload,
): Promise<OtpSecrets> {
  const json = await decryptAesGcm(vaultKey, payload, getOtpRecordAad(recordId));

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new OtpRecordError('The stored credential could not be read');
  }

  const parsed = otpSecretsSchema.safeParse(raw);
  if (!parsed.success) throw new OtpRecordError('The stored credential is in an unrecognised format');
  return parsed.data;
}

// ─── Code generation ─────────────────────────────────────────────────────────

/** `nowMs` is the clock-corrected time (`Date.now() + serverTimeOffsetMs`). */
export async function codeForRecord(secrets: OtpSecrets, nowMs: number = Date.now()): Promise<string> {
  return totp(decodeBase32(secrets.secret), {
    algorithm: secrets.algorithm,
    digits: secrets.digits,
    period: secrets.period,
    now: nowMs,
  });
}

// ─── Duplicate detection ─────────────────────────────────────────────────────

/**
 * Two records are the same credential when the seed bytes and the identity
 * match. Compared on normalised Base32 rather than raw input so `abcd efgh` and
 * `ABCDEFGH` do not import twice.
 */
export function isSameCredential(a: OtpSecrets, b: OtpSecrets): boolean {
  return (
    a.secret === b.secret &&
    a.issuer.toLowerCase() === b.issuer.toLowerCase() &&
    a.account.toLowerCase() === b.account.toLowerCase()
  );
}
