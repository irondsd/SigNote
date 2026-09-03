import { and, desc, eq, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Address } from 'viem';
import { sealNotes } from '../../src/db/schema';
import { getOrCreateUserId } from './getOrCreateUserId';
import { testDb } from './db';
import type { NoteColor } from '../../src/config/noteStyles';

const POSITION_STEP = 1000;

/** The inserted row, plus the `_id` alias the app's API exposes — specs
 *  address seeded rows the same way the client sees them. */
export type SeededSeal = typeof sealNotes.$inferSelect & { _id: string };

const withAliasedId = (row: typeof sealNotes.$inferSelect): SeededSeal => ({ ...row, _id: row.id });
const HKDF_SEAL_WRAP_PREFIX = 'seal-wrap:v1';

export type SeedSeal = {
  title?: string;
  content?: string;
  archived?: boolean;
  color?: NoteColor | null;
  pinned?: boolean;
  expiresAt?: Date | null;
  burnAfterReading?: boolean;
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

export const seedSeals = async (address: Address, mekBytes: Uint8Array, seals: SeedSeal[]): Promise<SeededSeal[]> => {
  const db = testDb();
  const userId = await getOrCreateUserId(address);

  const subtle = globalThis.crypto.subtle;

  // Import MEK as HKDF base key
  const mek = await subtle.importKey('raw', new Uint8Array(mekBytes), 'HKDF', false, ['deriveKey']);

  // Determine starting position
  const last = await db
    .select({ position: sealNotes.position })
    .from(sealNotes)
    .where(and(eq(sealNotes.userId, userId), isNull(sealNotes.deletedAt)))
    .orderBy(desc(sealNotes.position))
    .limit(1);

  let position = (last[0]?.position ?? 0) + POSITION_STEP;

  const created: SeededSeal[] = [];

  for (const seal of seals) {
    const now = new Date();
    // Pre-generate the row id so it can double as the sealId for key derivation
    const sealId = uuidv7();
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

    const [row] = await db
      .insert(sealNotes)
      .values({
        id: sealId,
        userId,
        title: seal.title ?? '',
        encryptedBody,
        wrappedNoteKey,
        archived: seal.archived ?? false,
        color: seal.color ?? null,
        position,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        pinned: seal.pinned ?? false,
        expiresAt: seal.expiresAt ?? null,
        burnAfterReading: seal.burnAfterReading ?? false,
      })
      .returning();

    created.push(withAliasedId(row));
    position += POSITION_STEP;
  }

  return created;
};
