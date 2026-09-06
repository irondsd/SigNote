import { v7 as uuidv7 } from 'uuid';

import { getProfileData } from '@/controllers/profile';
import type { Db } from '@/db/client';
import { notes, otpRecords, sealNotes, secretNotes, users } from '@/db/schema';
import { resetTestDb, setupTestDb, teardownTestDb } from '@/test/db';
import type { EncryptedPayload } from '@/types/crypto';

let db: Db;

const USER = 'user-alice';
const OTHER = 'user-bob';

const payload: EncryptedPayload = {
  alg: 'A256GCM',
  iv: 'AAAAAAAAAAAAAAAA',
  ciphertext: Buffer.from('x').toString('base64'),
};

const addUser = (id: string) => db.insert(users).values({ id, displayName: id });

type NoteFlags = { userId?: string; archived?: boolean; deletedAt?: Date };

const addNote = (
  table: typeof notes | typeof secretNotes | typeof sealNotes,
  { userId = USER, archived = false, deletedAt }: NoteFlags = {},
) => db.insert(table).values({ id: uuidv7(), userId, position: 1000, archived, deletedAt, title: 't' });

const addOtp = ({ userId = USER, archived = false, deletedAt }: NoteFlags = {}) =>
  db.insert(otpRecords).values({
    id: uuidv7(),
    userId,
    payload: deletedAt ? null : payload,
    position: 1000,
    archived,
    deletedAt,
  });

beforeAll(async () => {
  db = await setupTestDb();
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await resetTestDb(db);
  await addUser(USER);
  await addUser(OTHER);
});

describe('getProfileData counts', () => {
  it('is all zeroes for an account with no data', async () => {
    const profile = await getProfileData(USER);

    expect(profile?.counts).toEqual({
      notes: { active: 0, archived: 0 },
      secrets: { active: 0, archived: 0 },
      seals: { active: 0, archived: 0 },
      auth: { active: 0, archived: 0 },
    });
  });

  it('splits every tier into active and archived', async () => {
    await addNote(notes);
    await addNote(notes);
    await addNote(notes, { archived: true });
    await addNote(secretNotes, { archived: true });
    await addNote(sealNotes);
    await addOtp();
    await addOtp({ archived: true });
    await addOtp({ archived: true });

    const profile = await getProfileData(USER);

    expect(profile?.counts).toEqual({
      notes: { active: 2, archived: 1 },
      secrets: { active: 0, archived: 1 },
      seals: { active: 1, archived: 0 },
      auth: { active: 1, archived: 2 },
    });
  });

  it('ignores soft-deleted rows and other users', async () => {
    await addNote(notes, { deletedAt: new Date() });
    await addNote(notes, { archived: true, deletedAt: new Date() });
    await addNote(notes, { userId: OTHER });
    // An otp tombstone: soft-deleted and stripped of its payload.
    await addOtp({ deletedAt: new Date() });
    await addOtp({ userId: OTHER });

    const profile = await getProfileData(USER);

    expect(profile?.counts.notes).toEqual({ active: 0, archived: 0 });
    expect(profile?.counts.auth).toEqual({ active: 0, archived: 0 });
  });
});
