import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { MAX_VERSIONS, VERSION_COMPRESSION_WINDOW_MS } from '@/config/constants';
import type { Db } from '@/db/client';
import { noteVersions, notes, sealNoteVersions, secretNoteVersions } from '@/db/schema';
import { resetTestDb, setupTestDb, teardownTestDb } from '@/test/db';
import { type EncryptedPayload } from '@/types/crypto';
import {
  createNote,
  deleteNoteVersion,
  getNoteById,
  getNotesByUserId,
  getNoteVersions,
  restoreNoteVersion,
  updateNote,
} from '@/controllers/notes';
import {
  createSecret,
  deleteSecretVersion,
  getSecretVersions,
  restoreSecretVersion,
  updateSecret,
} from '@/controllers/secrets';
import { createSeal, deleteSealVersion, getSealVersions, restoreSealVersion, updateSeal } from '@/controllers/seals';

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

const userId = '0xowner';
const pay = (c: string): EncryptedPayload => ({ alg: 'A256GCM', iv: `iv-${c}`, ciphertext: c });

type NoteVersion = { _id: string; title: string; content: string; createdAt: Date };
type EncVersion = { _id: string; title: string; encryptedBody: EncryptedPayload | null; createdAt: Date };

const noteHistory = async (id: string) => (await getNoteVersions(id))!.versions as unknown as NoteVersion[];
const secretHistory = async (id: string) => (await getSecretVersions(id))!.versions as unknown as EncVersion[];
const sealHistory = async (id: string) => (await getSealVersions(id))!.versions as unknown as EncVersion[];

type VersionsTable = typeof noteVersions | typeof secretNoteVersions | typeof sealNoteVersions;

// Push the createdAt of every recorded version back beyond the compression
// window so the next edit is guaranteed to record a fresh version.
async function ageVersions(table: VersionsTable, id: string) {
  const past = new Date(Date.now() - VERSION_COMPRESSION_WINDOW_MS - 1000);
  await db.update(table).set({ createdAt: past }).where(eq(table.noteId, id));
}

