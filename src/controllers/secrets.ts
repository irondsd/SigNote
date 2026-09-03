import { secretTier } from '@/db/tiers';
import type { TierHeadRow } from '@/db/tier';
import { type EncryptedPayload } from '@/types/crypto';

export type SecretRow = TierHeadRow & { encryptedBody: EncryptedPayload | null };

const samePayload = (a: EncryptedPayload | null, b: EncryptedPayload | null): boolean => {
  if (a === null || b === null) return a === b;
  return a.alg === b.alg && a.iv === b.iv && a.ciphertext === b.ciphertext;
};

export const secretOps = secretTier.ops;
export const deleteSecret = secretOps.softDelete;
export const undeleteSecret = secretOps.restore;
export const archiveSecret = secretOps.archive;
export const unarchiveSecret = secretOps.unarchive;
export const updateSecretColor = secretOps.updateColor;
export const updateSecretPattern = secretOps.updatePattern;
export const updateSecretPosition = secretOps.updatePosition;

export const updateSecretTags = secretOps.updateTags;

export const createSecret = (
  userId: string,
  title: string,
  encryptedBody: EncryptedPayload | null,
  color?: string | null,
  pattern?: string | null,
  tags?: string[],
) => secretTier.create(userId, { title, encryptedBody }, color, pattern, tags) as Promise<SecretRow>;

export const getSecretsByUserId = (
  userId: string,
  archived?: boolean,
  limit = 30,
  offset = 0,
  search = '',
  tagIds?: string[],
  tagMode: 'or' | 'and' = 'or',
) => secretTier.list(userId, { archived, limit, offset, search, tagIds, tagMode }) as Promise<SecretRow[]>;

export const getSecretById = (id: string) => secretTier.getByIdActive(id) as Promise<SecretRow | null>;
export const getSecretVersions = (id: string) => secretTier.getVersionsByIdActive(id);
export const deleteSecretVersion = (id: string, versionId: string) =>
  secretTier.deleteVersionById(id, versionId) as Promise<SecretRow | null>;

export const updateSecret = (id: string, title: string, encryptedBody: EncryptedPayload | null) =>
  secretTier.updateWithVersion(id, (head) => {
    const headBody = head.encryptedBody as EncryptedPayload | null;
    return {
      // No-op edit: identical title and ciphertext. (Re-encryption changes the
      // IV, so this only short-circuits genuine no-change PATCHes, not content
      // re-saves.)
      changed: !(head.title === title && samePayload(headBody, encryptedBody)),
      set: { title, encryptedBody },
      snapshot: { title: head.title, encryptedBody: headBody, createdAt: head.updatedAt as Date },
    };
  }) as Promise<SecretRow | null>;

/** See `restoreNoteVersion` — same semantics for the secret tier. */
export const restoreSecretVersion = (id: string, versionId: string) =>
  secretTier.restoreVersion(
    id,
    versionId,
    (version) => ({ title: version.title, encryptedBody: version.encryptedBody }),
    (head) => ({ title: head.title, encryptedBody: head.encryptedBody }),
  ) as Promise<SecretRow | null>;
