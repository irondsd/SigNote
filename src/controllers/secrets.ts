import { SecretNoteModel } from '@/models/SecretNote';
import { type EncryptedPayload } from '@/types/crypto';
import { commonOps, createEntity, getByIdActive, listByUserId } from './common';

export const secretOps = commonOps(SecretNoteModel);
export const deleteSecret = secretOps.softDelete;
export const undeleteSecret = secretOps.restore;
export const archiveSecret = secretOps.archive;
export const unarchiveSecret = secretOps.unarchive;
export const updateSecretColor = secretOps.updateColor;
export const updateSecretPattern = secretOps.updatePattern;
export const updateSecretPosition = secretOps.updatePosition;

export const createSecret = (
  userId: string,
  title: string,
  encryptedBody: EncryptedPayload | null,
  color?: string | null,
  pattern?: string | null,
) => createEntity(SecretNoteModel, userId, { title, encryptedBody }, color, pattern);

export const getSecretsByUserId = (userId: string, archived?: boolean, limit = 30, offset = 0, search = '') =>
  listByUserId(SecretNoteModel, userId, { archived, limit, offset, search });

export const getSecretById = (id: string) => getByIdActive(SecretNoteModel, id);

export const updateSecret = async (id: string, title: string, encryptedBody: EncryptedPayload | null) => {
  return SecretNoteModel.findByIdAndUpdate(
    id,
    { title, encryptedBody, updatedAt: new Date() },
    { returnDocument: 'after' },
  ).exec();
};
