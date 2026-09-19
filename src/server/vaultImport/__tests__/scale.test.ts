import { createHash } from 'node:crypto';
import { count, eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { noteTags, noteVersions, notes, tags, users } from '@/db/schema';
import { VAULT_IMPORT_LIMITS } from '@/lib/vaultBackup/importSchemas';
import type { PortableTierRecord, VaultImportAnalysis, VaultImportLookupRecord } from '@/lib/vaultBackup/importTypes';
import { vaultExportManifestWithoutDigest } from '@/lib/vaultBackup/manifest';
import { resetTestDb, setupTestDb, teardownTestDb } from '@/test/db';
import type { VaultImportObjectStore } from '../objectStore';
import { createVaultImportService } from '../service';

/**
 * A vault far past anything the functional tests touch: several thousand
 * records, each with retained history and tags, restored and then merged back
 * with every record in conflict. What this guards is batching — Postgres caps a
 * statement at 65,535 bind parameters, so a commit that inserted one row set
 * per statement would pass every small test and fail on a real vault.
 */

const USER = 'scale-user';
const ACTOR = { userId: USER, sid: 'session-one' };
const NOW = '2026-09-18T12:00:00.000Z';
const RECORDS = 3_000;
const HISTORY = 5;
const TAGS = 40;

const service = createVaultImportService({ storage: {} as VaultImportObjectStore });

let db: Db;
beforeAll(async () => {
  db = await setupTestDb();
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTestDb(db);
  await db.insert(users).values({ id: USER, displayName: 'Scale owner' });
});

const tagList = Array.from({ length: TAGS }, (_, index) => ({
  sourceId: `tag-${index}`,
  normalizedName: `tag ${index}`,
}));
const records: PortableTierRecord[] = Array.from({ length: RECORDS }, (_, index) => ({
  id: `note-${String(index).padStart(5, '0')}`,
  title: `Note ${index}`,
  content: `<p>${'body '.repeat(20)}${index}</p>`,
  position: index,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
  archived: index % 7 === 0,
  color: null,
  pattern: null,
  pinned: false,
  expiresAt: null,
  burnAfterReading: false,
  history: Array.from({ length: HISTORY }, (_, version) => ({
    title: `Note ${index} v${version}`,
    content: `<p>version ${version}</p>`,
    createdAt: NOW,
  })),
  tagRefs: [`tag-${index % TAGS}`, `tag-${(index + 1) % TAGS}`],
  attachmentRefs: [],
}));

function analysis(): VaultImportAnalysis {
  const entries = [
    { path: 'data/notes.ndjson', bytes: 1, sha256: '2'.repeat(64) },
    { path: 'data/tags.json', bytes: 1, sha256: '3'.repeat(64) },
    { path: 'attachments/index.ndjson', bytes: 0, sha256: '4'.repeat(64) },
  ];
  const base = {
    type: 'signote-vault-export' as const,
    formatVersion: 1 as const,
    minimumReaderVersion: 1 as const,
    exportId: '01999999-9999-7999-8999-999999999999',
    createdAt: NOW,
    source: { schemaVersion: 1 as const, profileId: null, encryptionGeneration: 0, vaultKeyId: null },
    selection: ['notes' as const],
    counts: { notes: RECORDS, secrets: 0, seals: 0, authenticators: 0, attachments: 0 },
    categoryBytes: { notes: 1, secrets: 0, seals: 0, authenticators: 0 },
    includesRetainedDeletedRecords: true as const,
  };
  const withoutDigest = vaultExportManifestWithoutDigest(base, entries);
  const digest = createHash('sha256').update(JSON.stringify(withoutDigest)).digest('hex');
  return { manifest: { ...withoutDigest, digest }, profile: null, tags: tagList, attachments: [] };
}

async function restore(action: 'insert' | 'replace') {
  const review = await service.analyze(ACTOR, analysis());
  const digests = new Map<string, string>();
  if (action === 'replace')
    for (let offset = 0; offset < RECORDS; offset += VAULT_IMPORT_LIMITS.lookupIds) {
      const found = (await service.lookup(ACTOR, review.operationId, {
        category: 'notes',
        ids: records.slice(offset, offset + VAULT_IMPORT_LIMITS.lookupIds).map((record) => record.id),
      })) as VaultImportLookupRecord[];
      for (const row of found) digests.set(row.id, row.digest);
    }
  await service.begin(ACTOR, review.operationId, {
    tagPolicy: 'create',
    expected: { notes: RECORDS, secrets: 0, seals: 0, authenticators: 0, attachments: 0 },
    expectedAttachmentBytes: 0,
  });
  for (let offset = 0; offset < RECORDS; offset += VAULT_IMPORT_LIMITS.requestRecords)
    await service.stageRecords(
      ACTOR,
      review.operationId,
      'notes',
      records.slice(offset, offset + VAULT_IMPORT_LIMITS.requestRecords).map((record) => ({
        action,
        expected: action === 'replace' ? digests.get(record.id)! : null,
        record: action === 'replace' ? { ...record, title: `${record.title} (backup)` } : record,
      })),
    );
  return service.commit(ACTOR, review.operationId);
}

const total = async (table: typeof notes | typeof noteVersions | typeof noteTags | typeof tags) =>
  Number((await db.select({ n: count() }).from(table))[0].n);

it(`restores ${RECORDS} records with history and tags, then replaces all of them in one merge`, async () => {
  const restored = await restore('insert');
  expect(restored.counts.notes.insert).toBe(RECORDS);
  expect(await total(notes)).toBe(RECORDS);
  expect(await total(noteVersions)).toBe(RECORDS * HISTORY);
  expect(await total(noteTags)).toBe(RECORDS * 2);
  expect(await total(tags)).toBe(TAGS);

  const merged = await restore('replace');
  expect(merged.counts.notes.replace).toBe(RECORDS);
  // A replace swaps whole aggregates: no duplicated history or tag links,
  // and the existing tags are reused rather than created again.
  expect(await total(notes)).toBe(RECORDS);
  expect(await total(noteVersions)).toBe(RECORDS * HISTORY);
  expect(await total(noteTags)).toBe(RECORDS * 2);
  expect(await total(tags)).toBe(TAGS);
  const [sample] = await db.select().from(notes).where(eq(notes.id, 'note-01234'));
  expect(sample.title).toBe('Note 1234 (backup)');
}, 600_000);
