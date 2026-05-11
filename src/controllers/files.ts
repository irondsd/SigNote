import mongoose from 'mongoose';
import { FileAttachmentModel } from '@/models/FileAttachment';
import { deleteFromS3, uploadToS3 } from '@/lib/s3';
import { MAX_FILE_SIZE, MAX_USER_STORAGE, ALLOWED_MIME_TYPES } from '@/config/fileConstants';

export { MAX_FILE_SIZE, ALLOWED_MIME_TYPES };

export async function getUserStorageUsed(userId: string): Promise<number> {
  const result = await FileAttachmentModel.aggregate([
    { $match: { userId, deletedAt: null } },
    { $group: { _id: null, total: { $sum: '$size' } } },
  ]);
  return result[0]?.total ?? 0;
}

export async function createFileAttachment(
  userId: string,
  file: {
    filename: string;
    size: number;
    mimeType: string;
    buffer: Buffer;
    encrypted?: boolean;
    encryptionIv?: string;
  },
) {
  if (file.buffer.length > MAX_FILE_SIZE) {
    throw new Error('File too large');
  }
  if (!file.encrypted && !ALLOWED_MIME_TYPES.has(file.mimeType)) {
    throw new Error('File type not allowed');
  }

  const used = await getUserStorageUsed(userId);
  if (used + file.size > MAX_USER_STORAGE) {
    throw new Error('Storage quota exceeded');
  }

  const fileId = new mongoose.Types.ObjectId();
  const s3Key = file.encrypted
    ? `uploads/${userId}/${fileId}/encrypted`
    : `uploads/${userId}/${fileId}/${file.filename}`;
  const s3ContentType = file.encrypted ? 'application/octet-stream' : file.mimeType;

  await uploadToS3(s3Key, file.buffer, s3ContentType);

  const doc = await FileAttachmentModel.create({
    _id: fileId,
    userId,
    filename: file.filename,
    size: file.size,
    mimeType: file.mimeType,
    s3Key,
    encrypted: file.encrypted ?? false,
    encryptionIv: file.encryptionIv ?? null,
    createdAt: new Date(),
  });

  return doc;
}

export async function getFileAttachment(id: string, userId: string) {
  const doc = await FileAttachmentModel.findOne({ _id: id, userId, deletedAt: null });
  return doc;
}

export async function deleteFileAttachment(id: string, userId: string) {
  const doc = await FileAttachmentModel.findOne({ _id: id, userId, deletedAt: null });
  if (!doc) return null;

  doc.deletedAt = new Date();
  await doc.save();
  return doc;
}

export async function linkFilesToNote(
  userId: string,
  noteId: string,
  noteTier: 'note' | 'secret' | 'seal',
  fileIds: string[],
) {
  if (!fileIds.length) return;
  await FileAttachmentModel.updateMany(
    { _id: { $in: fileIds }, userId, deletedAt: null },
    { $set: { noteId, noteTier } },
  );
}

export async function softDeleteFilesByNoteId(noteId: string) {
  await FileAttachmentModel.updateMany({ noteId, deletedAt: null }, { $set: { deletedAt: new Date() } });
}

export async function restoreFilesByNoteId(noteId: string, userId: string) {
  await FileAttachmentModel.updateMany({ noteId, userId }, { $set: { deletedAt: null } });
}

export async function deleteFilesByUserId(userId: string) {
  await FileAttachmentModel.updateMany({ userId, deletedAt: null }, { $set: { deletedAt: new Date() } });
}

const MAX_DELETE_ATTEMPTS = 5;

export async function cleanupDeletedFiles(batchSize = 50) {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000);

  const files = await FileAttachmentModel.find({
    deletedAt: { $lte: cutoff },
    storageDeletedAt: null,
    deleteAttempts: { $lt: MAX_DELETE_ATTEMPTS },
  })
    .limit(batchSize)
    .exec();

  let deleted = 0;
  let failed = 0;

  for (const file of files) {
    try {
      await deleteFromS3(file.s3Key);
      file.storageDeletedAt = new Date();
      await file.save();
      deleted++;
    } catch (err) {
      file.deleteAttempts += 1;
      file.lastDeleteError = err instanceof Error ? err.message : String(err);
      await file.save();
      failed++;
    }
  }

  return { processed: files.length, deleted, failed };
}
