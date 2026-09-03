import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Address } from 'viem';
import { noteVersions, notes } from '../../src/db/schema';
import { getOrCreateUserId } from './getOrCreateUserId';
import { testDb } from './db';
import type { NoteColor, NotePattern } from '@/config/noteStyles';

const POSITION_STEP = 1000;

/** The inserted row, plus the `_id` alias the app's API exposes — specs
 *  address seeded rows the same way the client sees them. */
export type SeededNote = typeof notes.$inferSelect & { _id: string };

const withAliasedId = (row: typeof notes.$inferSelect): SeededNote => ({ ...row, _id: row.id });

export type SeedNote = {
  title?: string;
  content?: string;
  archived?: boolean;
  color?: NoteColor | null;
  pattern?: NotePattern | null;
  deletedAt?: Date | null;
  pinned?: boolean;
  expiresAt?: Date | null;
  burnAfterReading?: boolean;
  versions?: { title: string; content: string; createdAt?: Date }[];
};

export const seedNotes = async (address: Address, seeds: SeedNote[]): Promise<SeededNote[]> => {
  const db = testDb();
  const userId = await getOrCreateUserId(address);

  // Determine starting position after existing notes for this user
  const last = await db
    .select({ position: notes.position })
    .from(notes)
    .where(and(eq(notes.userId, userId), isNull(notes.deletedAt)))
    .orderBy(desc(notes.position))
    .limit(1);

  let position = (last[0]?.position ?? 0) + POSITION_STEP;

  const created: SeededNote[] = [];
  for (const note of seeds) {
    const now = new Date();
    const [row] = await db
      .insert(notes)
      .values({
        userId,
        title: note.title ?? '',
        content: note.content ?? '<p></p>',
        archived: note.archived ?? false,
        color: note.color ?? null,
        pattern: note.pattern ?? null,
        position,
        createdAt: now,
        updatedAt: now,
        deletedAt: note.deletedAt !== undefined ? note.deletedAt : null,
        pinned: note.pinned ?? false,
        expiresAt: note.expiresAt ?? null,
        burnAfterReading: note.burnAfterReading ?? false,
      })
      .returning();

    // Insert in order so `seq` matches the order the app reads history by.
    for (const version of note.versions ?? []) {
      await db.insert(noteVersions).values({
        noteId: row.id,
        title: version.title,
        content: version.content,
        createdAt: version.createdAt ?? new Date(),
      });
    }

    created.push(withAliasedId(row));
    position += POSITION_STEP;
  }

  return created;
};
