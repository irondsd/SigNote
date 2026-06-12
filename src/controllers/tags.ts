import { isValidObjectId, type Types } from 'mongoose';
import { TagModel, type TagDocument } from '@/models/Tag';
import { NoteModel } from '@/models/Note';
import { SecretNoteModel } from '@/models/SecretNote';
import { SealNoteModel } from '@/models/SealNote';
import { autoTagColor, TAG_COLORS, type TagColor } from '@/config/noteStyles';

const TIER_MODELS = [NoteModel, SecretNoteModel, SealNoteModel];

export function normalizeTagName(name: string): string {
  // Slice by code points, not UTF-16 units — a plain .slice() could cut an
  // emoji's surrogate pair in half and store a malformed string.
  return [...name.trim().toLowerCase()].slice(0, 50).join('');
}

// Mongo duplicate-key error (unique index violation), thrown when a concurrent
// write wins the { userId, name } uniqueness race.
export function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 11000;
}

export function isValidTagColor(color: unknown): color is TagColor {
  return typeof color === 'string' && (TAG_COLORS as readonly string[]).includes(color);
}

// Default ordering is most-recently-used first (never-used tags fall to the
// bottom, alphabetised). The tags management page re-sorts by creation date.
export const listTags = (userId: string) => TagModel.find({ userId }).sort({ lastUsedAt: -1, name: 1 }).exec();

// Bump lastUsedAt for the given tags so they float to the top of the picker.
// Fire-and-forget at call sites; never throws.
export async function touchTags(ids: string[]): Promise<void> {
  const validIds = ids.filter((id) => isValidObjectId(id));
  if (validIds.length === 0) return;
  try {
    await TagModel.updateMany({ _id: { $in: validIds } }, { lastUsedAt: new Date() }).exec();
  } catch {
    // Usage tracking is best-effort; a failure here must not fail the note save.
  }
}

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
      const rows = await model.aggregate<{ _id: Types.ObjectId; n: number }>([
        // Match listByUserId's visibility: skip soft-deleted AND already-expired
        // docs, so the counts shown in the manager agree with filtered results.
        { $match: { userId, deletedAt: null, $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] } },
        { $unwind: '$tags' },
        { $group: { _id: '$tags', n: { $sum: 1 } } },
      ]);
      for (const row of rows) {
        const id = String(row._id);
        counts[id] = (counts[id] || 0) + row.n;
      }
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
  try {
    return await TagModel.create({ userId, name, color: resolvedColor });
  } catch (err) {
    // Lost the race against a concurrent create of the same name — return the winner.
    if (isDuplicateKeyError(err)) {
      const winner = await TagModel.findOne({ userId, name }).exec();
      if (winner) return winner;
    }
    throw err;
  }
}

// Rename and/or recolor in a single write. The name must be pre-normalized and
// pre-checked for uniqueness by the caller; a concurrent rename can still lose
// the race and throw a duplicate-key error (see isDuplicateKeyError).
export async function updateTag(id: string, patch: { name?: string; color?: TagColor }): Promise<TagDocument | null> {
  return TagModel.findByIdAndUpdate(id, { ...patch, updatedAt: new Date() }, { returnDocument: 'after' }).exec();
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
  const existing = await TagModel.findOne({ userId, name: normalizeTagName(name) })
    .select('_id')
    .exec();
  return existing !== null && existing._id.toString() !== excludeId;
}
