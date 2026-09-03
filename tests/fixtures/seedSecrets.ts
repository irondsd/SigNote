import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Address } from 'viem';
import { secretNotes } from '../../src/db/schema';
import { getOrCreateUserId } from './getOrCreateUserId';
import { testDb } from './db';
import type { NoteColor } from '../../src/config/noteStyles';

const POSITION_STEP = 1000;

/** The inserted row, plus the `_id` alias the app's API exposes — specs
 *  address seeded rows the same way the client sees them. */
export type SeededSecret = typeof secretNotes.$inferSelect & { _id: string };

const withAliasedId = (row: typeof secretNotes.$inferSelect): SeededSecret => ({ ...row, _id: row.id });
const HKDF_INFO_SECRET_BODY = 'secret-body:v1';

export type SeedSecret = {
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
): Promise<SeededSecret[]> => {
  const db = testDb();
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
  const last = await db
    .select({ position: secretNotes.position })
    .from(secretNotes)
    .where(and(eq(secretNotes.userId, userId), isNull(secretNotes.deletedAt)))
    .orderBy(desc(secretNotes.position))
    .limit(1);

  let position = (last[0]?.position ?? 0) + POSITION_STEP;

  const created: SeededSecret[] = [];
  for (const secret of secrets) {
    const now = new Date();
    const encryptedBody = secret.content?.trim() ? await encryptContent(secretBodyKey, secret.content.trim()) : null;

    const [row] = await db
      .insert(secretNotes)
      .values({
        userId,
        title: secret.title ?? '',
        encryptedBody,
        archived: secret.archived ?? false,
        color: secret.color ?? null,
        position,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        pinned: secret.pinned ?? false,
        expiresAt: secret.expiresAt ?? null,
        burnAfterReading: secret.burnAfterReading ?? false,
      })
      .returning();
    created.push(withAliasedId(row));
    position += POSITION_STEP;
  }

  return created;
};
