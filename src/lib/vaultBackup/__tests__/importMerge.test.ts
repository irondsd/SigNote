import { createHash } from 'node:crypto';

import { attachmentAggregate, canonicalJson } from '../aggregate';
import { archiveDigest, buildImportPlan, compareArchive, importDecisionKey } from '../importMerge';
import type {
  PortableAttachment,
  PortableTierRecord,
  VaultImportAnalysis,
  VaultImportLookupAttachment,
  VaultImportLookupRecord,
} from '../importTypes';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const NOW = '2026-09-18T12:00:00.000Z';

const record = (id: string, category: 'notes' | 'secrets' | 'seals', attachmentRefs: string[] = []) =>
  ({
    id,
    title: id,
    ...(category === 'notes'
      ? { content: '<p>x</p>' }
      : { encryptedBody: { alg: 'A256GCM', iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA==' } }),
    ...(category === 'seals' ? { wrappedNoteKey: null } : {}),
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
    attachmentRefs,
  }) as PortableTierRecord;

const attachment = (id: string, recordId: string, category: 'notes' | 'secrets' = 'notes') => ({
  id,
  owner: { category, recordId },
  filename: `${id}.txt`,
  size: 10,
  mimeType: 'text/plain',
  encrypted: category !== 'notes',
  encryptionIv: category !== 'notes' ? 'AAAAAAAAAAAAAAAA' : null,
  keyScope: 'vault' as const,
  keyNoteId: null,
  createdAt: NOW,
  checksum: 'a'.repeat(64),
  ordinal: 0,
});

function setup(
  records: { notes?: PortableTierRecord[]; secrets?: PortableTierRecord[]; seals?: PortableTierRecord[] },
  attachments: ReturnType<typeof attachment>[] = [],
) {
  const analysis = { tags: [], attachments } as unknown as VaultImportAnalysis;
  const all = {
    notes: records.notes ?? [],
    secrets: records.secrets ?? [],
    seals: records.seals ?? [],
    authenticators: [],
  };
  return { analysis, all };
}

const existingOf = (digest: string, id: string): VaultImportLookupRecord => ({
  id,
  digest,
  title: 'here',
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
  archived: false,
  color: null,
  pattern: null,
  revision: null,
  attachmentIds: [],
});

const noExisting = () => ({ notes: new Map(), secrets: new Map(), seals: new Map(), authenticators: new Map() });
const fileDigest = (value: PortableAttachment) => sha(canonicalJson(attachmentAggregate(value)));

describe('compareArchive', () => {
  it('sorts records into new, identical and conflicting by aggregate digest', () => {
    const same = record('same', 'notes');
    const changed = record('changed', 'notes');
    const fresh = record('fresh', 'notes');
    const { analysis, all } = setup({ notes: [same, changed, fresh] });
    const existing = noExisting();
    existing.notes.set('same', existingOf(archiveDigest('notes', same, new Map(), new Map(), sha), 'same'));
    existing.notes.set('changed', existingOf('0'.repeat(64), 'changed'));

    const { comparison } = compareArchive(analysis, all, existing, new Map(), sha);

    expect(comparison.counts.notes).toEqual({ new: 1, identical: 1, conflict: 1, blocked: 0 });
    expect(comparison.conflicts).toEqual([
      expect.objectContaining({ id: 'changed', expected: '0'.repeat(64), replaceBlocked: null, copyBlocked: null }),
    ]);
  });

  it('never offers Keep both for a Seal: its ciphertext is bound to its id', () => {
    const seal = record('seal', 'seals');
    const { analysis, all } = setup({ seals: [seal] });
    const existing = noExisting();
    existing.seals.set('seal', existingOf('0'.repeat(64), 'seal'));

    const { comparison } = compareArchive(analysis, all, existing, new Map(), sha);
    expect(comparison.conflicts[0]).toMatchObject({ copyBlocked: 'bound-to-id', replaceBlocked: null });
  });

  it('blocks Keep both for a Secret whose attachment ids already exist here', () => {
    const file = attachment('file', 'secret', 'secrets');
    const secret = record('secret', 'secrets', ['file']);
    const { analysis, all } = setup({ secrets: [secret] }, [file]);
    const existing = noExisting();
    existing.secrets.set('secret', existingOf('0'.repeat(64), 'secret'));
    const files = new Map<string, VaultImportLookupAttachment>([
      ['file', { id: 'file', digest: fileDigest(file), owner: file.owner }],
    ]);

    const { comparison } = compareArchive(analysis, all, existing, files, sha);
    expect(comparison.conflicts[0]).toMatchObject({ copyBlocked: 'attachment-in-use', replaceBlocked: null });
  });

  it('blocks a replace, and a new record, when an attachment id here is a different file', () => {
    const conflicted = record('conflicted', 'notes', ['taken']);
    const fresh = record('fresh', 'notes', ['also-taken']);
    const { analysis, all } = setup({ notes: [conflicted, fresh] }, [
      attachment('taken', 'conflicted'),
      attachment('also-taken', 'fresh'),
    ]);
    const existing = noExisting();
    existing.notes.set('conflicted', existingOf('0'.repeat(64), 'conflicted'));
    const files = new Map<string, VaultImportLookupAttachment>([
      ['taken', { id: 'taken', digest: 'f'.repeat(64), owner: { category: 'notes', recordId: 'conflicted' } }],
      ['also-taken', { id: 'also-taken', digest: null, owner: null }],
    ]);

    const { comparison } = compareArchive(analysis, all, existing, files, sha);
    expect(comparison.conflicts[0]).toMatchObject({ id: 'conflicted', replaceBlocked: 'attachment-in-use' });
    // Only a deleted row holds `also-taken`: the cleanup will release it.
    expect(comparison.blocked).toEqual([
      expect.objectContaining({ id: 'fresh', reason: 'attachment-recently-deleted' }),
    ]);
  });

  it('says a replace waits for the cleanup when only a deleted file holds the id', () => {
    const conflicted = record('conflicted', 'notes', ['deleted']);
    const inUse = record('in-use', 'notes', ['live']);
    const { analysis, all } = setup({ notes: [conflicted, inUse] }, [
      attachment('deleted', 'conflicted'),
      attachment('live', 'in-use'),
    ]);
    const existing = noExisting();
    const files = new Map<string, VaultImportLookupAttachment>([
      ['deleted', { id: 'deleted', digest: null, owner: null }],
      ['live', { id: 'live', digest: 'f'.repeat(64), owner: { category: 'notes', recordId: 'elsewhere' } }],
    ]);
    existing.notes.set('conflicted', existingOf('0'.repeat(64), 'conflicted'));

    const { comparison } = compareArchive(analysis, all, existing, files, sha);
    expect(comparison.conflicts[0]).toMatchObject({ replaceBlocked: 'attachment-recently-deleted' });
    expect(comparison.blocked).toEqual([expect.objectContaining({ id: 'in-use', reason: 'attachment-in-use' })]);
  });
});

describe('buildImportPlan', () => {
  it('stages only what changes the vault, and uploads only files not already here', () => {
    const reused = attachment('reused', 'changed');
    const added = attachment('added', 'changed');
    const newFile = attachment('new-file', 'fresh');
    const changed = record('changed', 'notes', ['reused', 'added']);
    const kept = record('kept', 'notes');
    const fresh = record('fresh', 'notes', ['new-file']);
    const { analysis, all } = setup({ notes: [changed, kept, fresh] }, [reused, added, newFile]);
    const existing = noExisting();
    existing.notes.set('changed', existingOf('0'.repeat(64), 'changed'));
    existing.notes.set('kept', existingOf('1'.repeat(64), 'kept'));
    const files = new Map<string, VaultImportLookupAttachment>([
      ['reused', { id: 'reused', digest: fileDigest(reused), owner: reused.owner }],
    ]);
    const state = compareArchive(analysis, all, existing, files, sha);

    const result = buildImportPlan(
      analysis,
      all,
      state,
      new Map([[importDecisionKey('notes', 'changed'), 'replace']]),
      'create',
    );

    expect(result.staged.notes.map((entry) => [entry.record.id, entry.action, entry.expected])).toEqual([
      ['changed', 'replace', '0'.repeat(64)],
      ['fresh', 'insert', null],
    ]);
    expect([...result.uploads].sort()).toEqual(['added', 'new-file']);
    expect(result.plan.expected).toMatchObject({ notes: 2, attachments: 2 });
    expect(result.plan.expectedAttachmentBytes).toBe(20);
  });

  it('refuses a decision the comparison ruled out', () => {
    const seal = record('seal', 'seals');
    const { analysis, all } = setup({ seals: [seal] });
    const existing = noExisting();
    existing.seals.set('seal', existingOf('0'.repeat(64), 'seal'));
    const state = compareArchive(analysis, all, existing, new Map(), sha);

    expect(() =>
      buildImportPlan(analysis, all, state, new Map([[importDecisionKey('seals', 'seal'), 'copy']]), 'drop'),
    ).toThrow('IMPORT_DECISION_NOT_ALLOWED');
  });
});
