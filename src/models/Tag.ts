import { type HydratedDocument, model, models, Schema } from 'mongoose';
import { TAG_COLORS, type TagColor } from '@/config/noteStyles';

export type Tag = {
  userId: string;
  name: string;
  color: TagColor;
  createdAt: Date;
  updatedAt: Date;
};

export type TagDocument = HydratedDocument<Tag>;

const tagSchema = new Schema<Tag>({
  userId: { type: String, required: true },
  // Stored lowercased/trimmed; uniqueness is enforced per user below.
  name: { type: String, required: true },
  color: { type: String, enum: TAG_COLORS, required: true },
  createdAt: { type: Date, required: true, default: () => new Date() },
  updatedAt: { type: Date, required: true, default: () => new Date() },
});

// One tag name per user (case handled by storing normalized names).
tagSchema.index({ userId: 1, name: 1 }, { unique: true });

export const TagModel = models.Tag || model<Tag>('Tag', tagSchema);
