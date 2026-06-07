import { SealNoteModel } from '@/models/SealNote';
import { type EncryptedPayload } from '@/types/crypto';
import { commonOps, createEntity, getByIdActive, listByUserId } from './common';

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
  return SealNoteModel.findByIdAndUpdate(id, { ...data, updatedAt: new Date() }, { returnDocument: 'after' }).exec();
};
