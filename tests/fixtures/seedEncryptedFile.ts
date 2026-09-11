import type { APIRequestContext } from '@playwright/test';
import { eq } from 'drizzle-orm';

import { HKDF_INFO_FILE_ENC } from '@/config/constants';
import { fileAttachments } from '../../src/db/schema';
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

export type SeededFile = { fileId: string; plaintext: Uint8Array; filename: string };

export async function seedEncryptedFile(
  request: APIRequestContext,
  mekBytes: Uint8Array,
  options: { bytes?: number; filename?: string; mimeType?: string } = {},
): Promise<SeededFile> {
  const plaintext = globalThis.crypto.getRandomValues(new Uint8Array(options.bytes ?? 2048));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await fileEncryptionKey(mekBytes, ['encrypt']),
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
): Promise<Uint8Array> {
  const [row] = await testDb().select().from(fileAttachments).where(eq(fileAttachments.id, fileId));
  if (!row?.encryptionIv) throw new Error('File attachment has no IV');
  const response = await request.get(`/api/files/${fileId}`, {
    headers: { 'x-signote-encryption-generation': String(generation) },
  });
  if (!response.ok()) throw new Error(`File read failed: ${response.status()}`);
  const body = new Uint8Array(await response.body());
  const plain = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Uint8Array.from(atob(row.encryptionIv), (c) => c.charCodeAt(0)) },
    await fileEncryptionKey(mekBytes, ['decrypt']),
    body,
  );
  return new Uint8Array(plain);
}
