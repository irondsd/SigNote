import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { getFileAttachment, type NoteTier } from '@/controllers/files';
import type { Db } from '@/db/client';
import { fileAttachments, notes, sealNotes, secretNotes } from '@/db/schema';
import { resetTestDb, setupTestDb, teardownTestDb } from '@/test/db';

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

const userId = 'file-owner';

async function seedParent(tier: NoteTier, values: { expiresAt?: Date; deletedAt?: Date } = {}): Promise<string> {
  const common = { userId, title: tier, position: 1, ...values };
  if (tier === 'note') return (await db.insert(notes).values(common).returning())[0].id;
  if (tier === 'secret') return (await db.insert(secretNotes).values(common).returning())[0].id;
  return (await db.insert(sealNotes).values(common).returning())[0].id;
}

async function seedFile(noteId: string | null = null, noteTier: NoteTier | null = null) {
  return (
    await db
      .insert(fileAttachments)
      .values({
        userId,
        noteId,
        noteTier,
        filename: 'proof.txt',
        size: 1,
        mimeType: 'text/plain',
        s3Key: `uploads/${userId}/${uuidv7()}/proof.txt`,
      })
      .returning()
  )[0];
}

describe('getFileAttachment parent authorization', () => {
  it('allows an owned upload before it is linked, but not another user', async () => {
    const file = await seedFile();

    expect(await getFileAttachment(file.id, userId)).not.toBeNull();
    expect(await getFileAttachment(file.id, 'another-user')).toBeNull();
  });

  it.each<NoteTier>(['note', 'secret', 'seal'])('allows a file with a live %s parent', async (tier) => {
    const file = await seedFile(await seedParent(tier), tier);

    expect(await getFileAttachment(file.id, userId)).not.toBeNull();
  });

  it.each<NoteTier>(['note', 'secret', 'seal'])('denies another user a file with a live %s parent', async (tier) => {
    const file = await seedFile(await seedParent(tier), tier);

    expect(await getFileAttachment(file.id, 'another-user')).toBeNull();
  });

  it.each<NoteTier>(['note', 'secret', 'seal'])('denies a file with an expired %s parent', async (tier) => {
    const file = await seedFile(await seedParent(tier, { expiresAt: new Date(Date.now() - 1_000) }), tier);

    expect(await getFileAttachment(file.id, userId)).toBeNull();
  });

  it.each<NoteTier>(['note', 'secret', 'seal'])('denies a file with a deleted %s parent', async (tier) => {
    const file = await seedFile(await seedParent(tier, { deletedAt: new Date() }), tier);

    expect(await getFileAttachment(file.id, userId)).toBeNull();
  });

  it.each<NoteTier>(['note', 'secret', 'seal'])('denies a file whose %s parent no longer exists', async (tier) => {
    const parentId = await seedParent(tier);
    const file = await seedFile(parentId, tier);

    if (tier === 'note') await db.delete(notes).where(eq(notes.id, parentId));
    else if (tier === 'secret') await db.delete(secretNotes).where(eq(secretNotes.id, parentId));
    else await db.delete(sealNotes).where(eq(sealNotes.id, parentId));

    expect(await getFileAttachment(file.id, userId)).toBeNull();
  });
});