describe('note versioning', () => {
  it('records a pre-edit snapshot on the first edit and advances the head', async () => {
    const note = await createNote(userId, 'v0', 'body0');
    const id = note._id.toString();

    const updated = await updateNote(id, 'v1', 'body1');

    expect(updated?.title).toBe('v1');
    expect(updated?.content).toBe('body1');
    // Write responses never ship history.
    expect(updated?.versions).toBeUndefined();

    const versions = await noteHistory(id);
    expect(versions).toHaveLength(1);
    expect(versions[0].title).toBe('v0');
    expect(versions[0].content).toBe('body0');
  });

  it('treats an identical edit as a no-op (no version, no updatedAt bump)', async () => {
    const note = await createNote(userId, 'same', 'body');
    const id = note._id.toString();
    const before = note.updatedAt.getTime();

    const updated = await updateNote(id, 'same', 'body');

    expect(updated?.updatedAt.getTime()).toBe(before);
    expect(updated?.versions).toBeUndefined();
    expect(await noteHistory(id)).toHaveLength(0);
  });

  it('collapses edits inside the compression window into one version', async () => {
    const note = await createNote(userId, 'v0', 'body0');
    const id = note._id.toString();

    await updateNote(id, 'v1', 'body1'); // pushes snapshot of v0
    const second = await updateNote(id, 'v2', 'body2'); // within window → suppressed

    expect(second?.title).toBe('v2');
    const versions = await noteHistory(id);
    expect(versions).toHaveLength(1);
    expect(versions[0].content).toBe('body0'); // still the original snapshot
  });

  it('records a new version once the window has elapsed', async () => {
    const note = await createNote(userId, 'v0', 'body0');
    const id = note._id.toString();

    await updateNote(id, 'v1', 'body1'); // snapshot of v0
    await ageVersions(noteVersions, id);
    await updateNote(id, 'v2', 'body2'); // window elapsed → snapshot of v1

    const versions = await noteHistory(id);
    expect(versions).toHaveLength(2);
    expect(versions[0].content).toBe('body0');
    expect(versions[1].content).toBe('body1');
  });

  it('caps history at MAX_VERSIONS, dropping the oldest', async () => {
    const note = await createNote(userId, 't0', 'c0');
    const id = note._id.toString();

    for (let i = 1; i <= MAX_VERSIONS + 5; i++) {
      await updateNote(id, `t${i}`, `c${i}`);
      await ageVersions(noteVersions, id);
    }

    const versions = await noteHistory(id);
    expect(versions).toHaveLength(MAX_VERSIONS);
    // Oldest retained snapshot should NOT be the very first content anymore.
    expect(versions.some((v) => v.content === 'c0')).toBe(false);
    // Newest retained snapshot is the head state just before the final edit.
    expect(versions[versions.length - 1].content).toBe(`c${MAX_VERSIONS + 4}`);
  });

  it('restores a version: head matches, pre-restore head snapshotted, version retained', async () => {
    const note = await createNote(userId, 'v0', 'body0');
    const id = note._id.toString();
    await updateNote(id, 'v1', 'body1');
    await ageVersions(noteVersions, id);
    await updateNote(id, 'v2', 'body2'); // versions: [body0, body1], head = v2

    const target = (await noteHistory(id))[0]; // body0
    const restored = await restoreNoteVersion(id, target._id.toString());

    expect(restored?.title).toBe('v0');
    expect(restored?.content).toBe('body0');
    expect(restored?.versions).toBeUndefined();

    const versions = await noteHistory(id);
    // pre-restore head (v2) is appended as a new version
    expect(versions[versions.length - 1].content).toBe('body2');
    // restored version row is left in place
    expect(versions.some((v) => v._id.toString() === target._id.toString())).toBe(true);
  });

  it('returns null restoring an unknown version id', async () => {
    const note = await createNote(userId, 'v0', 'body0');
    expect(await restoreNoteVersion(note._id.toString(), uuidv7())).toBeNull();
  });

  it('returns null restoring a malformed version id', async () => {
    const note = await createNote(userId, 'v0', 'body0');
    expect(await restoreNoteVersion(note._id.toString(), 'not-a-real-id')).toBeNull();
  });

  it('returns null restoring on a missing note', async () => {
    expect(await restoreNoteVersion(uuidv7(), uuidv7())).toBeNull();
  });

  it('stamps the snapshot with when its content was saved, not when the edit displaced it', async () => {
    const note = await createNote(userId, 'v0', 'body0');
    const id = note._id.toString();
    // Pretend the head was last saved an hour ago.
    const savedAt = new Date(Date.now() - 3600_000);
    await db.update(notes).set({ updatedAt: savedAt }).where(eq(notes.id, id));

    await updateNote(id, 'v1', 'body1');

    const versions = await noteHistory(id);
    expect(versions).toHaveLength(1);
    expect(versions[0].createdAt.getTime()).toBe(savedAt.getTime());
  });

  it('restore stamps the pre-restore snapshot with its save time, not restore time', async () => {
    const note = await createNote(userId, 'v0', 'body0');
    const id = note._id.toString();
    await updateNote(id, 'v1', 'body1');
    const savedAt = new Date(Date.now() - 3600_000);
    await db.update(notes).set({ updatedAt: savedAt }).where(eq(notes.id, id));

    const target = (await noteHistory(id))[0];
    const restored = await restoreNoteVersion(id, target._id.toString());

    // The head itself moves to "now"…
    expect(restored!.updatedAt.getTime()).toBeGreaterThan(savedAt.getTime());

    // …but the snapshot of the displaced head keeps its original save time.
    const versions = await noteHistory(id);
    expect(versions[versions.length - 1].createdAt.getTime()).toBe(savedAt.getTime());
  });

  it('deletes a single version row, leaving the head and other versions intact', async () => {
    const note = await createNote(userId, 'v0', 'body0');
    const id = note._id.toString();
    await updateNote(id, 'v1', 'body1');
    await ageVersions(noteVersions, id);
    await updateNote(id, 'v2', 'body2'); // versions: [body0, body1], head = v2

    const target = (await noteHistory(id))[0]; // body0
    const updated = await deleteNoteVersion(id, target._id.toString());

    expect(updated?.title).toBe('v2');
    expect(updated?.versions).toBeUndefined();

    const versions = await noteHistory(id);
    expect(versions).toHaveLength(1);
    expect(versions[0].content).toBe('body1');
  });

  it('delete is idempotent: pulling a missing version id still resolves to the head', async () => {
    const note = await createNote(userId, 'v0', 'body0');
    const id = note._id.toString();
    await updateNote(id, 'v1', 'body1');

    const updated = await deleteNoteVersion(id, uuidv7());

    expect(updated?.title).toBe('v1');
    expect(await noteHistory(id)).toHaveLength(1);
  });

  it('delete returns null for a missing note', async () => {
    expect(await deleteNoteVersion(uuidv7(), uuidv7())).toBeNull();
  });

  it('strips versions from list and head reads; exposes them via getNoteVersions', async () => {
    const note = await createNote(userId, 'v0', 'body0');
    const id = note._id.toString();
    await updateNote(id, 'v1', 'body1');

    const list = await getNotesByUserId(userId);
    expect(list[0].versions).toBeUndefined();

    const single = await getNoteById(id);
    expect(single?.versions).toBeUndefined();

    expect(await noteHistory(id)).toHaveLength(1);
  });
});

