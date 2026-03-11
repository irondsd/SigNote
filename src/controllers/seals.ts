import { type Address } from 'viem';
import { POSITION_STEP } from '@/config/constants';
import { SealNoteModel } from '@/models/SealNote';
import { type EncryptedPayload } from '@/models/EncryptionProfile';

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const getNextPosition = async (address: Address) => {
  const last = await SealNoteModel.findOne({ address, deletedAt: null })
    .sort({ position: -1 })
    .select({ position: 1 })
    .lean()
    .exec();

  return (last?.position ?? 0) + POSITION_STEP;
};

export const createSeal = async (address: Address, title: string, encryptedBody: EncryptedPayload | null = null, wrappedNoteKey: EncryptedPayload | null = null) => {
  const now = new Date();
  const position = await getNextPosition(address);

  return SealNoteModel.create({
    address,
    title,
    encryptedBody,
    wrappedNoteKey,
    position,
    createdAt: now,
    updatedAt: now,
  });
};

export const getSealsByAddress = async (
  address: string,
  archived?: boolean,
  limit = 30,
  offset = 0,
  search = '',
) => {
  const baseQuery = { address, ...(archived !== undefined && { archived }), deletedAt: null };
  const normalized = search.trim();

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
  return SealNoteModel.findByIdAndUpdate(
    id,
    { ...data, updatedAt: new Date() },
    { returnDocument: 'after' },
  ).exec();
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
