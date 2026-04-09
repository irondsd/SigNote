import { MAX_SEARCH, POSITION_STEP } from '@/config/constants';
import { SecretNoteModel } from '@/models/SecretNote';
import { type EncryptedPayload } from '@/types/crypto';

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const getNextPosition = async (userId: string) => {
  const last = await SecretNoteModel.findOne({ userId, deletedAt: null })
    .sort({ position: -1 })
    .select({ position: 1 })
    .lean()
    .exec();

  return (last?.position ?? 0) + POSITION_STEP;
};

export const createSecret = async (userId: string, title: string, encryptedBody: EncryptedPayload | null) => {
  const now = new Date();
  const position = await getNextPosition(userId);

  return SecretNoteModel.create({
    userId,
    title,
    encryptedBody,
    position,
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

export const deleteSecret = async (id: string) => {
  return SecretNoteModel.findByIdAndUpdate(id, { deletedAt: new Date() }, { returnDocument: 'after' }).exec();
};

export const undeleteSecret = async (id: string) => {
  return SecretNoteModel.findByIdAndUpdate(id, { deletedAt: null }, { returnDocument: 'after' }).exec();
};

export const archiveSecret = async (id: string) => {
  return SecretNoteModel.findByIdAndUpdate(id, { archived: true }, { returnDocument: 'after' }).exec();
};

export const unarchiveSecret = async (id: string) => {
  return SecretNoteModel.findByIdAndUpdate(id, { archived: false }, { returnDocument: 'after' }).exec();
};

export const updateSecretColor = async (id: string, color: string | null) => {
  return SecretNoteModel.findByIdAndUpdate(id, { color }, { returnDocument: 'after' }).exec();
};

export const updateSecretPosition = async (id: string, position: number) => {
  return SecretNoteModel.findByIdAndUpdate(id, { position }, { returnDocument: 'after' }).exec();
};
