import { eq } from 'drizzle-orm';

import { getSealKeyString, HKDF_INFO_SECRET_BODY } from '@/config/constants';
import { sealNotes, sealNoteVersions, secretNoteVersions } from '../../src/db/schema';
import { testDb } from './db';

/**
 * Version history, written straight into the child tables.
 *
 * Rotation is the only flow that has to replace *every retained* body, so a
 * vault with no history under-tests it by exactly the thing most likely to
 * break: a Seal's versions are sealed with the same note key as its head, and
 * replacing one without the others leaves history that no key opens.
 *
 * Deliberately not routed through the save API, which compresses history,
 * enforces MAX_VERSIONS and bumps content timestamps. A fixture that produced
 * different rows than it asked for would make assertions about preservation
 * meaningless.
 */

const toBase64 = (buffer: ArrayBuffer | Uint8Array): string =>
  btoa(String.fromCharCode(...new Uint8Array(buffer instanceof ArrayBuffer ? buffer : buffer)));

const hkdfBase = (mekBytes: Uint8Array) =>
  globalThis.crypto.subtle.importKey('raw', new Uint8Array(mekBytes), 'HKDF', false, ['deriveKey']);

async function encrypt(key: CryptoKey, plaintext: string, aad?: string) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, ...(aad ? { additionalData: new TextEncoder().encode(aad) } : {}) },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { alg: 'A256GCM' as const, iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
}

export type SeededVersion = { id: string; seq: number; title: string };

/** Appends plaintext snapshots as Secret versions, oldest first. */
export async function seedSecretVersions(
  noteId: string,
  mekBytes: Uint8Array,
  versions: { title: string; content: string }[],
): Promise<SeededVersion[]> {
  const bodyKey = await globalThis.crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: new TextEncoder().encode(HKDF_INFO_SECRET_BODY),
    },
    await hkdfBase(mekBytes),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );

  const created: SeededVersion[] = [];
  for (const version of versions) {
    const [row] = await testDb()
      .insert(secretNoteVersions)
      .values({ noteId, title: version.title, encryptedBody: await encrypt(bodyKey, version.content) })
      .returning({ id: secretNoteVersions.id, seq: secretNoteVersions.seq, title: secretNoteVersions.title });
    created.push(row);
  }
  return created;
}

/**
 * Appends Seal versions under the head's *existing* note key, which is what an
 * ordinary edit does. Rotation has to replace the wrapper and every one of
 * these together or history stops opening.
 */
export async function seedSealVersions(
  noteId: string,
  mekBytes: Uint8Array,
  versions: { title: string; content: string }[],
): Promise<SeededVersion[]> {
  const [head] = await testDb().select().from(sealNotes).where(eq(sealNotes.id, noteId));
  if (!head?.wrappedNoteKey) throw new Error('Seal has no wrapped note key to version against');

  const aad = getSealKeyString(noteId);
  const encoded = new TextEncoder().encode(aad);
  const wrapKey = await globalThis.crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: encoded },
    await hkdfBase(mekBytes),
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const nekBytes = await globalThis.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: Uint8Array.from(atob(head.wrappedNoteKey.iv), (c) => c.charCodeAt(0)),
      additionalData: encoded,
    },
    wrapKey,
    Uint8Array.from(atob(head.wrappedNoteKey.ciphertext), (c) => c.charCodeAt(0)),
  );
  const nekKey = await globalThis.crypto.subtle.importKey('raw', nekBytes, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
  ]);

  const created: SeededVersion[] = [];
  for (const version of versions) {
    const [row] = await testDb()
      .insert(sealNoteVersions)
      .values({ noteId, title: version.title, encryptedBody: await encrypt(nekKey, version.content, aad) })
      .returning({ id: sealNoteVersions.id, seq: sealNoteVersions.seq, title: sealNoteVersions.title });
    created.push(row);
  }
  return created;
}
