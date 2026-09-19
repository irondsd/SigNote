import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { encryptionProfiles, noteTags, noteVersions, notes, otpRecords, secretNotes, tags, users } from '@/db/schema';
import { archiveDigest } from '@/lib/vaultBackup/importMerge';
import type {
  PortableAuthenticator,
  PortableTierRecord,
  VaultImportAnalysis,
  VaultImportLookupRecord,
  VaultImportPlan,
} from '@/lib/vaultBackup/importTypes';
import { vaultExportManifestWithoutDigest } from '@/lib/vaultBackup/manifest';
import { resetTestDb, setupTestDb, teardownTestDb } from '@/test/db';
import type { VaultImportObjectStore } from '../objectStore';
import { createVaultImportService } from '../service';

const USER = 'vault-import-user';
const ACTOR = { userId: USER, sid: 'session-one' };
const NOW = '2026-09-18T12:00:00.000Z';
const KEY_ID = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const OTHER_KEY_ID = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA';
const b64 = (bytes: number, fill = 0) => Buffer.alloc(bytes, fill).toString('base64');
const payload = { alg: 'A256GCM' as const, iv: b64(12), ciphertext: b64(16) };
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

const storage = {
  allocate: jest.fn(),
  uploadGrant: jest.fn(),
  verify: jest.fn(),
  verifyMetadata: jest.fn(),
  remove: jest.fn(),
} as unknown as VaultImportObjectStore;
const service = createVaultImportService({ storage });

let db: Db;
beforeAll(async () => {
  db = await setupTestDb();
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTestDb(db);
  await db.insert(users).values({ id: USER, displayName: 'Restore owner' });
});

type Category = 'notes' | 'secrets' | 'authenticators';

function analysis(
  counts: Partial<Record<Category, number>>,
  { encrypted = false, vaultKeyId = KEY_ID }: { encrypted?: boolean; vaultKeyId?: string } = {},
): VaultImportAnalysis {
  const selection = (['notes', 'secrets', 'authenticators'] as const).filter((category) => counts[category]);
  const entries = [
    ...(encrypted ? [{ path: 'profile.json', bytes: 1, sha256: '1'.repeat(64) }] : []),
    ...selection.map((category, index) => ({
      path: `data/${category}.ndjson`,
      bytes: 1,
      sha256: String(index + 2).repeat(64),
    })),
    { path: 'data/tags.json', bytes: 1, sha256: '6'.repeat(64) },
    { path: 'attachments/index.ndjson', bytes: 0, sha256: '7'.repeat(64) },
  ];
  const base = {
    type: 'signote-vault-export' as const,
    formatVersion: 1 as const,
    minimumReaderVersion: 1 as const,
    exportId: '01999999-9999-7999-8999-999999999999',
    createdAt: NOW,
    source: {
      schemaVersion: 1 as const,
      profileId: encrypted ? 'source-profile' : null,
      encryptionGeneration: 4,
      vaultKeyId: encrypted ? vaultKeyId : null,
    },
    selection,
    counts: {
      notes: counts.notes ?? 0,
      secrets: counts.secrets ?? 0,
      seals: 0,
      authenticators: counts.authenticators ?? 0,
      attachments: 0,
    },
    categoryBytes: { notes: 1, secrets: 1, seals: 0, authenticators: 1 },
    includesRetainedDeletedRecords: true as const,
  };
  const withoutDigest = vaultExportManifestWithoutDigest(base, entries);
  const digest = createHash('sha256').update(JSON.stringify(withoutDigest)).digest('hex');
  return {
    manifest: { ...withoutDigest, digest },
    profile: encrypted
      ? {
          type: 'signote-encryption-profile',
          formatVersion: 1,
          version: 1,
          serverShare: b64(32),
          salt: b64(32),
          kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000, length: 32 },
          keyCheck: payload,
          vaultKeyId,
        }
      : null,
    tags: [
      { sourceId: 'source-tag', normalizedName: 'work' },
      { sourceId: 'other-tag', normalizedName: 'home' },
    ],
    attachments: [],
  };
}

const note: PortableTierRecord = {
  id: 'source-note',
  title: 'Restored note',
  content: '<p>Portable</p>',
  position: 1000,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
  archived: false,
  color: null,
  pattern: null,
  pinned: false,
  expiresAt: null,
  burnAfterReading: false,
  history: [{ title: 'Earlier', content: '<p>Old</p>', createdAt: NOW }],
  tagRefs: ['source-tag'],
  attachmentRefs: [],
};

