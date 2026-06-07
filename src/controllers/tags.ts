import { isValidObjectId } from 'mongoose';
import { TagModel, type TagDocument } from '@/models/Tag';
import { NoteModel } from '@/models/Note';
import { SecretNoteModel } from '@/models/SecretNote';
import { SealNoteModel } from '@/models/SealNote';
import { autoTagColor, TAG_COLORS, type TagColor } from '@/config/noteStyles';

const TIER_MODELS = [NoteModel, SecretNoteModel, SealNoteModel];

export function normalizeTagName(name: string): string {
  return name.trim().toLowerCase().slice(0, 50);
}

export function isValidTagColor(color: unknown): color is TagColor {
  return typeof color === 'string' && (TAG_COLORS as readonly string[]).includes(color);
}

export const listTags = (userId: string) => TagModel.find({ userId }).sort({ name: 1 }).exec();

export const getTagById = (id: string) => TagModel.findById(id).exec();

// Subset of `ids` that are valid ObjectIds AND owned by the user. Used to
// sanitize a note's incoming tag list so a note can never reference a foreign
// or deleted tag.
export async function getOwnedTagIds(userId: string, ids: string[]): Promise<string[]> {
  const candidates = [...new Set(ids)].filter((id) => isValidObjectId(id));
  if (candidates.length === 0) return [];
  const owned = await TagModel.find({ userId, _id: { $in: candidates } })
    .select('_id')
    .exec();
  const ownedSet = new Set(owned.map((t) => t._id.toString()));
  // Preserve incoming order, drop anything not owned.
  return candidates.filter((id) => ownedSet.has(id));
}

// Usage counts per tag id, aggregated across all three tiers (active docs only).
export async function getTagUsageCounts(userId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  await Promise.all(
    TIER_MODELS.map(async (model) => {
      const rows = await model.aggregate<{ _id: string; n: number }>([
        { $match: { userId, deletedAt: null } },
        { $unwind: '$tags' },
        { $group: { _id: '$tags', n: { $sum: 1 } } },
      ]);
      for (const row of rows) counts[row._id] = (counts[row._id] || 0) + row.n;
    }),
  );
  return counts;
}

// Create a tag, or return the existing one if the name is already taken (the
// picker's "create" path is idempotent). Color defaults to the auto-assigned
// hue when not supplied.
export async function createTag(userId: string, rawName: string, color?: string | null): Promise<TagDocument> {
  const name = normalizeTagName(rawName);
  const existing = await TagModel.findOne({ userId, name }).exec();
  if (existing) return existing;
  const resolvedColor = isValidTagColor(color) ? color : autoTagColor(name);
  return TagModel.create({ userId, name, color: resolvedColor });
}

export async function renameTag(id: string, rawName: string): Promise<TagDocument | null> {
  const name = normalizeTagName(rawName);
  return TagModel.findByIdAndUpdate(id, { name, updatedAt: new Date() }, { returnDocument: 'after' }).exec();
}

export async function recolorTag(id: string, color: TagColor): Promise<TagDocument | null> {
  return TagModel.findByIdAndUpdate(id, { color, updatedAt: new Date() }, { returnDocument: 'after' }).exec();
}

// Delete the tag and detach its id from every note/secret/seal that referenced it.
export async function deleteTagAndDetach(id: string): Promise<void> {
  await Promise.all([
    TagModel.findByIdAndDelete(id).exec(),
    ...TIER_MODELS.map((model) => model.updateMany({ tags: id }, { $pull: { tags: id } }).exec()),
  ]);
}

// Whether another tag (besides `excludeId`) already uses this name for the user.
export async function tagNameTaken(userId: string, name: string, excludeId: string): Promise<boolean> {
  const existing = await TagModel.findOne({ userId, name: normalizeTagName(name) }).select('_id').exec();
  return existing !== null && existing._id.toString() !== excludeId;
}
