import { eq } from 'drizzle-orm';

import type { Db } from '@/db/client';
import {
  encryptionProfiles,
  encryptionStates,
  noteTags,
  noteVersions,
  notes,
  secretNotes,
  tags,
  users,
  vaultExportItems,
  vaultExports,
  type VaultExportSelection,
} from '@/db/schema';
import { collectChunks } from '@/lib/vaultBackup/stream';
import { resetTestDb, setupTestDb, teardownTestDb } from '@/test/db';
import {
  beginVaultExport,
  cancelVaultExport,
  cleanupVaultExports,
  finishVaultExport,
  getVaultExportEntry,
} from '../service';

const USER = 'vault-export-user';
const PROFILE = 'vault-export-profile';
const KEY_ID = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const all: VaultExportSelection = { notes: true, secrets: true, seals: false, authenticators: false };

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTestDb(db);
  await db.insert(users).values({ id: USER, displayName: 'Export owner' });
});

async function seedProfile(vaultKeyId: string | null = KEY_ID) {
  await db.insert(encryptionProfiles).values({
    id: PROFILE,
    userId: USER,
    version: 1,
    serverShare: 'c2VydmVyLXNoYXJl',
    salt: 'c2FsdA==',
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000, length: 32 },
    keyCheck: { alg: 'A256GCM', iv: 'aXY=', ciphertext: 'Y2lwaGVydGV4dA==' },
    vaultKeyId,
  });
}

async function seedRecords() {
  await db.insert(notes).values({
    id: 'note-one',
    userId: USER,
    title: 'Portable note',
    content: '<p>Body</p>',
    position: 1,
  });
  await db.insert(noteVersions).values({
    id: 'note-version',
    userId: USER,
    noteId: 'note-one',
    title: 'Earlier title',
    content: '<p>Earlier</p>',
  });
  await db.insert(secretNotes).values({
    id: 'secret-one',
    userId: USER,
    title: 'Encrypted title',
    encryptedBody: { alg: 'A256GCM', iv: 'aXY=', ciphertext: 'Y2lwaGVy' },
    position: 2,
  });
  await db.insert(tags).values({ id: 'tag-one', userId: USER, name: 'work', color: 'blue' });
  await db.insert(noteTags).values({ userId: USER, noteId: 'note-one', tagId: 'tag-one', sortOrder: 0 });
}

async function textEntry(operationId: string, entry: string): Promise<string> {
  const result = await getVaultExportEntry(USER, operationId, entry);
  return new TextDecoder().decode(await collectChunks(result.stream));
}

