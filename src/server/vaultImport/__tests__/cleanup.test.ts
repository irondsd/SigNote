import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { MAX_USER_STORAGE } from '@/config/fileConstants';
import type { Db } from '@/db/client';
import { fileAttachments, users, vaultImportItems, vaultImports } from '@/db/schema';
import type { VaultImportAnalysis } from '@/lib/vaultBackup/importTypes';
import { vaultExportManifestWithoutDigest } from '@/lib/vaultBackup/manifest';
import { resetTestDb, setupTestDb, teardownTestDb } from '@/test/db';
import type { VaultImportObjectStore } from '../objectStore';
import { createVaultImportService } from '../service';

/**
 * Staged attachment objects are the one thing an import leaves outside the
 * database. These pin down when the sweep may delete them: never while an
 * upload grant could still land, never once they back a live attachment, and
 * always eventually otherwise — retrying after a storage failure.
 */

const USER = 'cleanup-user';
const ACTOR = { userId: USER, sid: 'session-one' };
const NOW = '2026-09-18T12:00:00.000Z';
const CHECKSUM = 'a'.repeat(64);

const storage = {
  allocate: jest.fn((operationId: string, bytes: number, checksum: string) => ({
    key: `staging/${operationId}/${checksum}`,
    bytes,
    checksum,
  })),
  uploadGrant: jest.fn(async () => ({ url: 'https://storage.invalid/upload', headers: {} })),
  verify: jest.fn(async () => ({ etag: 'etag' })),
  verifyMetadata: jest.fn(async () => undefined),
  remove: jest.fn(async () => undefined),
};
const service = createVaultImportService({ storage: storage as unknown as VaultImportObjectStore });

let db: Db;
beforeAll(async () => {
  db = await setupTestDb();
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTestDb(db);
  jest.clearAllMocks();
  await db.insert(users).values({ id: USER, displayName: 'Cleanup owner' });
});

const note = {
  id: 'note-with-file',
  title: 'Has a file',
  content: '<p>x</p>',
  position: 1,
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
  attachmentRefs: ['file-one'],
};
const attachment = {
  id: 'file-one',
  owner: { category: 'notes' as const, recordId: note.id },
  filename: 'a.txt',
  size: 3,
  mimeType: 'text/plain',
  encrypted: false,
  encryptionIv: null,
  keyScope: 'vault' as const,
  keyNoteId: null,
  createdAt: NOW,
};

function analysis(): VaultImportAnalysis {
  const entries = [
    { path: 'data/notes.ndjson', bytes: 1, sha256: '2'.repeat(64) },
    { path: 'data/tags.json', bytes: 2, sha256: '3'.repeat(64) },
    { path: 'attachments/index.ndjson', bytes: 1, sha256: '4'.repeat(64) },
    { path: 'attachments/file-one', bytes: 3, sha256: CHECKSUM },
  ];
  const base = {
    type: 'signote-vault-export' as const,
    formatVersion: 1 as const,
    minimumReaderVersion: 1 as const,
    exportId: '01999999-9999-7999-8999-999999999999',
    createdAt: NOW,
    source: { schemaVersion: 1 as const, profileId: null, encryptionGeneration: 0, vaultKeyId: null },
    selection: ['notes' as const],
    counts: { notes: 1, secrets: 0, seals: 0, authenticators: 0, attachments: 1 },
    categoryBytes: { notes: 1, secrets: 0, seals: 0, authenticators: 0 },
    includesRetainedDeletedRecords: true as const,
  };
  const withoutDigest = vaultExportManifestWithoutDigest(base, entries);
  const digest = createHash('sha256').update(JSON.stringify(withoutDigest)).digest('hex');
  return {
    manifest: { ...withoutDigest, digest },
    profile: null,
    tags: [],
    attachments: [{ ...attachment, checksum: CHECKSUM, ordinal: 3 }],
  };
}

/** An import that has issued an upload grant for its one attachment. */
async function staged() {
  const review = await service.analyze(ACTOR, analysis());
  await service.begin(ACTOR, review.operationId, {
    tagPolicy: 'drop',
    expected: { notes: 1, secrets: 0, seals: 0, authenticators: 0, attachments: 1 },
    expectedAttachmentBytes: 3,
  });
  await service.attachmentGrant(ACTOR, review.operationId, attachment.id);
  return review.operationId;
}

const past = () => new Date(Date.now() - 60_000);
const stagedKeys = async () =>
  (await db.select({ key: vaultImportItems.stageKey }).from(vaultImportItems)).flatMap((row) => row.key ?? []);

