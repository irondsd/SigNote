import type { APIRequestContext } from '@playwright/test';
import { and, eq } from 'drizzle-orm';

import { getSealFileAad, getSealKeyString, HKDF_INFO_FILE_ENC } from '../../src/config/constants';
import { fileAttachments, sealNotes } from '../../src/db/schema';
import { testDb } from './db';

/**
 * An encrypted attachment, uploaded through the app's own route.
 *
 * Going through `/api/files` rather than writing the row and the object
 * separately keeps the fixture honest about the two things rotation later has
 * to preserve: the id embedded in note HTML, and the exact plaintext bytes.
 * The ciphertext is produced here with the same derivation the browser uses,
 * so a rotated file can be decrypted in the spec and compared byte for byte.
 */

const toBase64 = (buffer: ArrayBuffer | Uint8Array): string =>
  btoa(String.fromCharCode(...new Uint8Array(buffer instanceof ArrayBuffer ? buffer : buffer)));

export async function fileEncryptionKey(mekBytes: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  const base = await globalThis.crypto.subtle.importKey('raw', new Uint8Array(mekBytes), 'HKDF', false, ['deriveKey']);
  return globalThis.crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: new TextEncoder().encode(HKDF_INFO_FILE_ENC),
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  );
}

type WrappedKey = { iv: string; ciphertext: string };
const fromBase64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

/** A Seal's note key, unwrapped under the MEK exactly as the browser does. */
export async function sealNoteKey(
  mekBytes: Uint8Array,
  sealId: string,
  wrapped: WrappedKey,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const subtle = globalThis.crypto.subtle;
  const aad = new TextEncoder().encode(getSealKeyString(sealId));
  const base = await subtle.importKey('raw', new Uint8Array(mekBytes), 'HKDF', false, ['deriveKey']);
  const wrapKey = await subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: aad },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const raw = await subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(wrapped.iv), additionalData: aad },
    wrapKey,
    fromBase64(wrapped.ciphertext),
  );
  return subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, usages);
}

export type SeededFile = { fileId: string; plaintext: Uint8Array; filename: string };

/**
 * `seal` uploads the file under that Seal's own note key, bound to its id —
 * as the Seal editor does. Without it the file is on the vault file key.
 */
export async function seedEncryptedFile(
  request: APIRequestContext,
  mekBytes: Uint8Array,
  options: {
    bytes?: number;
    filename?: string;
    mimeType?: string;
    seal?: { id: string; wrappedNoteKey: WrappedKey };
  } = {},
): Promise<SeededFile> {
  // `getRandomValues` caps at 65,536 bytes per call, and the largest supported
  // attachment is far past that, so fill in chunks.
  const plaintext = new Uint8Array(options.bytes ?? 2048);
  for (let offset = 0; offset < plaintext.length; offset += 65_536) {
    globalThis.crypto.getRandomValues(plaintext.subarray(offset, Math.min(offset + 65_536, plaintext.length)));
  }
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const { seal } = options;
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    seal
      ? { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(getSealFileAad(seal.id)) }
      : { name: 'AES-GCM', iv },
    seal
      ? await sealNoteKey(mekBytes, seal.id, seal.wrappedNoteKey, ['encrypt'])
      : await fileEncryptionKey(mekBytes, ['encrypt']),
    plaintext,
  );

  const filename = options.filename ?? 'attachment.bin';
  const response = await request.post('/api/files', {
    multipart: {
      file: {
        name: filename,
        mimeType: 'application/octet-stream',
        buffer: Buffer.from(ciphertext),
      },
      encrypted: 'true',
      encryptionIv: toBase64(iv),
      originalMimeType: options.mimeType ?? 'application/pdf',
      ...(seal && { keyScope: 'seal', keyNoteId: seal.id }),
    },
  });
  if (!response.ok()) throw new Error(`Encrypted upload failed: ${response.status()} ${await response.text()}`);
  const { fileId } = (await response.json()) as { fileId: string };
  return { fileId, plaintext, filename };
}

/**
 * Reads the stored object back and decrypts it with the given MEK.
 *
 * `generation` is not optional decoration: once an account has rotated, the
 * file route refuses a request that does not name the generation it expects,
 * exactly as it refuses a stale browser. A fixture that omitted it would fail
 * with a 409 that says nothing about the bytes.
 */
export async function decryptStoredFile(
  request: APIRequestContext,
  fileId: string,
  mekBytes: Uint8Array,
  generation = 0,
  /** Ids are unique per account: name the owner when two accounts may share one. */
  userId?: string,
): Promise<Uint8Array> {
  const [row] = await testDb()
    .select()
    .from(fileAttachments)
    .where(and(eq(fileAttachments.id, fileId), userId ? eq(fileAttachments.userId, userId) : undefined));
  if (!row?.encryptionIv) throw new Error('File attachment has no IV');
  const response = await request.get(`/api/files/${fileId}`, {
    headers: { 'x-signote-encryption-generation': String(generation) },
  });
  if (!response.ok()) throw new Error(`File read failed: ${response.status()}`);
  const body = new Uint8Array(await response.body());
  const iv = fromBase64(row.encryptionIv);
  if (row.keyScope === 'seal') {
    // Under its Seal's note key, which is read through the Seal's current wrapper.
    const [seal] = await testDb()
      .select()
      .from(sealNotes)
      .where(and(eq(sealNotes.id, row.keyNoteId!), eq(sealNotes.userId, row.userId)));
    if (!seal?.wrappedNoteKey) throw new Error('Seal attachment has no Seal key');
    const plain = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(getSealFileAad(seal.id)) },
      await sealNoteKey(mekBytes, seal.id, seal.wrappedNoteKey, ['decrypt']),
      body,
    );
    return new Uint8Array(plain);
  }
  const plain = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    await fileEncryptionKey(mekBytes, ['decrypt']),
    body,
  );
  return new Uint8Array(plain);
}