describe('portable vault export inventory', () => {
  it('captures and streams profile material, records, history, and normalized tags', async () => {
    await seedProfile();
    await seedRecords();

    const plan = await beginVaultExport(USER, all);

    expect(plan.entries.map((entry) => entry.path)).toEqual([
      'profile.json',
      'data/notes.ndjson',
      'data/secrets.ndjson',
      'data/tags.json',
      'attachments/index.ndjson',
    ]);
    expect(plan.manifest.categoryBytes).toMatchObject({ notes: expect.any(Number), secrets: expect.any(Number) });
    expect(JSON.parse(await textEntry(plan.operationId, 'profile'))).toMatchObject({
      serverShare: 'c2VydmVyLXNoYXJl',
      vaultKeyId: KEY_ID,
    });
    const record = JSON.parse((await textEntry(plan.operationId, 'notes')).trim());
    expect(record).toMatchObject({ id: 'note-one', tagRefs: ['tag-one'] });
    expect(record.history).toHaveLength(1);
    expect(JSON.parse(await textEntry(plan.operationId, 'tags'))).toEqual([
      { sourceId: 'tag-one', normalizedName: 'work' },
    ]);
  });

  it('rejects a mixed snapshot when an inventoried record changes before it is read', async () => {
    await seedRecords();
    const plan = await beginVaultExport(USER, { ...all, secrets: false });
    await db.update(notes).set({ title: 'Changed afterward' }).where(eq(notes.id, 'note-one'));

    // Refused before a stream is handed back, so the route answers 409 rather
    // than dropping a connection whose headers it never sent.
    await expect(getVaultExportEntry(USER, plan.operationId, 'notes')).rejects.toMatchObject({
      code: 'VAULT_CHANGED',
    });
  });

  it('requires a portable vault id only when encrypted categories are selected', async () => {
    await seedProfile(null);
    await seedRecords();

    await expect(beginVaultExport(USER, all)).rejects.toMatchObject({ code: 'VAULT_ID_REQUIRED' });
    await expect(beginVaultExport(USER, { ...all, secrets: false })).resolves.toMatchObject({
      manifest: { source: { vaultKeyId: null } },
    });
  });

  it('allows Notes-only export during rotation but fences encrypted export', async () => {
    await seedProfile();
    await seedRecords();
    await db.insert(encryptionStates).values({ userId: USER, generation: 0, activeRotationId: 'rotation-in-progress' });

    await expect(beginVaultExport(USER, all)).rejects.toMatchObject({
      code: 'ROTATION_IN_PROGRESS',
    });
    await expect(beginVaultExport(USER, { ...all, secrets: false })).resolves.toHaveProperty('operationId');
  });

  it('can mark a coherent archive complete after later profile changes', async () => {
    await seedProfile();
    await seedRecords();
    const plan = await beginVaultExport(USER, all);
    await textEntry(plan.operationId, 'profile');
    await db.update(encryptionProfiles).set({ serverShare: 'changed' }).where(eq(encryptionProfiles.id, PROFILE));

    await expect(finishVaultExport(USER, plan.operationId, 'a'.repeat(64))).resolves.toHaveProperty('completedAt');
    const [operation] = await db.select().from(vaultExports).where(eq(vaultExports.id, plan.operationId));
    expect(operation.status).toBe('completed');
  });

  it('invalidates source streams when the user cancels', async () => {
    await seedRecords();
    const plan = await beginVaultExport(USER, { ...all, secrets: false });

    await expect(cancelVaultExport(USER, plan.operationId)).resolves.toEqual({ cancelled: true });
    await expect(getVaultExportEntry(USER, plan.operationId, 'notes')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('portable vault export cleanup', () => {
  it('removes an expired snapshot with its inventory', async () => {
    await seedRecords();
    const expired = await beginVaultExport(USER, { ...all, secrets: false });
    await db
      .update(vaultExports)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(vaultExports.id, expired.operationId));

    expect(await cleanupVaultExports()).toBe(1);
    expect(await db.select().from(vaultExports)).toHaveLength(0);
    expect(
      await db.select().from(vaultExportItems).where(eq(vaultExportItems.exportId, expired.operationId)),
    ).toHaveLength(0);
  });

  it('keeps a snapshot that is still in use', async () => {
    await seedRecords();
    const live = await beginVaultExport(USER, { ...all, secrets: false });

    expect(await cleanupVaultExports()).toBe(0);
    expect(await textEntry(live.operationId, 'notes')).toContain('note-one');
  });
});

describe('portable vault export at scale', () => {
  it('snapshots more records than fit one statement’s bind parameters, history and tags intact', async () => {
    const total = 2_500;
    await db.insert(tags).values({ id: 'bulk-tag', userId: USER, name: 'bulk', color: 'blue' });
    for (let offset = 0; offset < total; offset += 500) {
      const ids = Array.from({ length: Math.min(500, total - offset) }, (_, index) => `bulk-${offset + index}`);
      await db
        .insert(notes)
        .values(ids.map((id, index) => ({ id, userId: USER, title: id, content: '', position: index })));
      await db
        .insert(noteVersions)
        .values(ids.map((id) => ({ userId: USER, noteId: id, title: `${id} old`, content: '' })));
      await db
        .insert(noteTags)
        .values(ids.map((id) => ({ userId: USER, noteId: id, tagId: 'bulk-tag', sortOrder: 0 })));
    }

    const plan = await beginVaultExport(USER, { ...all, secrets: false });
    const lines = (await textEntry(plan.operationId, 'notes'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(lines).toHaveLength(total);
    expect(lines.every((record) => record.history.length === 1 && record.tagRefs[0] === 'bulk-tag')).toBe(true);
  }, 120_000);
});
