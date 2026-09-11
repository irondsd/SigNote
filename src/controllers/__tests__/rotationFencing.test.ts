import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

jest.mock('@/lib/s3', () => ({
  uploadToS3: jest.fn(async () => undefined),
  deleteFromS3: jest.fn(async () => undefined),
  streamFromS3: jest.fn(),
}));

import {
  createProfile,
  getMaterialByUserId,
  getProfileByUserId,
  updateProfile,
} from '@/controllers/encryptionProfiles';
import { cleanupExpiredRows } from '@/controllers/cleanup';
import {
  cleanupDeletedFiles,
  cleanupOrphanedFiles,
  createFileAttachment,
  deleteFileAttachment,
  getFileAttachment,
  linkFilesToNote,
} from '@/controllers/files';
import { ConflictEncryptedDataError, linkIdentity } from '@/controllers/identities';
import {
  createOtpRecord,
  deleteOtpRecord,
  listOtpRecords,
  reorderOtpRecords,
  updateOtpRecord,
} from '@/controllers/otpRecords';
import { getProfileData } from '@/controllers/profile';
import {
  eraseAccount,
  eraseEncryptionProfile,
  eraseFiles,
  eraseNotes,
  eraseOtp,
  eraseSeals,
  eraseSecrets,
} from '@/controllers/erase';
import {
  createSecret,
  getSecretById,
  getSecretVersions,
  secretOps,
  updateSecret,
  updateSecretColor,
} from '@/controllers/secrets';
import { createSeal, getSealById, getSealVersions, sealOps, updateSeal, updateSealColor } from '@/controllers/seals';
import { createTag, deleteTagAndDetach, listTags, updateTag } from '@/controllers/tags';
import { isSessionEpochAllowed } from '@/controllers/authSessions';
import type { Db } from '@/db/client';
import { withRequestGeneration } from '@/db/encryptionState';
import {
  authIdentities,
  authSessions,
  encryptionProfiles,
  encryptionStates,
  fileAttachments,
  notes,
  otpRecords,
  sealNotes,
  secretNotes,
  users,
} from '@/db/schema';
import { resetTestDb, setupTestDb, teardownTestDb } from '@/test/db';
import type { EncryptedPayload } from '@/types/crypto';

let db: Db;

const USER = 'fence-user';
const OTHER = 'fence-other';
const payload = (marker = 'body'): EncryptedPayload => ({
  alg: 'A256GCM',
  iv: 'AAAAAAAAAAAAAAAA',
  ciphertext: Buffer.from(marker).toString('base64'),
});

const expectConflict = (promise: Promise<unknown>, code = 'ROTATION_IN_PROGRESS') =>
  expect(promise).rejects.toMatchObject({ name: 'VaultConflictError', code });

async function setState(
  userId: string,
  values: { generation?: number; activeRotationId?: string | null },
): Promise<void> {
  const generation = values.generation ?? 0;
  const activeRotationId = values.activeRotationId ?? null;
  await db
    .insert(encryptionStates)
    .values({ userId, generation, activeRotationId })
    .onConflictDoUpdate({ target: encryptionStates.userId, set: { generation, activeRotationId } });
}

const activate = (userId = USER) => setState(userId, { activeRotationId: 'rotation-active' });
const clearRotation = (userId = USER) => setState(userId, { activeRotationId: null });

async function addUser(id: string): Promise<void> {
  await db.insert(users).values({ id, displayName: id });
}

async function addFile(
  userId = USER,
  values: Partial<typeof fileAttachments.$inferInsert> = {},
): Promise<typeof fileAttachments.$inferSelect> {
  const [row] = await db
    .insert(fileAttachments)
    .values({
      userId,
      s3Key: `uploads/${userId}/${uuidv7()}/file.bin`,
      filename: 'file.bin',
      size: 3,
      mimeType: 'application/octet-stream',
      ...values,
    })
    .returning();
  return row;
}

