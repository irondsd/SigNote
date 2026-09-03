import { count, eq, isNull, and } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { Db } from '@/db/client';
import { fileAttachments, notes, sealNotes, secretNotes } from '@/db/schema';
import { resetTestDb, setupTestDb, teardownTestDb } from '@/test/db';
import { cleanupOrphanedFiles } from '@/controllers/files';

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await resetTestDb(db);
});

const userId = '0xabc';

async function seedNote() {
  const rows = await db.insert(notes).values({ userId, title: 't', content: 'c', position: 1 }).returning();
  return rows[0];
}
async function seedSecret(id?: string) {
  const rows = await db
    .insert(secretNotes)
    .values({ ...(id && { id }), userId, title: 't', encryptedBody: null, position: 1 })
    .returning();
  return rows[0];
}
async function seedSeal() {
  const rows = await db
    .insert(sealNotes)
    .values({ userId, title: 't', encryptedBody: null, wrappedNoteKey: null, position: 1 })
    .returning();
  return rows[0];
}

async function seedFile(noteId: string, noteTier: 'note' | 'secret' | 'seal') {
  const rows = await db
    .insert(fileAttachments)
    .values({
      userId,
      noteId,
      noteTier,
      s3Key: `uploads/${userId}/${noteId}/x`,
      filename: 'x',
      size: 1,
      mimeType: 'application/octet-stream',
    })
    .returning();
  return rows[0];
}

const getFile = async (id: string) => {
  const rows = await db.select().from(fileAttachments).where(eq(fileAttachments.id, id));
  return rows[0] ?? null;
};

describe('cleanupOrphanedFiles', () => {
  it('returns scanned=0, orphaned=0 when there are no linked files', async () => {
    const result = await cleanupOrphanedFiles();
    expect(result).toEqual({ scanned: 0, orphaned: 0 });
  });

  it('does not flag files whose linked note is alive', async () => {
    const note = await seedNote();
    const secret = await seedSecret();
    const seal = await seedSeal();
    await seedFile(note.id, 'note');
    await seedFile(secret.id, 'secret');
    await seedFile(seal.id, 'seal');

    const result = await cleanupOrphanedFiles();
    expect(result.orphaned).toBe(0);

    const alive = await db.select({ n: count() }).from(fileAttachments).where(isNull(fileAttachments.deletedAt));
    expect(Number(alive[0].n)).toBe(3);
  });

  it('soft-deletes files whose linked note has been removed', async () => {
    const note = await seedNote();
    const file = await seedFile(note.id, 'note');

    // Note vanishes (e.g., purge cron fired).
    await db.delete(notes).where(eq(notes.id, note.id));

    const result = await cleanupOrphanedFiles();
    expect(result.scanned).toBe(1);
    expect(result.orphaned).toBe(1);

    const reloaded = await getFile(file.id);
    expect(reloaded?.deletedAt).toBeInstanceOf(Date);
  });

  it('only treats a file as orphaned if its OWN tier has no matching note', async () => {
    // Edge case: a file linked to tier 'note' with a noteId that ALSO exists
    // (with the same id) as a secret should still be considered orphaned.
    const sharedId = uuidv7();
    await seedSecret(sharedId);
    const file = await seedFile(sharedId, 'note'); // linked to NOTE tier, not secret

    const result = await cleanupOrphanedFiles();
    expect(result.orphaned).toBe(1);

    const reloaded = await getFile(file.id);
    expect(reloaded?.deletedAt).toBeInstanceOf(Date);
  });

  it('does not re-process files that are already soft-deleted', async () => {
    const note = await seedNote();
    const file = await seedFile(note.id, 'note');
    await db.update(fileAttachments).set({ deletedAt: new Date() }).where(eq(fileAttachments.id, file.id));
    await db.delete(notes).where(eq(notes.id, note.id));

    const result = await cleanupOrphanedFiles();
    expect(result.scanned).toBe(0); // already deleted file not in scan
    expect(result.orphaned).toBe(0);
  });

  it('mixes tiers in one pass', async () => {
    const liveNote = await seedNote();
    const deadSecret = await seedSecret();
    const deadSeal = await seedSeal();
    await seedFile(liveNote.id, 'note');
    const orphanA = await seedFile(deadSecret.id, 'secret');
    const orphanB = await seedFile(deadSeal.id, 'seal');

    await db.delete(secretNotes).where(eq(secretNotes.id, deadSecret.id));
    await db.delete(sealNotes).where(eq(sealNotes.id, deadSeal.id));

    const result = await cleanupOrphanedFiles();
    expect(result.scanned).toBe(3);
    expect(result.orphaned).toBe(2);

    const aliveStill = await db
      .select()
      .from(fileAttachments)
      .where(and(isNull(fileAttachments.deletedAt)));
    expect(aliveStill).toHaveLength(1);
    expect(aliveStill[0].noteId).toBe(liveNote.id);

    expect((await getFile(orphanA.id))?.deletedAt).toBeInstanceOf(Date);
    expect((await getFile(orphanB.id))?.deletedAt).toBeInstanceOf(Date);
  });
});