const secret: PortableTierRecord = {
  id: 'source-secret',
  title: 'Restored secret',
  encryptedBody: payload,
  position: 1000,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
  archived: false,
  color: null,
  pattern: null,
  pinned: false,
  expiresAt: null,
  burnAfterReading: false,
  history: [],
  tagRefs: [],
  attachmentRefs: [],
};

const credential: PortableAuthenticator = {
  id: 'source-otp',
  payload,
  payloadVersion: 1,
  position: 1000,
  revision: 3,
  archived: false,
  color: null,
  pattern: null,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
};

function plan(expected: Partial<Record<Category, number>>, tagPolicy: VaultImportPlan['tagPolicy'] = 'create') {
  return {
    tagPolicy,
    expected: {
      notes: expected.notes ?? 0,
      secrets: expected.secrets ?? 0,
      seals: 0,
      authenticators: expected.authenticators ?? 0,
      attachments: 0,
    },
    expectedAttachmentBytes: 0,
  };
}

async function addProfile(vaultKeyId: string | null = KEY_ID) {
  await db.insert(encryptionProfiles).values({
    userId: USER,
    version: 1,
    serverShare: b64(32),
    salt: b64(32),
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000, length: 32 },
    keyCheck: payload,
    vaultKeyId,
  });
}

/** The destination copy of the archived note, with its tag. */
async function existingNote(overrides: Partial<typeof notes.$inferInsert> = {}) {
  await db.insert(notes).values({
    id: note.id,
    userId: USER,
    title: note.title,
    content: note.content!,
    position: note.position,
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
    ...overrides,
  });
  await db
    .insert(noteVersions)
    .values({ userId: USER, noteId: note.id, title: 'Earlier', content: '<p>Old</p>', createdAt: new Date(NOW) });
  await db.insert(tags).values({ id: 'dest-tag', userId: USER, name: 'work', color: 'red' });
  await db.insert(noteTags).values({ userId: USER, noteId: note.id, tagId: 'dest-tag', sortOrder: 0 });
}

const lookupNote = async (operationId: string) =>
  (await service.lookup(ACTOR, operationId, { category: 'notes', ids: [note.id] })) as VaultImportLookupRecord[];

describe('fresh-account vault restore', () => {
  it('keeps staged records invisible and activates records plus remapped tags atomically', async () => {
    const review = await service.analyze(ACTOR, analysis({ notes: 1 }));
    expect(review.mode).toBe('fresh');
    await service.begin(ACTOR, review.operationId, plan({ notes: 1 }));
    await service.stageRecords(ACTOR, review.operationId, 'notes', [
      { action: 'insert', expected: null, record: note },
    ]);

    expect(await db.select().from(notes)).toHaveLength(0);
    const result = await service.commit(ACTOR, review.operationId);
    expect(result.counts.notes.insert).toBe(1);
    expect(await db.select().from(notes)).toMatchObject([{ id: 'source-note', userId: USER, title: 'Restored note' }]);
    expect(await db.select().from(tags)).toEqual(
      expect.arrayContaining([expect.objectContaining({ userId: USER, name: 'work' })]),
    );
    expect(await db.select().from(noteTags)).toHaveLength(1);
  });

  it('can adopt the original profile bytes without knowing the vault passphrase', async () => {
    const review = await service.analyze(ACTOR, analysis({ secrets: 1 }, { encrypted: true }));
    expect(review.installsEncryptionProfile).toBe(true);
    await service.begin(ACTOR, review.operationId, plan({ secrets: 1 }, 'drop'));
    await service.stageRecords(ACTOR, review.operationId, 'secrets', [
      { action: 'insert', expected: null, record: secret },
    ]);
    await service.commit(ACTOR, review.operationId);

    expect(await db.select().from(secretNotes)).toMatchObject([{ id: 'source-secret', encryptedBody: payload }]);
    expect(await db.select().from(encryptionProfiles)).toMatchObject([
      { userId: USER, serverShare: b64(32), vaultKeyId: KEY_ID },
    ]);
  });
});

