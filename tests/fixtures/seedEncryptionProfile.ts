import type { Address } from 'viem';

import {
  ENC_PBKDF2_ITERATIONS,
  ENC_PBKDF2_LENGTH,
  ENC_VERSION,
  HKDF_INFO_VERIFY_KEY,
  KEY_CHECK_PLAINTEXT,
} from '../../src/config/constants';
import { encryptionProfiles } from '../../src/db/schema';
import { getOrCreateUserId } from './getOrCreateUserId';
import { testDb } from './db';

function toBase64(buf: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf instanceof ArrayBuffer ? buf : buf)));
}

function xor32(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = a[i] ^ b[i];
  return out;
}

const kdf = {
  name: 'PBKDF2' as const,
  hash: 'SHA-256' as const,
  iterations: ENC_PBKDF2_ITERATIONS,
  length: ENC_PBKDF2_LENGTH,
};

/** Address-keyed entry point. See {@link seedEncryptionProfileForUser}. */
export const seedEncryptionProfile = async (
  address: Address,
  passphrase: string,
): Promise<{ mekBytes: Uint8Array; deviceShare: Uint8Array }> =>
  seedEncryptionProfileForUser(await getOrCreateUserId(address), passphrase);

/**
 * Writes the profile the app would have written on setup, and hands back the
 * MEK so the caller can seed encrypted rows against it.
 *
 * Keyed by user id rather than by address because an account does not need a
 * wallet — `scripts/seedLocalDb.ts` seeds email-only accounts through here.
 */
export const seedEncryptionProfileForUser = async (
  userId: string,
  passphrase: string,
): Promise<{ mekBytes: Uint8Array; deviceShare: Uint8Array }> => {
  const subtle = globalThis.crypto.subtle;

  // Generate random salt and server share
  const saltBytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const serverShareBytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const salt = toBase64(saltBytes);
  const serverShare = toBase64(serverShareBytes);

  // Derive device share via PBKDF2
  const keyMaterial = await subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const deviceShareBits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: ENC_PBKDF2_ITERATIONS },
    keyMaterial,
    ENC_PBKDF2_LENGTH * 8,
  );
  const deviceShare = new Uint8Array(deviceShareBits);

  // Compute MEK = XOR(deviceShare, serverShare)
  const mekBytes = xor32(deviceShare, serverShareBytes);

  // Import MEK as HKDF base key
  const mek = await subtle.importKey('raw', new Uint8Array(mekBytes), 'HKDF', false, ['deriveKey']);

  // Derive verify key via HKDF
  const verifyKey = await subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: new TextEncoder().encode(HKDF_INFO_VERIFY_KEY),
    },
    mek,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );

  // Create key check: encrypt KEY_CHECK_PLAINTEXT with verifyKey
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    verifyKey,
    new TextEncoder().encode(KEY_CHECK_PLAINTEXT),
  );
  const keyCheck = {
    alg: 'A256GCM' as const,
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
  };

  await testDb().insert(encryptionProfiles).values({
    userId,
    version: ENC_VERSION,
    serverShare,
    salt,
    kdf,
    keyCheck,
  });

  return { mekBytes, deviceShare };
};