describe('vault import cleanup', () => {
  it('keeps a staged object while its upload grant could still land', async () => {
    const operationId = await staged();
    await service.cancel(ACTOR, operationId);

    await service.cleanup();
    expect(storage.remove).not.toHaveBeenCalled();
    expect(await stagedKeys()).toHaveLength(1);
  });

  it('removes a cancelled import’s objects once the grant has expired, then the import itself', async () => {
    const operationId = await staged();
    await service.cancel(ACTOR, operationId);
    await db.update(vaultImportItems).set({ grantExpiresAt: past() });

    expect(await service.cleanup()).toEqual({ removed: 1, operations: 1 });
    expect(storage.remove).toHaveBeenCalledWith(expect.objectContaining({ checksum: CHECKSUM, bytes: 3 }));
    expect(await db.select().from(vaultImports)).toHaveLength(0);
  });

  it('aborts an import that simply expired, and reclaims it the same way', async () => {
    const operationId = await staged();
    await db.update(vaultImports).set({ expiresAt: past() }).where(eq(vaultImports.id, operationId));
    await db.update(vaultImportItems).set({ grantExpiresAt: past() });

    await service.cleanup();
    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(await db.select().from(vaultImports)).toHaveLength(0);
  });

  it('retries a failed storage delete on the next sweep', async () => {
    const operationId = await staged();
    await service.cancel(ACTOR, operationId);
    await db.update(vaultImportItems).set({ grantExpiresAt: past() });
    storage.remove.mockRejectedValueOnce(new Error('storage unavailable'));

    expect(await service.cleanup()).toEqual({ removed: 0, operations: 0 });
    expect(await db.select().from(vaultImports)).toHaveLength(1);
    expect(await service.cleanup()).toEqual({ removed: 1, operations: 1 });
  });

  it('never deletes an object that became a live attachment', async () => {
    const operationId = await staged();
    await service.verifyAttachment(ACTOR, operationId, attachment.id);
    await service.stageRecords(ACTOR, operationId, 'notes', [{ action: 'insert', expected: null, record: note }]);
    await service.commit(ACTOR, operationId);
    expect(await db.select().from(fileAttachments)).toMatchObject([{ id: attachment.id, userId: USER }]);

    await db.update(vaultImports).set({ expiresAt: past() });
    await db.update(vaultImportItems).set({ grantExpiresAt: past() });
    await service.cleanup();

    expect(storage.remove).not.toHaveBeenCalled();
    // The committed import's bookkeeping goes; the attachment stays.
    expect(await db.select().from(vaultImports)).toHaveLength(0);
    expect(await db.select().from(fileAttachments)).toHaveLength(1);
  });
});

describe('vault import attachments', () => {
  const liveFile = (id: string, size: number) =>
    db.insert(fileAttachments).values({
      id,
      userId: USER,
      s3Key: `uploads/${USER}/${id}`,
      filename: `${id}.bin`,
      size,
      mimeType: 'application/zip',
    });

  it('uploads a plaintext attachment under its own type, so it is served as one', async () => {
    await staged();
    expect(storage.uploadGrant).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'text/plain' }), 120);
  });

  it('reports the space in use, and refuses a plan the account has no room for', async () => {
    await liveFile('existing', MAX_USER_STORAGE - 2);
    const review = await service.analyze(ACTOR, analysis());
    expect(review).toMatchObject({ storageUsedBytes: MAX_USER_STORAGE - 2, storageLimitBytes: MAX_USER_STORAGE });

    await expect(
      service.begin(ACTOR, review.operationId, {
        tagPolicy: 'drop',
        expected: { notes: 1, secrets: 0, seals: 0, authenticators: 0, attachments: 1 },
        expectedAttachmentBytes: 3,
      }),
    ).rejects.toMatchObject({ code: 'STORAGE_QUOTA' });
  });

  it('rechecks the space at commit, against uploads made since the review', async () => {
    const operationId = await staged();
    await service.verifyAttachment(ACTOR, operationId, attachment.id);
    await service.stageRecords(ACTOR, operationId, 'notes', [{ action: 'insert', expected: null, record: note }]);
    await liveFile('uploaded-meanwhile', MAX_USER_STORAGE - 1);

    await expect(service.commit(ACTOR, operationId)).rejects.toMatchObject({ code: 'STORAGE_QUOTA' });
    expect(await db.select().from(fileAttachments)).toHaveLength(1);
  });
});
