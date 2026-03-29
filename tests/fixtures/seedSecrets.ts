import mongoose from 'mongoose';
import type { Address } from 'viem';
import { SecretNoteModel, type SecretNoteDocument } from '../../src/models/SecretNote';
import { getOrCreateUserId } from './getOrCreateUserId';
import type { NoteColor } from '../../src/config/noteColors';

const MONGO_TEST_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018/';
const MONGO_TEST_DB = process.env.MONGODB_DB ?? 'signote-test';
const POSITION_STEP = 1000;
const HKDF_INFO_SECRET_BODY = 'secret-body:v1';

export type SeedSecret = {
  title?: string;
  content?: string;
  archived?: boolean;
  color?: NoteColor | null;
};

function toBase64(buf: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf instanceof ArrayBuffer ? buf : buf)));
}

async function encryptContent(secretBodyKey: CryptoKey, plaintext: string) {
  const subtle = globalThis.crypto.subtle;
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, secretBodyKey, new TextEncoder().encode(plaintext));
  return { alg: 'A256GCM' as const, iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
}

export const seedSecrets = async (
  address: Address,
  mekBytes: Uint8Array,
  secrets: SeedSecret[],
): Promise<SecretNoteDocument[]> => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_TEST_URI, { dbName: MONGO_TEST_DB });
  }

  const userId = await getOrCreateUserId(address);

  const subtle = globalThis.crypto.subtle;

  // Import MEK as HKDF base key
  const mek = await subtle.importKey('raw', new Uint8Array(mekBytes), 'HKDF', false, ['deriveKey']);

  // Derive secret body key via HKDF
  const secretBodyKey = await subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: new TextEncoder().encode(HKDF_INFO_SECRET_BODY),
    },
    mek,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );

  // Determine starting position
  const lastSecret = await SecretNoteModel.findOne({ userId, deletedAt: null })
    .sort({ position: -1 })
    .select({ position: 1 })
    .lean()
    .exec();

  let position = (lastSecret?.position ?? 0) + POSITION_STEP;

  const created: SecretNoteDocument[] = [];
  for (const secret of secrets) {
    const now = new Date();
    const encryptedBody = secret.content?.trim() ? await encryptContent(secretBodyKey, secret.content.trim()) : null;

    const doc = await SecretNoteModel.create({
      userId,
      title: secret.title ?? '',
      encryptedBody,
      archived: secret.archived ?? false,
      color: secret.color ?? null,
      position,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    created.push(doc);
    position += POSITION_STEP;
  }

  return created;
};
