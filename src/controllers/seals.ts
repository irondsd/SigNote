import { MAX_SEARCH } from '@/config/constants';
import { SealNoteModel } from '@/models/SealNote';
import { type EncryptedPayload } from '@/types/crypto';
import { getNextPosition } from '@/utils/calculatePosition';
import { escapeRegExp } from '@/utils/regexUtils';
import { commonOps } from './common';

export const sealOps = commonOps(SealNoteModel);
export const deleteSeal = sealOps.softDelete;
export const undeleteSeal = sealOps.restore;
export const archiveSeal = sealOps.archive;
export const unarchiveSeal = sealOps.unarchive;
export const updateSealColor = sealOps.updateColor;
export const updateSealPattern = sealOps.updatePattern;
export const updateSealPosition = sealOps.updatePosition;

export const createSeal = async (
  userId: string,
  title: string,
  encryptedBody: EncryptedPayload | null = null,
  wrappedNoteKey: EncryptedPayload | null = null,
  color?: string | null,
  pattern?: string | null,
) => {
  const now = new Date();
  const position = await getNextPosition(SealNoteModel, userId);

  return SealNoteModel.create({
    userId,
    title,
    encryptedBody,
    wrappedNoteKey,
    position,
    ...(color != null && { color }),
    ...(pattern != null && { pattern }),
    createdAt: now,
    updatedAt: now,
  });
};

export const getSealsByUserId = async (userId: string, archived?: boolean, limit = 30, offset = 0, search = '') => {
  const baseQuery = { userId, ...(archived !== undefined && { archived }), deletedAt: null };
  const normalized = search.trim().slice(0, MAX_SEARCH);

  if (!normalized) {
    return SealNoteModel.find(baseQuery).sort({ position: -1 }).skip(offset).limit(limit).exec();
  }

  return SealNoteModel.find({
    ...baseQuery,
    title: { $regex: new RegExp(escapeRegExp(normalized), 'i') },
  })
    .sort({ updatedAt: -1 })
    .skip(offset)
    .limit(limit)
    .exec();
};

export const getSealById = async (id: string) => {
  return SealNoteModel.findById(id).exec();
};

type UpdateSealInput = {
  title?: string;
  encryptedBody?: EncryptedPayload | null;
  wrappedNoteKey?: EncryptedPayload | null;
};

export const updateSeal = async (id: string, data: UpdateSealInput) => {
  return SealNoteModel.findByIdAndUpdate(id, { ...data, updatedAt: new Date() }, { returnDocument: 'after' }).exec();
};
