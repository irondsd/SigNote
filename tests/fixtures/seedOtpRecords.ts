import type { Address } from 'viem';
import { v7 as uuidv7 } from 'uuid';

import { getOtpRecordAad, HKDF_INFO_OTP_VAULT, POSITION_STEP } from '../../src/config/constants';
import { otpRecords } from '../../src/db/schema';
import type { NoteColor, NotePattern } from '../../src/config/noteStyles';
import { getOrCreateUserId } from './getOrCreateUserId';
import { testDb } from './db';

/** A valid RFC 4648 seed the app will accept ("12345678901234567890"). */
export const TEST_SEED = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

export type SeedOtp = {
  issuer: string;
  account?: string;
  secret?: string;
  digits?: 6 | 7 | 8;
  period?: number;
  archived?: boolean;
  color?: NoteColor | null;
  pattern?: NotePattern | null;
  /** Force a specific position — used to reproduce collided orderings. */
  position?: number;
};

export type SeededOtp = { id: string; issuer: string; position: number };

function toBase64(buf: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf instanceof ArrayBuffer ? buf : buf)));
}

/** Address-keyed entry point. See {@link seedOtpRecordsForUser}. */
export const seedOtpRecords = async (
  address: Address,
  mekBytes: Uint8Array,
  records: SeedOtp[],
): Promise<SeededOtp[]> => seedOtpRecordsForUser(await getOrCreateUserId(address), mekBytes, records);

/**
 * Seeds encrypted authenticator rows straight into Postgres, keyed by user id
 * so an account with no wallet can be seeded too.
 *
 * **Array order is display order.** Positions descend from the first entry, so
 * `seedOtpRecords(addr, mek, [a, b, c])` renders as a, b, c — unlike
 * `seedNotes`, which ascends and forces every spec to seed its list backwards.
 */
export const seedOtpRecordsForUser = async (
  userId: string,
  mekBytes: Uint8Array,
  records: SeedOtp[],
): Promise<SeededOtp[]> => {
  const db = testDb();
  const subtle = globalThis.crypto.subtle;

  const mek = await subtle.importKey('raw', new Uint8Array(mekBytes), 'HKDF', false, ['deriveKey']);
  const vaultKey = await subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: new TextEncoder().encode(HKDF_INFO_OTP_VAULT),
    },
    mek,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );

  const created: SeededOtp[] = [];
  const top = (records.length + 1) * POSITION_STEP;

  for (const [i, record] of records.entries()) {
    // The id is chosen before encrypting: the payload is bound to it as AAD,
    // exactly as the client does it.
    const id = uuidv7();
    const position = record.position ?? top - i * POSITION_STEP;

    const body = JSON.stringify({
      v: 1,
      type: 'totp',
      issuer: record.issuer,
      account: record.account ?? 'user@example.com',
      secret: record.secret ?? TEST_SEED,
      algorithm: 'SHA1',
      digits: record.digits ?? 6,
      period: record.period ?? 30,
    });

    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(getOtpRecordAad(id)) },
      vaultKey,
      new TextEncoder().encode(body),
    );

    const now = new Date();
    await db.insert(otpRecords).values({
      id,
      userId,
      payload: { alg: 'A256GCM', iv: toBase64(iv), ciphertext: toBase64(ciphertext) },
      payloadVersion: 1,
      position,
      revision: 1,
      archived: record.archived ?? false,
      color: record.color ?? null,
      pattern: record.pattern ?? null,
      createdAt: now,
      updatedAt: now,
    });

    created.push({ id, issuer: record.issuer, position });
  }

  return created;
};
