import { eq } from 'drizzle-orm';

import {
  prepareNotePromotion,
  prepareSecretPromotion,
  promoteNoteToSecret,
  promoteSecretToSeal,
  PromotionError,
} from '@/controllers/promotions';
import {
  fileAttachments,
  notes,
  noteTags,
  noteVersions,
  sealNotes,
  sealNoteTags,
  sealNoteVersions,
  secretNotes,
  secretNoteTags,
  secretNoteVersions,
  tags,
} from '@/db/schema';
import { resetTestDb, setupTestDb, teardownTestDb } from '@/test/db';
import type { Db } from '@/db/client';
import type { EncryptedPayload } from '@/types/crypto';

let db: Db;

const payload = (value: string): EncryptedPayload => ({
  alg: 'A256GCM',
  iv: 'AAAAAAAAAAAAAAAA',
  ciphertext: value,
});

beforeAll(async () => {
  db = await setupTestDb();
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await resetTestDb(db);
});

describe('tier promotions', () => {
  test('moves a note, its history, tags, metadata, and secured files to Secrets', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const updatedAt = new Date('2026-02-01T00:00:00.000Z');
    await db.insert(notes).values({
      id: 'note-1',
      userId: 'user-1',
      title: 'Private later',
      content: '<p data-file-id="plain-file">head</p>',
      position: 42,
      createdAt,
      updatedAt,
      archived: true,
      color: 'amber',
      pattern: 'dots',
      pinned: true,
      expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    });
    await db.insert(noteVersions).values([
      { id: 'version-1', noteId: 'note-1', title: 'First', content: '<p>first</p>', createdAt },
      {
        id: 'version-2',
        noteId: 'note-1',
        title: 'Second',
        content: '<p data-file-id="plain-file">second</p>',
        createdAt: updatedAt,
      },
    ]);
    await db.insert(tags).values({ id: 'tag-1', userId: 'user-1', name: 'private', color: 'amber' });
    await db.insert(noteTags).values({ noteId: 'note-1', tagId: 'tag-1', sortOrder: 0 });
    await db.insert(fileAttachments).values([
      {
        id: 'plain-file',
        userId: 'user-1',
        noteId: 'note-1',
        noteTier: 'note',
        s3Key: 'plain',
        filename: 'plain.txt',
        size: 5,
        mimeType: 'text/plain',
      },
      {
        id: 'replacement-file',
        userId: 'user-1',
        s3Key: 'cipher',
        filename: 'plain.txt',
        size: 21,
        mimeType: 'text/plain',
        encrypted: true,
        encryptionIv: 'iv',
      },
      {
        id: 'already-encrypted',
        userId: 'user-1',
        noteId: 'note-1',
        noteTier: 'note',
        s3Key: 'existing-cipher',
        filename: 'existing.txt',
        size: 21,
        mimeType: 'text/plain',
        encrypted: true,
        encryptionIv: 'iv',
      },
    ]);

    const prepared = await prepareNotePromotion('user-1', 'note-1');
    expect(prepared.versions.map((version) => version._id)).toEqual(['version-1', 'version-2']);
    expect(prepared.attachments).toHaveLength(2);

    await promoteNoteToSecret('user-1', {
      id: 'note-1',
      expectedUpdatedAt: updatedAt.toISOString(),
      encryptedBody: payload('head-cipher'),
      versions: [
        { id: 'version-1', encryptedBody: payload('first-cipher') },
        { id: 'version-2', encryptedBody: payload('second-cipher') },
      ],
      fileReplacements: [{ sourceId: 'plain-file', encryptedId: 'replacement-file' }],
    });

    expect(await db.select().from(notes).where(eq(notes.id, 'note-1'))).toHaveLength(0);
    const [secret] = await db.select().from(secretNotes).where(eq(secretNotes.id, 'note-1'));
    expect(secret).toMatchObject({
      title: 'Private later',
      archived: true,
      color: 'amber',
      pattern: 'dots',
      pinned: true,
      encryptedBody: payload('head-cipher'),
    });
    expect(secret.createdAt).toEqual(createdAt);
    expect(secret.updatedAt).toEqual(updatedAt);
    expect(await db.select().from(secretNoteVersions).where(eq(secretNoteVersions.noteId, 'note-1'))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'version-1', title: 'First', encryptedBody: payload('first-cipher') }),
        expect.objectContaining({ id: 'version-2', title: 'Second', encryptedBody: payload('second-cipher') }),
      ]),
    );
    expect(await db.select().from(secretNoteTags).where(eq(secretNoteTags.noteId, 'note-1'))).toEqual([
      expect.objectContaining({ tagId: 'tag-1', sortOrder: 0 }),
    ]);

    const files = await db.select().from(fileAttachments);
    expect(files.find((file) => file.id === 'plain-file')?.deletedAt).toBeInstanceOf(Date);
    expect(files.find((file) => file.id === 'replacement-file')).toMatchObject({
      noteId: 'note-1',
      noteTier: 'secret',
      encrypted: true,
    });
    expect(files.find((file) => file.id === 'already-encrypted')).toMatchObject({
      noteId: 'note-1',
      noteTier: 'secret',
      encrypted: true,
    });
  });

  test('leaves the source untouched when note history changed after preparation', async () => {
    const updatedAt = new Date('2026-02-01T00:00:00.000Z');
    await db.insert(notes).values({
      id: 'note-1',
      userId: 'user-1',
      title: 'Source',
      content: 'body',
      position: 1,
      updatedAt,
    });
    await db.insert(noteVersions).values({ id: 'version-1', noteId: 'note-1', title: 'Old', content: 'old' });

    await expect(
      promoteNoteToSecret('user-1', {
        id: 'note-1',
        expectedUpdatedAt: updatedAt.toISOString(),
        encryptedBody: payload('body'),
        versions: [],
        fileReplacements: [],
      }),
    ).rejects.toEqual(expect.objectContaining<Partial<PromotionError>>({ code: 'CONFLICT' }));

    expect(await db.select().from(notes).where(eq(notes.id, 'note-1'))).toHaveLength(1);
    expect(await db.select().from(secretNotes).where(eq(secretNotes.id, 'note-1'))).toHaveLength(0);
  });

  test('moves a secret and reuses one seal wrapper across its retained history', async () => {
    const updatedAt = new Date('2026-03-01T00:00:00.000Z');
    await db.insert(secretNotes).values({
      id: 'secret-1',
      userId: 'user-1',
      title: 'Shared key',
      encryptedBody: payload('old-head'),
      position: 5,
      updatedAt,
      color: 'amber',
    });
    await db.insert(secretNoteVersions).values({
      id: 'version-1',
      noteId: 'secret-1',
      title: 'Old title',
      encryptedBody: payload('old-version'),
    });
    await db.insert(tags).values({ id: 'tag-1', userId: 'user-1', name: 'sealed', color: 'amber' });
    await db.insert(secretNoteTags).values({ noteId: 'secret-1', tagId: 'tag-1', sortOrder: 0 });
    await db.insert(fileAttachments).values({
      id: 'encrypted-file',
      userId: 'user-1',
      noteId: 'secret-1',
      noteTier: 'secret',
      s3Key: 'cipher',
      filename: 'file.txt',
      size: 21,
      mimeType: 'text/plain',
      encrypted: true,
      encryptionIv: 'iv',
    });

    const prepared = await prepareSecretPromotion('user-1', 'secret-1');
    expect(prepared.versions.map((version) => version._id)).toEqual(['version-1']);

    await promoteSecretToSeal('user-1', {
      id: 'secret-1',
      expectedUpdatedAt: updatedAt.toISOString(),
      encryptedBody: payload('new-head'),
      wrappedNoteKey: payload('wrapper'),
      versions: [{ id: 'version-1', encryptedBody: payload('new-version') }],
    });

    expect(await db.select().from(secretNotes).where(eq(secretNotes.id, 'secret-1'))).toHaveLength(0);
    expect(await db.select().from(sealNotes).where(eq(sealNotes.id, 'secret-1'))).toEqual([
      expect.objectContaining({
        title: 'Shared key',
        encryptedBody: payload('new-head'),
        wrappedNoteKey: payload('wrapper'),
      }),
    ]);
    expect(await db.select().from(sealNoteVersions).where(eq(sealNoteVersions.noteId, 'secret-1'))).toEqual([
      expect.objectContaining({ id: 'version-1', title: 'Old title', encryptedBody: payload('new-version') }),
    ]);
    expect(await db.select().from(sealNoteTags).where(eq(sealNoteTags.noteId, 'secret-1'))).toHaveLength(1);
    expect(await db.select().from(fileAttachments).where(eq(fileAttachments.id, 'encrypted-file'))).toEqual([
      expect.objectContaining({ noteTier: 'seal', noteId: 'secret-1', deletedAt: null }),
    ]);
  });
});
