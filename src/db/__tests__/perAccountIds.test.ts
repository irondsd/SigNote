import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { VERSION_COMPRESSION_WINDOW_MS } from '@/config/constants';
import type { Db } from '@/db/client';
import { fileAttachments, noteTags, noteVersions, notes, sealNotes, sealNoteTags, sealNoteVersions } from '@/db/schema';
import { resetTestDb, setupTestDb, teardownTestDb } from '@/test/db';
import { type EncryptedPayload } from '@/types/crypto';
import { createTag } from '@/controllers/tags';
import { getNoteById, getNoteVersions, noteOps, updateNote } from '@/controllers/notes';
import { createSeal, getSealById, getSealVersions, sealOps, updateSeal } from '@/controllers/seals';
import { deleteFileAttachment, getFileAttachment } from '@/controllers/files';

/**
 * Record ids are unique per account, not globally: a restored vault archive
 * keeps its ids verbatim (Seal and Authenticator ciphertext is bound to them),
 * so a second account on the same deployment must be able to hold the same
 * ids without either account ever reaching the other's rows.
 */

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

const alice = '0xalice';
const bob = '0xbob';
const pay = (c: string): EncryptedPayload => ({ alg: 'A256GCM', iv: `iv-${c}`, ciphertext: c });
const aged = () => new Date(Date.now() - VERSION_COMPRESSION_WINDOW_MS - 1000);

async function sameNoteInBothAccounts(id: string) {
  for (const userId of [alice, bob]) {
    await db
      .insert(notes)
      .values({ id, userId, title: `${userId} title`, content: 'v0', position: 1, updatedAt: aged() });
  }
}

describe('per-account record ids', () => {
  it('lets two accounts hold the same Seal id and keeps every write apart', async () => {
    const id = uuidv7();
    await createSeal(alice, 'alice seal', pay('a0'), pay('wrap'), null, null, [], id);
    await createSeal(bob, 'bob seal', pay('b0'), pay('wrap'), null, null, [], id);
    await db.update(sealNotes).set({ updatedAt: aged() });

    await updateSeal(bob, id, { title: 'bob edited', encryptedBody: pay('b1') });
    await sealOps.updateColor(bob, id, 'red');
    await sealOps.softDelete(bob, id);

    expect(await getSealById(alice, id)).toMatchObject({
      _id: id,
      userId: alice,
      title: 'alice seal',
      encryptedBody: pay('a0'),
      color: null,
      deletedAt: null,
    });
    expect(await getSealById(bob, id)).toMatchObject({ userId: bob, title: 'bob edited', color: 'red' });
    expect((await getSealVersions(alice, id))?.versions).toHaveLength(0);
    expect((await getSealVersions(bob, id))?.versions).toEqual([expect.objectContaining({ title: 'bob seal' })]);
  });

  it('scopes history and tags to the owning account', async () => {
    const id = uuidv7();
    await sameNoteInBothAccounts(id);
    const aliceTag = await createTag(alice, 'alice-only');
    const bobTag = await createTag(bob, 'bob-only');

    await noteOps.updateTags(alice, id, [aliceTag._id.toString()]);
    await noteOps.updateTags(bob, id, [bobTag._id.toString()]);
    await updateNote(alice, id, 'alice v1', 'v1');

    expect((await getNoteById(alice, id))?.tags).toEqual([aliceTag._id.toString()]);
    expect((await getNoteById(bob, id))?.tags).toEqual([bobTag._id.toString()]);
    expect((await getNoteVersions(alice, id))?.versions).toHaveLength(1);
    expect((await getNoteVersions(bob, id))?.versions).toHaveLength(0);
  });

  it('cascades a physical delete only to the deleted account’s children', async () => {
    const id = uuidv7();
    await sameNoteInBothAccounts(id);
    for (const userId of [alice, bob]) {
      await updateNote(userId, id, 'edited', 'v1');
      const tag = await createTag(userId, 'shared-name');
      await noteOps.updateTags(userId, id, [tag._id.toString()]);
    }

    await db.delete(notes).where(and(eq(notes.userId, bob), eq(notes.id, id)));

    expect(await db.select().from(noteVersions).where(eq(noteVersions.noteId, id))).toEqual([
      expect.objectContaining({ userId: alice }),
    ]);
    expect(await db.select().from(noteTags).where(eq(noteTags.noteId, id))).toEqual([
      expect.objectContaining({ userId: alice }),
    ]);
  });

  it('cascades history and tag ownership when a validated owner move rewrites a note', async () => {
    const id = uuidv7();
    await createSeal(bob, 'moving', pay('m0'), pay('wrap'), null, null, [], id);
    await db.update(sealNotes).set({ updatedAt: aged() });
    await updateSeal(bob, id, { encryptedBody: pay('m1') });
    const tag = await createTag(bob, 'kept');
    await sealOps.updateTags(bob, id, [tag._id.toString()]);

    await db.update(sealNotes).set({ userId: alice }).where(eq(sealNotes.userId, bob));

    expect(await db.select().from(sealNoteVersions)).toEqual([expect.objectContaining({ userId: alice, noteId: id })]);
    expect(await db.select().from(sealNoteTags)).toEqual([expect.objectContaining({ userId: alice, noteId: id })]);
  });

  it('still rejects a duplicate id within one account', async () => {
    const id = uuidv7();
    await createSeal(alice, 'first', null, null, null, null, [], id);
    await expect(createSeal(alice, 'second', null, null, null, null, [], id)).rejects.toThrow();
  });

  it('keeps attachment rows with the same portable id isolated by account', async () => {
    const id = uuidv7();
    await db.insert(fileAttachments).values([
      {
        id,
        userId: alice,
        s3Key: `uploads/${alice}/${id}/a.txt`,
        filename: 'alice.txt',
        size: 1,
        mimeType: 'text/plain',
      },
      {
        id,
        userId: bob,
        s3Key: `uploads/${bob}/${id}/b.txt`,
        filename: 'bob.txt',
        size: 1,
        mimeType: 'text/plain',
      },
    ]);

    await deleteFileAttachment(id, bob);

    expect(await getFileAttachment(id, alice)).toMatchObject({ userId: alice, filename: 'alice.txt' });
    expect(await getFileAttachment(id, bob)).toBeNull();
    expect(await db.select().from(fileAttachments).where(eq(fileAttachments.id, id))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: alice, deletedAt: null }),
        expect.objectContaining({ userId: bob, deletedAt: expect.any(Date) }),
      ]),
    );
  });
});
