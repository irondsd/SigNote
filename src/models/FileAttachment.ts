import { type HydratedDocument, model, models, Schema } from 'mongoose';

export type NoteTier = 'note' | 'secret' | 'seal';

export type FileAttachment = {
  userId: string;
  noteId: string | null;
  noteTier: NoteTier | null;
  s3Key: string;
  filename: string;
  size: number;
  mimeType: string;
  createdAt: Date;
  deletedAt: Date | null;
  storageDeletedAt: Date | null;
  deleteAttempts: number;
  lastDeleteError: string | null;
};

export type FileAttachmentDocument = HydratedDocument<FileAttachment>;

const fileAttachmentSchema = new Schema<FileAttachment>({
  userId: { type: String, required: true },
  noteId: { type: String, default: null },
  noteTier: { type: String, enum: ['note', 'secret', 'seal'], default: null },
  s3Key: { type: String, required: true },
  filename: { type: String, required: true },
  size: { type: Number, required: true },
  mimeType: { type: String, required: true },
  createdAt: { type: Date, required: true, default: () => new Date() },
  deletedAt: { type: Date, default: null },
  storageDeletedAt: { type: Date, default: null },
  deleteAttempts: { type: Number, default: 0 },
  lastDeleteError: { type: String, default: null },
});

fileAttachmentSchema.index({ userId: 1 });
fileAttachmentSchema.index({ noteId: 1 });
fileAttachmentSchema.index({ storageDeletedAt: 1 }, { expireAfterSeconds: 3600, sparse: true });

export const FileAttachmentModel =
  models.FileAttachment || model<FileAttachment>('FileAttachment', fileAttachmentSchema);
