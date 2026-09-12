import { eq } from 'drizzle-orm';

import {
  ENC_PBKDF2_ITERATIONS,
  ENC_PBKDF2_LENGTH,
  getSealKeyString,
  HKDF_INFO_SECRET_BODY,
  HKDF_INFO_VERIFY_KEY,
  KEY_CHECK_PLAINTEXT,
} from '../../src/config/constants';
import type { EncryptedPayload } from '../../src/types/crypto';
import { encryptionProfiles, sealNotes, sealNoteVersions, secretNotes, secretNoteVersions } from '../../src/db/schema';
import { testDb } from '../fixtures/db';

/**
 * Reading the vault the way the app would, from the test process.
 *
 * Rotation specs have to answer one question about every row: does this
 * ciphertext still decrypt to the same plaintext, and does it decrypt only with
 * the key it is supposed to? Asserting through the UI would confuse "the note
 * renders" with "the bytes are right", and asserting on ciphertext equality
 * would pass for a rotation that produced unreadable garbage.
 *
 * So these helpers reconstruct the MEK from the stored profile exactly as the
 * browser does — PBKDF2 at production iterations, XOR with the server share,
 * key check — and derive the same working keys.
 */

const decode = (value: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0)) as Uint8Array<ArrayBuffer>;

const hkdf = async (mekBytes: Uint8Array, info: string, usages: KeyUsage[]): Promise<CryptoKey> => {
  const base = await globalThis.crypto.subtle.importKey('raw', new Uint8Array(mekBytes), 'HKDF', false, ['deriveKey']);
  return globalThis.crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode(info) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  );
};

async function decrypt(key: CryptoKey, payload: EncryptedPayload, aad?: string): Promise<string> {
  const plain = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decode(payload.iv), ...(aad ? { additionalData: new TextEncoder().encode(aad) } : {}) },
    key,
    decode(payload.ciphertext),
  );
  return new TextDecoder().decode(plain);
}

/**
 * The MEK for a passphrase, rebuilt from whatever the profile row currently
 * holds. Rejects on a passphrase the stored key check does not accept — which
 * is how a spec asserts that an old passphrase stopped working.
 */
export async function mekFromPassphrase(userId: string, passphrase: string): Promise<Uint8Array<ArrayBuffer>> {
  const [profile] = await testDb().select().from(encryptionProfiles).where(eq(encryptionProfiles.userId, userId));
  if (!profile) throw new Error('No encryption profile for this account');

  const keyMaterial = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: decode(profile.salt),
      iterations: profile.kdf?.iterations ?? ENC_PBKDF2_ITERATIONS,
    },
    keyMaterial,
    (profile.kdf?.length ?? ENC_PBKDF2_LENGTH) * 8,
  );

  const deviceShare = new Uint8Array(bits);
  const serverShare = decode(profile.serverShare);
  const mekBytes = new Uint8Array(32) as Uint8Array<ArrayBuffer>;
  for (let index = 0; index < 32; index++) mekBytes[index] = deviceShare[index] ^ serverShare[index];

  const verifyKey = await hkdf(mekBytes, HKDF_INFO_VERIFY_KEY, ['decrypt']);
  const checked = await decrypt(verifyKey, profile.keyCheck).catch(() => null);
  if (checked !== KEY_CHECK_PLAINTEXT) throw new Error('Passphrase does not open this profile');
  return mekBytes;
}

export async function decryptSecretHead(noteId: string, mekBytes: Uint8Array): Promise<string> {
  const [row] = await testDb().select().from(secretNotes).where(eq(secretNotes.id, noteId));
  if (!row?.encryptedBody) throw new Error('Secret has no body');
  return decrypt(await hkdf(mekBytes, HKDF_INFO_SECRET_BODY, ['decrypt']), row.encryptedBody);
}

export async function decryptSecretVersion(versionId: string, mekBytes: Uint8Array): Promise<string> {
  const [row] = await testDb().select().from(secretNoteVersions).where(eq(secretNoteVersions.id, versionId));
  if (!row?.encryptedBody) throw new Error('Secret version has no body');
  return decrypt(await hkdf(mekBytes, HKDF_INFO_SECRET_BODY, ['decrypt']), row.encryptedBody);
}

/** Unwraps the Seal's note key from the *current* head wrapper, then decrypts. */
async function sealNoteKey(sealId: string, mekBytes: Uint8Array): Promise<CryptoKey> {
  const [head] = await testDb().select().from(sealNotes).where(eq(sealNotes.id, sealId));
  if (!head?.wrappedNoteKey) throw new Error('Seal has no wrapped note key');
  const aad = getSealKeyString(sealId);
  const wrapKey = await hkdf(mekBytes, aad, ['decrypt']);
  const nekBytes = await globalThis.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: decode(head.wrappedNoteKey.iv),
      additionalData: new TextEncoder().encode(aad),
    },
    wrapKey,
    decode(head.wrappedNoteKey.ciphertext),
  );
  return globalThis.crypto.subtle.importKey('raw', nekBytes, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
}

export async function decryptSealHead(sealId: string, mekBytes: Uint8Array): Promise<string> {
  const [row] = await testDb().select().from(sealNotes).where(eq(sealNotes.id, sealId));
  if (!row?.encryptedBody) throw new Error('Seal has no body');
  return decrypt(await sealNoteKey(sealId, mekBytes), row.encryptedBody, getSealKeyString(sealId));
}

/**
 * A Seal version, opened with the head's current note key. This is the check
 * that catches a rotation which replaced a wrapper without replacing every
 * body it protects: the head would read fine and history would not.
 */
export async function decryptSealVersion(sealId: string, versionId: string, mekBytes: Uint8Array): Promise<string> {
  const [row] = await testDb().select().from(sealNoteVersions).where(eq(sealNoteVersions.id, versionId));
  if (!row?.encryptedBody) throw new Error('Seal version has no body');
  return decrypt(await sealNoteKey(sealId, mekBytes), row.encryptedBody, getSealKeyString(sealId));
}
