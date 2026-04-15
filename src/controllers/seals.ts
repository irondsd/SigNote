import { MAX_SEARCH } from '@/config/constants';
import { SealNoteModel } from '@/models/SealNote';
import { type EncryptedPayload } from '@/types/crypto';
import { getNextPosition } from '@/utils/calculatePosition';
import { escapeRegExp } from '@/utils/regexUtils';

export const createSeal = async (
  userId: string,
  title: string,
  encryptedBody: EncryptedPayload | null = null,
  wrappedNoteKey: EncryptedPayload | null = null,
  color?: string | null,
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

  // Content is encrypted ciphertext — full-text search is only possible on title
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

export const deleteSeal = async (id: string) => {
  return SealNoteModel.findByIdAndUpdate(id, { deletedAt: new Date() }, { returnDocument: 'after' }).exec();
};

export const undeleteSeal = async (id: string) => {
  return SealNoteModel.findByIdAndUpdate(id, { deletedAt: null }, { returnDocument: 'after' }).exec();
};

export const archiveSeal = async (id: string) => {
  return SealNoteModel.findByIdAndUpdate(id, { archived: true }, { returnDocument: 'after' }).exec();
};

export const unarchiveSeal = async (id: string) => {
  return SealNoteModel.findByIdAndUpdate(id, { archived: false }, { returnDocument: 'after' }).exec();
};

export const updateSealColor = async (id: string, color: string | null) => {
  return SealNoteModel.findByIdAndUpdate(id, { color }, { returnDocument: 'after' }).exec();
};

export const updateSealPosition = async (id: string, position: number) => {
  return SealNoteModel.findByIdAndUpdate(id, { position }, { returnDocument: 'after' }).exec();
};
