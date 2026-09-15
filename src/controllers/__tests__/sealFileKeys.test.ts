import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { linkFilesToNote, resolveFileKeyBinding, type NoteTier } from '@/controllers/files';
import { createSeal } from '@/controllers/seals';
import { isDuplicateKeyError } from '@/controllers/tags';
import type { Db } from '@/db/client';
import { fileAttachments, notes, sealNotes, secretNotes, type FileKeyScope } from '@/db/schema';
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
const wrapper = { alg: 'A256GCM' as const, iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'wrapped-note-key' };

async function seedParent(tier: NoteTier, values: { wrappedNoteKey?: typeof wrapper | null } = {}): Promise<string> {
  const common = { userId, title: tier, position: 1 };
  if (tier === 'note') return (await db.insert(notes).values(common).returning())[0].id;
  if (tier === 'secret') return (await db.insert(secretNotes).values(common).returning())[0].id;
  const wrappedNoteKey = 'wrappedNoteKey' in values ? values.wrappedNoteKey : wrapper;
  return (
    await db
      .insert(sealNotes)
      .values({ ...common, wrappedNoteKey })
      .returning()
  )[0].id;
}

async function seedFile(keyScope: FileKeyScope = 'vault', keyNoteId: string | null = null) {
  const id = uuidv7();
  await db.insert(fileAttachments).values({
    id,
    userId,
    filename: 'proof.bin',
    size: 32,
    mimeType: 'application/octet-stream',
    s3Key: `uploads/${userId}/${id}/encrypted`,
    encrypted: true,
    encryptionIv: 'AAAAAAAAAAAAAAAA',
    keyScope,
    keyNoteId,
  });
  return id;
}

async function linkedTo(fileId: string) {
  const [row] = await db
    .select({ noteId: fileAttachments.noteId, noteTier: fileAttachments.noteTier })
    .from(fileAttachments)
    .where(eq(fileAttachments.id, fileId));
  return row;
}

describe('resolveFileKeyBinding', () => {
  it('defaults to the vault key with no Seal', () => {
    expect(resolveFileKeyBinding({ encrypted: true })).toEqual({ keyScope: 'vault', keyNoteId: null });
    expect(resolveFileKeyBinding({ encrypted: false, keyScope: '' })).toEqual({ keyScope: 'vault', keyNoteId: null });
  });

  it('accepts an encrypted Seal-keyed upload naming its Seal', () => {
    expect(resolveFileKeyBinding({ encrypted: true, keyScope: 'seal', keyNoteId: 'seal-1' })).toEqual({
      keyScope: 'seal',
      keyNoteId: 'seal-1',
    });
  });

  it.each([
    { encrypted: true, keyScope: 'vault', keyNoteId: 'seal-1' },
    { encrypted: true, keyScope: 'seal' },
    { encrypted: false, keyScope: 'seal', keyNoteId: 'seal-1' },
    { encrypted: true, keyScope: 'seal', keyNoteId: 'x'.repeat(65) },
    { encrypted: true, keyScope: 'secret', keyNoteId: 'seal-1' },
  ])('rejects %o', (input) => {
    expect(() => resolveFileKeyBinding(input)).toThrow('Invalid file key binding');
  });
});

describe('linkFilesToNote key binding', () => {
  it.each<NoteTier>(['note', 'secret', 'seal'])('links a vault-keyed file to a %s', async (tier) => {
    const noteId = await seedParent(tier);
    const fileId = await seedFile();

    await linkFilesToNote(userId, noteId, tier, [fileId]);

    expect(await linkedTo(fileId)).toEqual({ noteId, noteTier: tier });
  });

  it('links a Seal-keyed file to its own Seal', async () => {
    const sealId = await seedParent('seal');
    const fileId = await seedFile('seal', sealId);

    await linkFilesToNote(userId, sealId, 'seal', [fileId]);

    expect(await linkedTo(fileId)).toEqual({ noteId: sealId, noteTier: 'seal' });
  });

  it('never moves a Seal-keyed file to another Seal (the paste case)', async () => {
    const ownSeal = await seedParent('seal');
    const otherSeal = await seedParent('seal');
    const fileId = await seedFile('seal', ownSeal);
    await linkFilesToNote(userId, ownSeal, 'seal', [fileId]);

    await linkFilesToNote(userId, otherSeal, 'seal', [fileId]);

    expect(await linkedTo(fileId)).toEqual({ noteId: ownSeal, noteTier: 'seal' });
  });

  it('does not link a Seal-keyed file to a Seal that stores no key', async () => {
    const sealId = await seedParent('seal', { wrappedNoteKey: null });
    const fileId = await seedFile('seal', sealId);

    await linkFilesToNote(userId, sealId, 'seal', [fileId]);

    expect(await linkedTo(fileId)).toEqual({ noteId: null, noteTier: null });
  });

  it.each<NoteTier>(['note', 'secret'])(
    'never links a Seal-keyed file to a %s, even with the same id',
    async (tier) => {
      const noteId = await seedParent(tier);
      const fileId = await seedFile('seal', noteId);

      await linkFilesToNote(userId, noteId, tier, [fileId]);

      expect(await linkedTo(fileId)).toEqual({ noteId: null, noteTier: null });
    },
  );

  it('links the allowed files of a mixed batch and skips the rest', async () => {
    const sealId = await seedParent('seal');
    const vault = await seedFile();
    const own = await seedFile('seal', sealId);
    const foreign = await seedFile('seal', uuidv7());

    await linkFilesToNote(userId, sealId, 'seal', [vault, own, foreign]);

    expect(await linkedTo(vault)).toEqual({ noteId: sealId, noteTier: 'seal' });
    expect(await linkedTo(own)).toEqual({ noteId: sealId, noteTier: 'seal' });
    expect(await linkedTo(foreign)).toEqual({ noteId: null, noteTier: null });
  });
});

describe('createSeal with a client-minted id', () => {
  it('stores the Seal under the given id, body and key in one write', async () => {
    const id = uuidv7();

    const seal = await createSeal(userId, 'minted', wrapper, wrapper, undefined, undefined, undefined, id);

    expect(seal._id).toBe(id);
    const [row] = await db.select().from(sealNotes).where(eq(sealNotes.id, id));
    expect(row.wrappedNoteKey).toEqual(wrapper);
  });

  it('raises a duplicate-key error when the id is taken', async () => {
    const id = uuidv7();
    await createSeal(userId, 'first', null, null, undefined, undefined, undefined, id);

    const error = await createSeal(userId, 'second', null, null, undefined, undefined, undefined, id).catch((e) => e);

    expect(isDuplicateKeyError(error)).toBe(true);
  });

  it('still assigns an id when none is given', async () => {
    const seal = await createSeal(userId, 'server');

    expect(seal._id).toEqual(expect.any(String));
  });
});