describe('an unfinished import left behind', () => {
  it('blocks a new import with its own code until any session discards it', async () => {
    const abandoned = await service.analyze(ACTOR, analysis({ notes: 1 }));
    await service.begin(ACTOR, abandoned.operationId, plan({ notes: 1 }));
    await expect(service.analyze(ACTOR, analysis({ notes: 1 }))).rejects.toMatchObject({
      code: 'IMPORT_IN_PROGRESS',
    });

    // The tab that opened it is gone; another session of the account clears it.
    const otherTab = { userId: USER, sid: 'session-two' };
    expect(await service.discardUnfinished(otherTab)).toEqual({ discarded: 1 });
    await expect(service.commit(ACTOR, abandoned.operationId)).rejects.toMatchObject({ code: 'CONFLICT' });

    const next = await service.analyze(otherTab, analysis({ notes: 1 }));
    await service.begin(otherTab, next.operationId, plan({ notes: 1 }));
    await service.stageRecords(otherTab, next.operationId, 'notes', [
      { action: 'insert', expected: null, record: note },
    ]);
    await service.commit(otherTab, next.operationId);
    expect(await db.select().from(notes)).toHaveLength(1);
  });

  it('leaves another account’s imports alone', async () => {
    await db.insert(users).values({ id: 'someone-else', displayName: 'Other' });
    await service.analyze({ userId: 'someone-else', sid: 's' }, analysis({ notes: 1 }));
    expect(await service.discardUnfinished(ACTOR)).toEqual({ discarded: 0 });
    await expect(service.analyze({ userId: 'someone-else', sid: 's' }, analysis({ notes: 1 }))).rejects.toMatchObject({
      code: 'IMPORT_IN_PROGRESS',
    });
  });
});

