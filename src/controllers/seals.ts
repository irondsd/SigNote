import { MAX_VERSIONS } from '@/config/constants';
import { SealNoteModel, type SealNoteVersion } from '@/models/SealNote';
import { type EncryptedPayload } from '@/types/crypto';
import { commonOps, createEntity, getByIdActive, listByUserId } from './common';
import { buildVersionPush } from './versions';

const clonePayload = (p: EncryptedPayload | null): EncryptedPayload | null =>
  p ? { alg: p.alg, iv: p.iv, ciphertext: p.ciphertext } : null;

const samePayload = (a: EncryptedPayload | null, b: EncryptedPayload | null): boolean => {
  if (a === null || b === null) return a === b;
  return a.alg === b.alg && a.iv === b.iv && a.ciphertext === b.ciphertext;
};

export const sealOps = commonOps(SealNoteModel);
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
) => createEntity(SealNoteModel, userId, { title, encryptedBody, wrappedNoteKey }, color, pattern, tags);

export const getSealsByUserId = (
  userId: string,
  archived?: boolean,
  limit = 30,
  offset = 0,
  search = '',
  tagIds?: string[],
  tagMode: 'or' | 'and' = 'or',
) => listByUserId(SealNoteModel, userId, { archived, limit, offset, search, tagIds, tagMode });

export const getSealById = (id: string) => getByIdActive(SealNoteModel, id);

type UpdateSealInput = {
  title?: string;
  encryptedBody?: EncryptedPayload | null;
  wrappedNoteKey?: EncryptedPayload | null;
};

export const updateSeal = async (id: string, data: UpdateSealInput) => {
  const doc = await SealNoteModel.findById(id).exec();
  if (!doc) return null;

  const now = new Date();
  const nextTitle = data.title !== undefined ? data.title : doc.title;
  const nextBody = data.encryptedBody !== undefined ? data.encryptedBody : doc.encryptedBody;

  // Only title/body changes are versioned. A wrappedNoteKey-only change (rare)
  // still writes through but records no version.
  const titleOrBodyChanged = nextTitle !== doc.title || !samePayload(doc.encryptedBody, nextBody);
  const versionPush = titleOrBodyChanged
    ? buildVersionPush(doc, { title: doc.title, encryptedBody: clonePayload(doc.encryptedBody), createdAt: now })
    : {};

  return SealNoteModel.findByIdAndUpdate(
    id,
    { $set: { ...data, updatedAt: now }, ...versionPush },
    { returnDocument: 'after' },
  ).exec();
};

/**
 * See `restoreNoteVersion`. The head's wrappedNoteKey is intentionally left
 * untouched — the per-note NEK never rotates and decrypts every version body.
 */
export const restoreSealVersion = async (id: string, versionId: string) => {
  const doc = await SealNoteModel.findById(id).exec();
  if (!doc) return null;

  const version = doc.versions.find((v: SealNoteVersion) => v._id.toString() === versionId);
  if (!version) return null;

  const now = new Date();

  return SealNoteModel.findByIdAndUpdate(
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
    { returnDocument: 'after' },
  ).exec();
};
