import { isValidObjectId, Types } from 'mongoose';
import { MAX_VERSIONS } from '@/config/constants';
import { SecretNoteModel } from '@/models/SecretNote';
import { type EncryptedPayload } from '@/types/crypto';
import { commonOps, createEntity, getByIdActive, getVersionsByIdActive, listByUserId } from './common';
import { buildVersionPush } from './versions';

// Plain-object copy of an encrypted payload (strips mongoose subdoc internals so
// it can be safely embedded in the versions array).
const clonePayload = (p: EncryptedPayload | null): EncryptedPayload | null =>
  p ? { alg: p.alg, iv: p.iv, ciphertext: p.ciphertext } : null;

const samePayload = (a: EncryptedPayload | null, b: EncryptedPayload | null): boolean => {
  if (a === null || b === null) return a === b;
  return a.alg === b.alg && a.iv === b.iv && a.ciphertext === b.ciphertext;
};

export const secretOps = commonOps(SecretNoteModel);
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
) => createEntity(SecretNoteModel, userId, { title, encryptedBody }, color, pattern, tags);

export const getSecretsByUserId = (
  userId: string,
  archived?: boolean,
  limit = 30,
  offset = 0,
  search = '',
  tagIds?: string[],
  tagMode: 'or' | 'and' = 'or',
) => listByUserId(SecretNoteModel, userId, { archived, limit, offset, search, tagIds, tagMode });

export const getSecretById = (id: string) => getByIdActive(SecretNoteModel, id);
export const getSecretVersions = (id: string) => getVersionsByIdActive(SecretNoteModel, id);

export const updateSecret = async (id: string, title: string, encryptedBody: EncryptedPayload | null) => {
  // $slice keeps every other field but loads only the newest version — all the
  // no-op check and the compression-window decision need.
  const doc = await SecretNoteModel.findById(id)
    .select({ versions: { $slice: -1 } })
    .exec();
  if (!doc) return null;

  // No-op edit: identical title and ciphertext. (Re-encryption changes the IV,
  // so this only short-circuits genuine no-change PATCHes, not content re-saves.)
  // Re-read without the version slice so the response carries no history.
  if (doc.title === title && samePayload(doc.encryptedBody, encryptedBody)) {
    return SecretNoteModel.findById(id).select('-versions').exec();
  }

  const now = new Date();
  const versionPush = buildVersionPush(doc, {
    title: doc.title,
    encryptedBody: clonePayload(doc.encryptedBody),
    createdAt: now,
  });

  return SecretNoteModel.findByIdAndUpdate(
    id,
    { $set: { title, encryptedBody, updatedAt: now }, ...versionPush },
    { returnDocument: 'after', projection: { versions: 0 } },
  ).exec();
};

/** See `restoreNoteVersion` — same semantics for the secret tier. */
export const restoreSecretVersion = async (id: string, versionId: string) => {
  if (!isValidObjectId(versionId)) return null;

  // $elemMatch loads only the targeted version alongside the head fields.
  const doc = await SecretNoteModel.findById(id)
    .select({ title: 1, encryptedBody: 1, versions: { $elemMatch: { _id: new Types.ObjectId(versionId) } } })
    .exec();
  if (!doc) return null;

  const version = doc.versions?.[0];
  if (!version) return null;

  const now = new Date();

  return SecretNoteModel.findByIdAndUpdate(
    id,
    {
      $set: { title: version.title, encryptedBody: clonePayload(version.encryptedBody), updatedAt: now },
      $push: {
        versions: {
          $each: [{ title: doc.title, encryptedBody: clonePayload(doc.encryptedBody), createdAt: now }],
          $slice: -MAX_VERSIONS,
        },
      },
    },
    { returnDocument: 'after', projection: { versions: 0 } },
  ).exec();
};
