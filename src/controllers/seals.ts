import { sealTier } from '@/db/tiers';
import type { TierHeadRow } from '@/db/tier';
import { type EncryptedPayload } from '@/types/crypto';

export type SealRow = TierHeadRow & {
  encryptedBody: EncryptedPayload | null;
  wrappedNoteKey: EncryptedPayload | null;
};

const samePayload = (a: EncryptedPayload | null, b: EncryptedPayload | null): boolean => {
  if (a === null || b === null) return a === b;
  return a.alg === b.alg && a.iv === b.iv && a.ciphertext === b.ciphertext;
};

export const sealOps = sealTier.ops;
export const deleteSeal = sealOps.softDelete;
export const undeleteSeal = sealOps.restore;
export const archiveSeal = sealOps.archive;
export const unarchiveSeal = sealOps.unarchive;
export const updateSealColor = sealOps.updateColor;
export const updateSealPattern = sealOps.updatePattern;
export const updateSealPosition = sealOps.updatePosition;

export const updateSealTags = sealOps.updateTags;

export const createSeal = (
  userId: string,
  title: string,
  encryptedBody: EncryptedPayload | null = null,
  wrappedNoteKey: EncryptedPayload | null = null,
  color?: string | null,
  pattern?: string | null,
  tags?: string[],
) => sealTier.create(userId, { title, encryptedBody, wrappedNoteKey }, color, pattern, tags) as Promise<SealRow>;

export const getSealsByUserId = (
  userId: string,
  archived?: boolean,
  limit = 30,
  offset = 0,
  search = '',
  tagIds?: string[],
  tagMode: 'or' | 'and' = 'or',
) => sealTier.list(userId, { archived, limit, offset, search, tagIds, tagMode }) as Promise<SealRow[]>;

export const getSealById = (id: string) => sealTier.getByIdActive(id) as Promise<SealRow | null>;
export const getSealVersions = (id: string) => sealTier.getVersionsByIdActive(id);
export const deleteSealVersion = (id: string, versionId: string) =>
  sealTier.deleteVersionById(id, versionId) as Promise<SealRow | null>;

type UpdateSealInput = {
  title?: string;
  encryptedBody?: EncryptedPayload | null;
  wrappedNoteKey?: EncryptedPayload | null;
};

export const updateSeal = (id: string, data: UpdateSealInput) =>
  sealTier.updateWithVersion(id, (head) => {
    const headBody = head.encryptedBody as EncryptedPayload | null;
    const nextTitle = data.title !== undefined ? data.title : (head.title as string);
    const nextBody = data.encryptedBody !== undefined ? data.encryptedBody : headBody;

    // Only title/body changes are versioned. A wrappedNoteKey-only change
    // (rare) still writes through but records no version. The snapshot is
    // stamped with when its content was *saved* (the head's updatedAt).
    const titleOrBodyChanged = nextTitle !== head.title || !samePayload(headBody, nextBody);

    return {
      changed: true,
      set: { ...data },
      snapshot: titleOrBodyChanged
        ? { title: head.title, encryptedBody: headBody, createdAt: head.updatedAt as Date }
        : null,
    };
  }) as Promise<SealRow | null>;

/**
 * See `restoreNoteVersion`. The head's wrappedNoteKey is intentionally left
 * untouched — the per-note NEK never rotates and decrypts every version body.
 */
export const restoreSealVersion = (id: string, versionId: string) =>
  sealTier.restoreVersion(
    id,
    versionId,
    (version) => ({ title: version.title, encryptedBody: version.encryptedBody }),
    (head) => ({ title: head.title, encryptedBody: head.encryptedBody }),
  ) as Promise<SealRow | null>;
