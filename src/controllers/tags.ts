/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, asc, count, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';

import { autoTagColor, TAG_COLORS, type TagColor } from '@/config/noteStyles';
import { getDb } from '@/db/client';
import { noteTags, notes, sealNoteTags, sealNotes, secretNoteTags, secretNotes, tags } from '@/db/schema';

export type TagRow = {
  _id: string;
  userId: string;
  name: string;
  color: TagColor;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type RawTag = typeof tags.$inferSelect;

const mapTag = (row: RawTag): TagRow => ({
  _id: row.id,
  userId: row.userId,
  name: row.name,
  color: row.color as TagColor,
  lastUsedAt: row.lastUsedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

// (join table, parent tier table) pairs for cross-tier tag queries.
const TIER_JOINS: [any, any][] = [
  [noteTags, notes],
  [secretNoteTags, secretNotes],
  [sealNoteTags, sealNotes],
];

export function normalizeTagName(name: string): string {
  // Slice by code points, not UTF-16 units — a plain .slice() could cut an
  // emoji's surrogate pair in half and store a malformed string.
  return [...name.trim().toLowerCase()].slice(0, 50).join('');
}

// Postgres unique-constraint violation (SQLSTATE 23505), raised when a
// concurrent write wins the { userId, name } uniqueness race. Drizzle may wrap
// the driver error, so walk the cause chain.
export function isDuplicateKeyError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    if ('code' in current && (current as { code: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export function isValidTagColor(color: unknown): color is TagColor {
  return typeof color === 'string' && (TAG_COLORS as readonly string[]).includes(color);
}

// Default ordering is most-recently-used first (never-used tags fall to the
// bottom, alphabetised). The tags management page re-sorts by creation date.
export const listTags = async (userId: string): Promise<TagRow[]> => {
  const rows = await getDb()
    .select()
    .from(tags)
    .where(eq(tags.userId, userId))
    .orderBy(sql`${tags.lastUsedAt} DESC NULLS LAST`, asc(tags.name));
  return rows.map(mapTag);
};

// Bump lastUsedAt for the given tags so they float to the top of the picker.
// Fire-and-forget at call sites; never throws.
export async function touchTags(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await getDb().update(tags).set({ lastUsedAt: new Date() }).where(inArray(tags.id, ids));
  } catch {
    // Usage tracking is best-effort; a failure here must not fail the note save.
  }
}

export const getTagById = async (id: string): Promise<TagRow | null> => {
  const rows = await getDb().select().from(tags).where(eq(tags.id, id)).limit(1);
  return rows[0] ? mapTag(rows[0]) : null;
};

// Subset of `ids` owned by the user. Used to sanitize a note's incoming tag
// list so a note can never reference a foreign or deleted tag.
export async function getOwnedTagIds(userId: string, ids: string[]): Promise<string[]> {
  const candidates = [...new Set(ids)].filter((id) => id.length > 0);
  if (candidates.length === 0) return [];
  const owned = await getDb()
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.userId, userId), inArray(tags.id, candidates)));
  const ownedSet = new Set(owned.map((t) => t.id));
  // Preserve incoming order, drop anything not owned.
  return candidates.filter((id) => ownedSet.has(id));
}

// Usage counts per tag id, aggregated across all three tiers (active docs only).
export async function getTagUsageCounts(userId: string): Promise<Record<string, number>> {
  const db = getDb();
  const counts: Record<string, number> = {};
  await Promise.all(
    TIER_JOINS.map(async ([join, parent]) => {
      // Match `list`'s visibility: skip soft-deleted AND already-expired docs,
      // so the counts shown in the manager agree with filtered results.
      const rows = (await (db as any)
        .select({ tagId: join.tagId, n: count() })
        .from(join)
        .innerJoin(parent, eq(join.noteId, parent.id))
        .where(
          and(
            eq(parent.userId, userId),
            isNull(parent.deletedAt),
            or(isNull(parent.expiresAt), gt(parent.expiresAt, new Date())),
          ),
        )
        .groupBy(join.tagId)) as { tagId: string; n: number }[];
      for (const row of rows) {
        counts[row.tagId] = (counts[row.tagId] || 0) + Number(row.n);
      }
    }),
  );
  return counts;
}

// Create a tag, or return the existing one if the name is already taken (the
// picker's "create" path is idempotent). Color defaults to the auto-assigned
// hue when not supplied.
export async function createTag(userId: string, rawName: string, color?: string | null): Promise<TagRow> {
  const db = getDb();
  const name = normalizeTagName(rawName);
  const existing = await db
    .select()
    .from(tags)
    .where(and(eq(tags.userId, userId), eq(tags.name, name)))
    .limit(1);
  if (existing[0]) return mapTag(existing[0]);

  const resolvedColor = isValidTagColor(color) ? color : autoTagColor(name);
  try {
    const inserted = await db.insert(tags).values({ userId, name, color: resolvedColor }).returning();
    return mapTag(inserted[0]);
  } catch (err) {
    // Lost the race against a concurrent create of the same name — return the winner.
    if (isDuplicateKeyError(err)) {
      const winner = await db
        .select()
        .from(tags)
        .where(and(eq(tags.userId, userId), eq(tags.name, name)))
        .limit(1);
      if (winner[0]) return mapTag(winner[0]);
    }
    throw err;
  }
}

// Rename and/or recolor in a single write. The name must be pre-normalized and
// pre-checked for uniqueness by the caller; a concurrent rename can still lose
// the race and throw a duplicate-key error (see isDuplicateKeyError).
export async function updateTag(id: string, patch: { name?: string; color?: TagColor }): Promise<TagRow | null> {
  const rows = await getDb()
    .update(tags)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(tags.id, id))
    .returning();
  return rows[0] ? mapTag(rows[0]) : null;
}

// Delete the tag; the join tables' ON DELETE CASCADE detaches it from every
// note/secret/seal that referenced it.
export async function deleteTagAndDetach(id: string): Promise<void> {
  await getDb().delete(tags).where(eq(tags.id, id));
}

// Whether another tag (besides `excludeId`) already uses this name for the user.
export async function tagNameTaken(userId: string, name: string, excludeId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.userId, userId), eq(tags.name, normalizeTagName(name))))
    .limit(1);
  return rows[0] !== undefined && rows[0].id !== excludeId;
}
