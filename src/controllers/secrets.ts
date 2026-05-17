import { MAX_SEARCH } from '@/config/constants';
import { SecretNoteModel } from '@/models/SecretNote';
import { type EncryptedPayload } from '@/types/crypto';
import { getNextPosition } from '@/utils/calculatePosition';
import { escapeRegExp } from '@/utils/regexUtils';
import { commonOps } from './common';

export const secretOps = commonOps(SecretNoteModel);
export const deleteSecret = secretOps.softDelete;
export const undeleteSecret = secretOps.restore;
export const archiveSecret = secretOps.archive;
export const unarchiveSecret = secretOps.unarchive;
export const updateSecretColor = secretOps.updateColor;
export const updateSecretPattern = secretOps.updatePattern;
export const updateSecretPosition = secretOps.updatePosition;

export const createSecret = async (
  userId: string,
  title: string,
  encryptedBody: EncryptedPayload | null,
  color?: string | null,
  pattern?: string | null,
) => {
  const now = new Date();
  const position = await getNextPosition(SecretNoteModel, userId);

  return SecretNoteModel.create({
    userId,
    title,
    encryptedBody,
    position,
    ...(color != null && { color }),
    ...(pattern != null && { pattern }),
    createdAt: now,
    updatedAt: now,
  });
};

export const getSecretsByUserId = async (userId: string, archived?: boolean, limit = 30, offset = 0, search = '') => {
  const baseQuery = { userId, ...(archived !== undefined && { archived }), deletedAt: null };
  const normalized = search.trim().slice(0, MAX_SEARCH);

  if (!normalized) {
    return SecretNoteModel.find(baseQuery).sort({ position: -1 }).skip(offset).limit(limit).exec();
  }

  return SecretNoteModel.find({
    ...baseQuery,
    title: { $regex: new RegExp(escapeRegExp(normalized), 'i') },
  })
    .sort({ updatedAt: -1 })
    .skip(offset)
    .limit(limit)
    .exec();
};

export const getSecretById = async (id: string) => {
  return SecretNoteModel.findById(id).exec();
};

export const updateSecret = async (id: string, title: string, encryptedBody: EncryptedPayload | null) => {
  return SecretNoteModel.findByIdAndUpdate(
    id,
    { title, encryptedBody, updatedAt: new Date() },
    { returnDocument: 'after' },
  ).exec();
};