async function addProfile(userId = USER): Promise<void> {
  await createProfile(userId, {
    version: 1,
    serverShare: 'server-share',
    salt: 'salt-value',
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 1_000, length: 32 },
    keyCheck: payload('key-check'),
  });
}

beforeAll(async () => {
  db = await setupTestDb();
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await resetTestDb(db);
});

describe('ordinary encrypted tier writes are fenced', () => {
  it('account erasure retains an epoch tombstone and revokes every surviving session', async () => {
    await addUser(USER);
    await setState(USER, { generation: 1 });
    await db.insert(authSessions).values({
      id: 'erased-sid',
      userId: USER,
      provider: 'siwe',
      client: 'web',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await withRequestGeneration('1', () => eraseAccount(USER));
    const [state] = await db.select().from(encryptionStates).where(eq(encryptionStates.userId, USER));
    expect(state).toMatchObject({ generation: 1, sessionEpoch: 1, survivingSid: null });
    expect(isSessionEpochAllowed(state, 'erased-sid', 0)).toBe(false);
    const [session] = await db.select().from(authSessions).where(eq(authSessions.id, 'erased-sid'));
    expect(session.revokedAt).not.toBeNull();
    expect(await db.select().from(users).where(eq(users.id, USER))).toHaveLength(0);
  });

  it('freezes secret and seal metadata, history, burn, and reads during rotation', async () => {
    const secret = await createSecret(USER, 'secret', payload('secret-1'));
    const seal = await createSeal(USER, 'seal', payload('seal-1'), payload('wrapped'));
    await activate();

    await expectConflict(updateSecretColor(secret._id, 'red'));
    await expectConflict(updateSealColor(seal._id, 'blue'));
    await expectConflict(updateSecret(secret._id, 'secret-2', payload('secret-2')));
    await expectConflict(updateSeal(seal._id, { title: 'seal-2', encryptedBody: payload('seal-2') }));
    await expectConflict(secretOps.applyPatch(secret._id, { burnAfterReading: true }));
    await expectConflict(sealOps.applyPatch(seal._id, { burnAfterReading: true }));
    expect(await getSecretById(secret._id)).toMatchObject({ _id: secret._id, generation: 0 });
    expect(await getSealById(seal._id)).toMatchObject({ _id: seal._id, generation: 0 });
    expect(await getSecretVersions(secret._id)).toMatchObject({ userId: USER, versions: [] });
    expect(await getSealVersions(seal._id)).toMatchObject({ userId: USER, versions: [] });

    const [storedSecret] = await db.select().from(secretNotes).where(eq(secretNotes.id, secret._id));
    const [storedSeal] = await db.select().from(sealNotes).where(eq(sealNotes.id, seal._id));
    expect(storedSecret?.title).toBe('secret');
    expect(storedSeal?.title).toBe('seal');
  });

  it('freezes tag and authenticator mutations during rotation', async () => {
    const tag = await createTag(USER, 'work');
    const otp = await createOtpRecord(USER, {
      id: uuidv7(),
      payload: payload('otp'),
      payloadVersion: 1,
      position: 100,
    });
    await activate();

    expect(await listTags(USER)).toHaveLength(1);
    await expectConflict(createTag(USER, 'blocked'));
    await expectConflict(updateTag(tag._id, { name: 'renamed' }));
    await expectConflict(deleteTagAndDetach(tag._id));

    expect(await listOtpRecords(USER)).toHaveLength(1);
    await expectConflict(
      createOtpRecord(USER, { id: uuidv7(), payload: payload('new'), payloadVersion: 1, position: 200 }),
    );
    await expectConflict(
      updateOtpRecord(USER, { id: otp.id, expectedRevision: otp.revision, payload: payload('changed') }),
    );
    await expectConflict(deleteOtpRecord(USER, otp.id, otp.revision));
    await expectConflict(reorderOtpRecords(USER, [{ id: otp.id, position: 500 }]));
  });
});

describe('profile, reset, and erasure writes are fenced', () => {
  it('rejects profile changes and every encrypted-data erasure while active', async () => {
    await addUser(USER);
    await addProfile();
    const note = await db
      .insert(notes)
      .values({ userId: USER, title: 'note', content: 'body', position: 1 })
      .returning();
    await db.insert(secretNotes).values({ userId: USER, title: 'secret', encryptedBody: payload(), position: 2 });
    await db
      .insert(sealNotes)
      .values({ userId: USER, title: 'seal', encryptedBody: payload(), wrappedNoteKey: payload('key'), position: 3 });
    const otp = await createOtpRecord(USER, { id: uuidv7(), payload: payload('otp'), payloadVersion: 1, position: 4 });
    const file = await addFile(USER, { noteId: note[0].id, noteTier: 'note', encrypted: true });
    await activate();

    expect(await getProfileByUserId(USER)).toMatchObject({ generation: 0 });
    expect(await getMaterialByUserId(USER)).toMatchObject({ generation: 0 });
    expect(await getProfileData(USER)).toMatchObject({ generation: 0 });
    await expectConflict(
      updateProfile(USER, { serverShare: 'new-share', salt: 'new-salt', keyCheck: payload('new-check') }),
    );
    await expectConflict(eraseEncryptionProfile(USER));
    await expectConflict(eraseNotes(USER));
    await expectConflict(eraseSecrets(USER));
    await expectConflict(eraseSeals(USER));
    await expectConflict(eraseOtp(USER));
    await expectConflict(eraseFiles(USER));
    await expectConflict(eraseAccount(USER));

    expect((await db.select().from(encryptionProfiles).where(eq(encryptionProfiles.userId, USER))).length).toBe(1);
    expect((await db.select().from(otpRecords).where(eq(otpRecords.id, otp.id))).length).toBe(1);
    expect((await db.select().from(fileAttachments).where(eq(fileAttachments.id, file.id))).length).toBe(1);
  });
});

describe('file publication, deletion, and cleanup are fenced', () => {
  it('freezes publication, linking, deletion, and reads during rotation', async () => {
    const uploaded = await createFileAttachment(USER, {
      filename: 'before.txt',
      size: 3,
      mimeType: 'text/plain',
      buffer: Buffer.from('abc'),
    });
    await activate();

    await expectConflict(
      createFileAttachment(USER, {
        filename: 'blocked.txt',
        size: 3,
        mimeType: 'text/plain',
        buffer: Buffer.from('abc'),
      }),
    );
    await expectConflict(linkFilesToNote(USER, uuidv7(), 'note', [uploaded._id]));
    await expectConflict(deleteFileAttachment(uploaded._id, USER));
    expect(await getFileAttachment(uploaded._id, USER)).toMatchObject({ _id: uploaded._id, generation: 0 });

    await clearRotation();
    const deleted = await deleteFileAttachment(uploaded._id, USER);
    expect(deleted).toMatchObject({ _id: uploaded._id, generation: 0 });
  });

  it('skips orphan cleanup while active and removes the candidate after clear', async () => {
    const orphan = await addFile(USER, { noteId: uuidv7(), noteTier: 'note' });
    await db.insert(notes).values({
      userId: USER,
      title: 'expired during rotation',
      content: 'body',
      position: 1,
      deletedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });
    await activate();

    await expect(cleanupOrphanedFiles()).resolves.toEqual({ scanned: 0, orphaned: 0 });
    expect((await cleanupExpiredRows()).notes).toBe(0);
    expect((await db.select().from(fileAttachments).where(eq(fileAttachments.id, orphan.id)))[0]?.deletedAt).toBeNull();

    await clearRotation();
    await expect(cleanupOrphanedFiles()).resolves.toEqual({ scanned: 1, orphaned: 1 });
    expect((await cleanupExpiredRows()).notes).toBe(1);
    expect(
      (await db.select().from(fileAttachments).where(eq(fileAttachments.id, orphan.id)))[0]?.deletedAt,
    ).toBeInstanceOf(Date);
  });

  it('defers physical deletion while active and completes it after clear', async () => {
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const file = await addFile(USER, { deletedAt: old });
    await activate();

    await expect(cleanupDeletedFiles()).resolves.toEqual({ processed: 0, deleted: 0, failed: 0 });
    expect(
      (await db.select().from(fileAttachments).where(eq(fileAttachments.id, file.id)))[0]?.storageDeletedAt,
    ).toBeNull();

    await clearRotation();
    await expect(cleanupDeletedFiles()).resolves.toEqual({ processed: 1, deleted: 1, failed: 0 });
    expect(
      (await db.select().from(fileAttachments).where(eq(fileAttachments.id, file.id)))[0]?.storageDeletedAt,
    ).toBeInstanceOf(Date);
  });
});

describe('generation fencing and response labels', () => {
  it('rejects legacy and stale generation requests after commit', async () => {
    await addUser(USER);
    await addProfile();
    const secret = await createSecret(USER, 'secret', payload());
    await createOtpRecord(USER, { id: uuidv7(), payload: payload('otp'), payloadVersion: 1, position: 1 });
    const file = await addFile(USER);
    await setState(USER, { generation: 1, activeRotationId: null });

    await expectConflict(getProfileByUserId(USER), 'GENERATION_MISMATCH');
    await expectConflict(getSecretById(secret._id), 'GENERATION_MISMATCH');
    await expectConflict(listOtpRecords(USER), 'GENERATION_MISMATCH');
    await expectConflict(getFileAttachment(file.id, USER), 'GENERATION_MISMATCH');
    await expectConflict(createTag(USER, 'stale-write'), 'GENERATION_MISMATCH');
    await expectConflict(
      withRequestGeneration('0', () => getProfileByUserId(USER)),
      'GENERATION_MISMATCH',
    );
  });

  it('returns the locked current generation on ordinary snapshots and writes', async () => {
    await addUser(USER);
    await addProfile();
    const secret = await createSecret(USER, 'secret', payload());
    const otp = await createOtpRecord(USER, { id: uuidv7(), payload: payload('otp'), payloadVersion: 1, position: 1 });
    const file = await addFile(USER);
    await setState(USER, { generation: 3, activeRotationId: null });

    await withRequestGeneration('3', async () => {
      expect((await getProfileByUserId(USER))?.generation).toBe(3);
      expect((await getSecretById(secret._id))?.generation).toBe(3);
      expect((await listOtpRecords(USER)).find((row) => row.id === otp.id)?.generation).toBe(3);
      expect((await getFileAttachment(file.id, USER))?.generation).toBe(3);
      expect((await updateSecretColor(secret._id, 'red'))?.generation).toBe(3);
    });
  });
});

describe('identity merges reject every retained encrypted resource', () => {
  it.each(['auth-only', 'deleted-secret', 'encrypted-file'] as const)(
    'rejects a secondary account containing %s',
    async (kind) => {
      await addUser('primary');
      await addUser(OTHER);
      await db.insert(authIdentities).values({
        userId: OTHER,
        provider: 'google',
        providerSubject: `merge-${kind}`,
      });

      if (kind === 'auth-only') {
        await db.insert(otpRecords).values({
          id: uuidv7(),
          userId: OTHER,
          payload: payload('auth'),
          payloadVersion: 1,
          position: 1,
        });
      } else if (kind === 'deleted-secret') {
        await db.insert(secretNotes).values({
          userId: OTHER,
          title: 'deleted',
          encryptedBody: payload('deleted'),
          position: 1,
          deletedAt: new Date(),
        });
      } else {
        await addFile(OTHER, { encrypted: true, storageDeletedAt: null });
      }

      await expect(linkIdentity('primary', 'google', `merge-${kind}`, {})).rejects.toBeInstanceOf(
        ConflictEncryptedDataError,
      );

      expect((await db.select().from(users).where(eq(users.id, OTHER))).length).toBe(1);
      expect(
        (
          await db
            .select()
            .from(authIdentities)
            .where(eq(authIdentities.providerSubject, `merge-${kind}`))
        )[0]?.userId,
      ).toBe(OTHER);
    },
  );
});