describe('same-key merge', () => {
  it('digests an archived record exactly as the server digests its stored copy', async () => {
    await addProfile();
    await existingNote();
    const review = await service.analyze(ACTOR, analysis({ notes: 1 }));
    expect(review.mode).toBe('merge');
    const [found] = await lookupNote(review.operationId);

    const input = analysis({ notes: 1 });
    const tagNames = new Map(input.tags.map((tag) => [tag.sourceId, tag.normalizedName]));
    // The Worker's side of the comparison, over the record as the archive holds it.
    expect(archiveDigest('notes', note, tagNames, new Map(), sha)).toBe(found.digest);
    expect(archiveDigest('notes', { ...note, title: 'Edited' }, tagNames, new Map(), sha)).not.toBe(found.digest);
  });

  it('refuses a vault with a different key before anything is staged', async () => {
    await addProfile(OTHER_KEY_ID);
    await expect(service.analyze(ACTOR, analysis({ secrets: 1 }, { encrypted: true }))).rejects.toMatchObject({
      code: 'VAULT_KEY_MISMATCH',
    });
  });

  it('asks for one unlock when the destination vault has no identity yet', async () => {
    await addProfile(null);
    await expect(service.analyze(ACTOR, analysis({ secrets: 1 }, { encrypted: true }))).rejects.toMatchObject({
      code: 'VAULT_ID_REQUIRED',
    });
  });

  it('merges plaintext Notes into any account, whatever its key', async () => {
    await addProfile(OTHER_KEY_ID);
    const review = await service.analyze(ACTOR, analysis({ notes: 1 }));
    expect(review.installsEncryptionProfile).toBe(false);
  });

  it('replaces the whole aggregate, reusing an existing tag without touching its color', async () => {
    await addProfile();
    await existingNote({ title: 'Changed here', content: '<p>Local</p>' });
    const review = await service.analyze(ACTOR, analysis({ notes: 1 }));
    expect(review.tagMatches).toBe(1);
    const [found] = await lookupNote(review.operationId);
    await service.begin(ACTOR, review.operationId, plan({ notes: 1 }, 'reuse'));
    await service.stageRecords(ACTOR, review.operationId, 'notes', [
      { action: 'replace', expected: found.digest, record: { ...note, tagRefs: ['source-tag', 'other-tag'] } },
    ]);
    const result = await service.commit(ACTOR, review.operationId);

    expect(result.counts.notes.replace).toBe(1);
    expect(await db.select().from(notes)).toMatchObject([{ id: note.id, title: 'Restored note' }]);
    expect(await db.select().from(noteVersions)).toHaveLength(1);
    // Reuse: "work" maps onto the existing tag, "home" is dropped, color kept.
    expect(await db.select().from(noteTags)).toMatchObject([{ tagId: 'dest-tag', sortOrder: 0 }]);
    expect(await db.select().from(tags)).toMatchObject([{ id: 'dest-tag', color: 'red' }]);
  });

  it('refuses a plan whose reviewed record changed before commit', async () => {
    await addProfile();
    await existingNote({ title: 'Changed here' });
    const review = await service.analyze(ACTOR, analysis({ notes: 1 }));
    const [found] = await lookupNote(review.operationId);
    await service.begin(ACTOR, review.operationId, plan({ notes: 1 }));
    await service.stageRecords(ACTOR, review.operationId, 'notes', [
      { action: 'replace', expected: found.digest, record: note },
    ]);
    // An edit in another tab after the review.
    await db.update(notes).set({ title: 'Edited again' }).where(eq(notes.id, note.id));

    await expect(service.commit(ACTOR, review.operationId)).rejects.toMatchObject({ code: 'DESTINATION_CHANGED' });
    expect(await db.select().from(notes)).toMatchObject([{ title: 'Edited again' }]);
  });

  it('refuses to insert over a record created after the review', async () => {
    await addProfile();
    const review = await service.analyze(ACTOR, analysis({ notes: 1 }));
    await service.begin(ACTOR, review.operationId, plan({ notes: 1 }));
    await service.stageRecords(ACTOR, review.operationId, 'notes', [
      { action: 'insert', expected: null, record: note },
    ]);
    await existingNote({ title: 'Arrived meanwhile' });

    await expect(service.commit(ACTOR, review.operationId)).rejects.toMatchObject({ code: 'DESTINATION_CHANGED' });
    expect(await db.select().from(notes)).toMatchObject([{ title: 'Arrived meanwhile' }]);
  });

  it('keeps both: the copy gets a new id and a fresh save time, the original stays', async () => {
    await addProfile();
    await existingNote({ title: 'Changed here' });
    const review = await service.analyze(ACTOR, analysis({ notes: 1 }));
    await service.begin(ACTOR, review.operationId, plan({ notes: 1 }));
    await service.stageRecords(ACTOR, review.operationId, 'notes', [{ action: 'copy', expected: null, record: note }]);
    await service.commit(ACTOR, review.operationId);

    const rows = await db.select().from(notes);
    expect(rows).toHaveLength(2);
    const copy = rows.find((row) => row.id !== note.id)!;
    expect(copy).toMatchObject({ title: 'Restored note', userId: USER });
    expect(copy.updatedAt.getTime()).toBeGreaterThan(new Date(NOW).getTime());
    expect(rows.find((row) => row.id === note.id)).toMatchObject({ title: 'Changed here' });
    // History keeps its own timestamps.
    expect(await db.select().from(noteVersions).where(eq(noteVersions.noteId, copy.id))).toMatchObject([
      { title: 'Earlier', createdAt: new Date(NOW) },
    ]);
  });

  it('never offers a second copy of an Authenticator record', async () => {
    await addProfile();
    const review = await service.analyze(ACTOR, analysis({ authenticators: 1 }, { encrypted: true }));
    await service.begin(ACTOR, review.operationId, plan({ authenticators: 1 }));
    await expect(
      service.stageRecords(ACTOR, review.operationId, 'authenticators', [
        { action: 'copy', expected: null, record: credential },
      ]),
    ).rejects.toMatchObject({ code: 'INVALID_ARCHIVE' });
  });

  it('moves an Authenticator revision past both histories so every device syncs the replacement', async () => {
    await addProfile();
    await db.insert(otpRecords).values({
      id: credential.id,
      userId: USER,
      payload: { ...payload, ciphertext: b64(16, 1) },
      payloadVersion: 1,
      position: 1,
      revision: 7,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    });
    const review = await service.analyze(ACTOR, analysis({ authenticators: 1 }, { encrypted: true }));
    const [found] = (await service.lookup(ACTOR, review.operationId, {
      category: 'authenticators',
      ids: [credential.id],
    })) as VaultImportLookupRecord[];
    expect(found.revision).toBe(7);
    await service.begin(ACTOR, review.operationId, plan({ authenticators: 1 }));
    await service.stageRecords(ACTOR, review.operationId, 'authenticators', [
      { action: 'replace', expected: found.digest, record: credential },
    ]);
    await service.commit(ACTOR, review.operationId);

    expect(
      await db
        .select()
        .from(otpRecords)
        .where(and(eq(otpRecords.userId, USER), eq(otpRecords.id, credential.id))),
    ).toMatchObject([{ payload, revision: 8 }]);
  });

  it('refuses a commit after the destination vault identity changed', async () => {
    await addProfile();
    const review = await service.analyze(ACTOR, analysis({ notes: 1 }));
    await service.begin(ACTOR, review.operationId, plan({ notes: 1 }));
    await service.stageRecords(ACTOR, review.operationId, 'notes', [
      { action: 'insert', expected: null, record: note },
    ]);
    await db.update(encryptionProfiles).set({ vaultKeyId: OTHER_KEY_ID }).where(eq(encryptionProfiles.userId, USER));

    await expect(service.commit(ACTOR, review.operationId)).rejects.toMatchObject({ code: 'DESTINATION_CHANGED' });
  });
});
