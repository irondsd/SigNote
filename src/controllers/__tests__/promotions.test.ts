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
      { id: 'version-1', userId: 'user-1', noteId: 'note-1', title: 'First', content: '<p>first</p>', createdAt },
      {
        id: 'version-2',
        userId: 'user-1',
        noteId: 'note-1',
        title: 'Second',
        content: '<p data-file-id="plain-file">second</p>',
        createdAt: updatedAt,
      },
    ]);
    await db.insert(tags).values({ id: 'tag-1', userId: 'user-1', name: 'private', color: 'amber' });
    await db.insert(noteTags).values({ userId: 'user-1', noteId: 'note-1', tagId: 'tag-1', sortOrder: 0 });
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
      userId: 'user-1',
      noteId: 'note-1',
      noteTier: 'secret',
      encrypted: true,
    });
    expect(files.find((file) => file.id === 'already-encrypted')).toMatchObject({
      userId: 'user-1',
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
    await db
      .insert(noteVersions)
      .values({ id: 'version-1', userId: 'user-1', noteId: 'note-1', title: 'Old', content: 'old' });

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

  test('moves a secret, reusing one seal wrapper across its history and its re-keyed attachments', async () => {
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
      userId: 'user-1',
      noteId: 'secret-1',
      title: 'Old title',
      encryptedBody: payload('old-version'),
    });
    await db.insert(tags).values({ id: 'tag-1', userId: 'user-1', name: 'sealed', color: 'amber' });
    await db.insert(secretNoteTags).values({ userId: 'user-1', noteId: 'secret-1', tagId: 'tag-1', sortOrder: 0 });
    await db.insert(fileAttachments).values([
      {
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
      },
      {
        id: 'seal-keyed-file',
        userId: 'user-1',
        s3Key: 'seal-cipher',
        filename: 'file.txt',
        size: 21,
        mimeType: 'text/plain',
        encrypted: true,
        encryptionIv: 'iv',
        keyScope: 'seal',
        keyNoteId: 'secret-1',
      },
    ]);

    const prepared = await prepareSecretPromotion('user-1', 'secret-1');
    expect(prepared.versions.map((version) => version._id)).toEqual(['version-1']);
    expect(prepared.attachments).toEqual([expect.objectContaining({ _id: 'encrypted-file', encrypted: true })]);

    await promoteSecretToSeal('user-1', {
      id: 'secret-1',
      expectedUpdatedAt: updatedAt.toISOString(),
      encryptedBody: payload('new-head'),
      wrappedNoteKey: payload('wrapper'),
      versions: [{ id: 'version-1', encryptedBody: payload('new-version') }],
      fileReplacements: [{ sourceId: 'encrypted-file', encryptedId: 'seal-keyed-file' }],
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
    // The vault-keyed original is retired; the Seal carries the copy under its own key.
    const files = await db.select().from(fileAttachments);
    expect(files.find((file) => file.id === 'encrypted-file')?.deletedAt).toBeInstanceOf(Date);
    expect(files.find((file) => file.id === 'seal-keyed-file')).toMatchObject({
      userId: 'user-1',
      noteId: 'secret-1',
      noteTier: 'seal',
      keyScope: 'seal',
      keyNoteId: 'secret-1',
      deletedAt: null,
    });
  });

  describe('a secret attachment has to move under the seal key', () => {
    const updatedAt = new Date('2026-03-01T00:00:00.000Z');

    async function secretWithAttachment(replacement: Partial<typeof fileAttachments.$inferInsert> = {}) {
      await db.insert(secretNotes).values({
        id: 'secret-1',
        userId: 'user-1',
        title: 'Secret',
        encryptedBody: payload('head'),
        position: 1,
        updatedAt,
      });
      await db.insert(fileAttachments).values([
        {
          id: 'secret-file',
          userId: 'user-1',
          noteId: 'secret-1',
          noteTier: 'secret',
          s3Key: 'cipher',
          filename: 'f.txt',
          size: 21,
          mimeType: 'text/plain',
          encrypted: true,
          encryptionIv: 'iv',
        },
        {
          id: 'replacement',
          userId: 'user-1',
          s3Key: 'seal-cipher',
          filename: 'f.txt',
          size: 21,
          mimeType: 'text/plain',
          encrypted: true,
          encryptionIv: 'iv',
          keyScope: 'seal',
          keyNoteId: 'secret-1',
          ...replacement,
        },
      ]);
    }

    const promote = (overrides: Partial<Parameters<typeof promoteSecretToSeal>[1]> = {}) =>
      promoteSecretToSeal('user-1', {
        id: 'secret-1',
        expectedUpdatedAt: updatedAt.toISOString(),
        encryptedBody: payload('new-head'),
        wrappedNoteKey: payload('wrapper'),
        versions: [],
        fileReplacements: [{ sourceId: 'secret-file', encryptedId: 'replacement' }],
        ...overrides,
      });

    const expectUntouched = async () => {
      expect(await db.select().from(secretNotes).where(eq(secretNotes.id, 'secret-1'))).toHaveLength(1);
      expect(await db.select().from(sealNotes)).toHaveLength(0);
      expect(await db.select().from(fileAttachments).where(eq(fileAttachments.id, 'secret-file'))).toEqual([
        expect.objectContaining({ noteTier: 'secret', deletedAt: null }),
      ]);
    };

    test.each([
      ['still on the vault key', { keyScope: 'vault' as const, keyNoteId: null }],
      ['bound to another seal', { keyNoteId: 'another-seal' }],
      ['already linked elsewhere', { noteId: 'another-seal', noteTier: 'seal' as const }],
    ])('refuses a replacement %s', async (_, replacement) => {
      await secretWithAttachment(replacement);

      await expect(promote()).rejects.toEqual(expect.objectContaining({ code: 'INVALID_FILES' }));
      await expectUntouched();
    });

    test('refuses to carry an attachment over with no replacement', async () => {
      await secretWithAttachment();

      await expect(promote({ fileReplacements: [] })).rejects.toEqual(
        expect.objectContaining({ code: 'INVALID_FILES' }),
      );
      await expectUntouched();
    });

    test('refuses re-keyed attachments without the seal key that opens them', async () => {
      await secretWithAttachment();

      await expect(promote({ wrappedNoteKey: null })).rejects.toEqual(
        expect.objectContaining({ code: 'INVALID_FILES' }),
      );
      await expectUntouched();
    });
  });
});