describe('secret versioning', () => {
  it('records a snapshot of the prior encrypted body', async () => {
    const secret = await createSecret(userId, 's0', pay('c0'));
    const id = secret._id.toString();

    const updated = await updateSecret(id, 's1', pay('c1'));

    expect(updated?.title).toBe('s1');
    expect(updated?.encryptedBody?.ciphertext).toBe('c1');
    expect(updated?.versions).toBeUndefined();

    const versions = await secretHistory(id);
    expect(versions).toHaveLength(1);
    expect(versions[0].title).toBe('s0');
    expect(versions[0].encryptedBody?.ciphertext).toBe('c0');
  });

  it('no-ops on identical title + ciphertext', async () => {
    const secret = await createSecret(userId, 's', pay('c'));
    const id = secret._id.toString();
    const updated = await updateSecret(id, 's', pay('c'));
    expect(updated?.versions).toBeUndefined();
    expect(await secretHistory(id)).toHaveLength(0);
  });

  it('restores a prior encrypted version', async () => {
    const secret = await createSecret(userId, 's0', pay('c0'));
    const id = secret._id.toString();
    await updateSecret(id, 's1', pay('c1'));

    const target = (await secretHistory(id))[0];
    const restored = await restoreSecretVersion(id, target._id.toString());

    expect(restored?.title).toBe('s0');
    expect(restored?.encryptedBody?.ciphertext).toBe('c0');
    expect(restored?.versions).toBeUndefined();

    const versions = await secretHistory(id);
    expect(versions[versions.length - 1].encryptedBody?.ciphertext).toBe('c1');
  });

  it('deletes a single encrypted version row', async () => {
    const secret = await createSecret(userId, 's0', pay('c0'));
    const id = secret._id.toString();
    await updateSecret(id, 's1', pay('c1'));

    const target = (await secretHistory(id))[0];
    await deleteSecretVersion(id, target._id.toString());

    expect(await secretHistory(id)).toHaveLength(0);
  });
});

describe('seal versioning', () => {
  it('records a snapshot without a wrappedNoteKey field', async () => {
    const seal = await createSeal(userId, 'l0', pay('c0'), pay('wrap'));
    const id = seal._id.toString();

    const updated = await updateSeal(id, { title: 'l1', encryptedBody: pay('c1') });

    expect(updated?.title).toBe('l1');
    expect(updated?.versions).toBeUndefined();
    // head keeps its wrapped key
    expect(updated?.wrappedNoteKey?.ciphertext).toBe('wrap');

    const versions = await sealHistory(id);
    expect(versions).toHaveLength(1);
    expect(versions[0].encryptedBody?.ciphertext).toBe('c0');
    // version rows carry no wrappedNoteKey
    expect((versions[0] as Record<string, unknown>).wrappedNoteKey).toBeUndefined();
  });

  it('does not version a wrappedNoteKey-only change', async () => {
    const seal = await createSeal(userId, 'l0', pay('c0'), pay('wrap0'));
    const id = seal._id.toString();

    const updated = await updateSeal(id, { wrappedNoteKey: pay('wrap1') });

    expect(updated?.wrappedNoteKey?.ciphertext).toBe('wrap1');
    expect(await sealHistory(id)).toHaveLength(0);
  });

  it('restores a seal version, leaving wrappedNoteKey on the head intact', async () => {
    const seal = await createSeal(userId, 'l0', pay('c0'), pay('wrap'));
    const id = seal._id.toString();
    await updateSeal(id, { title: 'l1', encryptedBody: pay('c1') });

    const target = (await sealHistory(id))[0];
    const restored = await restoreSealVersion(id, target._id.toString());

    expect(restored?.encryptedBody?.ciphertext).toBe('c0');
    expect(restored?.wrappedNoteKey?.ciphertext).toBe('wrap');
    expect(restored?.versions).toBeUndefined();

    const versions = await sealHistory(id);
    expect(versions[versions.length - 1].encryptedBody?.ciphertext).toBe('c1');
  });

  it('deletes a single seal version row, leaving the head wrapped key intact', async () => {
    const seal = await createSeal(userId, 'l0', pay('c0'), pay('wrap'));
    const id = seal._id.toString();
    await updateSeal(id, { title: 'l1', encryptedBody: pay('c1') });

    const target = (await sealHistory(id))[0];
    const updated = await deleteSealVersion(id, target._id.toString());

    expect(updated?.wrappedNoteKey?.ciphertext).toBe('wrap');
    expect(await sealHistory(id)).toHaveLength(0);
  });
});
