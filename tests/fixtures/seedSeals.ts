import mongoose from 'mongoose';
import type { Address } from 'viem';
import { SealNoteModel, type SealNoteDocument } from '../../src/models/SealNote';
import type { NoteColor } from '../../src/config/noteColors';

const MONGO_TEST_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018/';
const MONGO_TEST_DB = process.env.MONGODB_DB ?? 'signote-test';
const POSITION_STEP = 1000;
const HKDF_SEAL_WRAP_PREFIX = 'seal-wrap:v1';

export type SeedSeal = {
  title?: string;
  content?: string;
  archived?: boolean;
  color?: NoteColor | null;
};

function toBase64(buf: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf instanceof ArrayBuffer ? buf : buf)));
}

async function encryptBodyWithNek(nekKey: CryptoKey, plaintext: string, aad: string) {
  const subtle = globalThis.crypto.subtle;
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) },
    nekKey,
    new TextEncoder().encode(plaintext),
  );
  return { alg: 'A256GCM' as const, iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
}

async function wrapNekBytes(sealWrapKey: CryptoKey, nekBytes: Uint8Array, aad: string) {
  const subtle = globalThis.crypto.subtle;
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) },
    sealWrapKey,
    nekBytes.buffer as ArrayBuffer,
  );
  return { alg: 'A256GCM' as const, iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
}

export const seedSeals = async (
  address: Address,
  mekBytes: Uint8Array,
  seals: SeedSeal[],
): Promise<SealNoteDocument[]> => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_TEST_URI, { dbName: MONGO_TEST_DB });
  }

  const subtle = globalThis.crypto.subtle;

  // Import MEK as HKDF base key
  const mek = await subtle.importKey('raw', new Uint8Array(mekBytes), 'HKDF', false, ['deriveKey']);

  // Determine starting position
  const lastSeal = await SealNoteModel.findOne({ address, deletedAt: null })
    .sort({ position: -1 })
    .select({ position: 1 })
    .lean()
    .exec();

  let position = (lastSeal?.position ?? 0) + POSITION_STEP;

  const created: SealNoteDocument[] = [];

  for (const seal of seals) {
    const now = new Date();
    // Pre-generate ObjectId so we can use it as the sealId for key derivation
    const sealObjectId = new mongoose.Types.ObjectId();
    const sealId = sealObjectId.toString();
    const aad = `${HKDF_SEAL_WRAP_PREFIX}:${sealId}`;

    let encryptedBody = null;
    let wrappedNoteKey = null;

    if (seal.content?.trim()) {
      // Generate random Note Encryption Key (NEK)
      const nekBytes = globalThis.crypto.getRandomValues(new Uint8Array(32));

      // Import NEK as AES-GCM key for body encryption
      const nekKey = await subtle.importKey('raw', nekBytes, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);

      // Encrypt body with NEK + AAD
      encryptedBody = await encryptBodyWithNek(nekKey, seal.content.trim(), aad);

      // Derive seal wrapping key from MEK + sealId via HKDF
      const sealWrapKey = await subtle.deriveKey(
        {
          name: 'HKDF',
          hash: 'SHA-256',
          salt: new Uint8Array(32),
          info: new TextEncoder().encode(aad),
        },
        mek,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt'],
      );

      // Wrap NEK with sealWrapKey + AAD
      wrappedNoteKey = await wrapNekBytes(sealWrapKey, nekBytes, aad);
    }

    const doc = await SealNoteModel.create({
      _id: sealObjectId,
      address,
      title: seal.title ?? '',
      encryptedBody,
      wrappedNoteKey,
      archived: seal.archived ?? false,
      color: seal.color ?? null,
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
