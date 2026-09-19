import { createHash } from 'node:crypto';

import { createEncryptedVaultBackupArchive, type VaultBackupArchiveEntry } from '../archive';
import { parseVaultImportArchive, visitVaultImportAttachments } from '../importArchive';
import { vaultExportManifestWithoutDigest } from '../manifest';
import { collectChunks } from '../stream';

const PASSWORD = 'correct horse battery staple';
const OPTIONS = { opsLimit: 2, memLimit: 19 * 1024 * 1024, chunkBytes: 64 * 1024 } as const;
const encoder = new TextEncoder();
const bytes = (value: string) => encoder.encode(value);
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const NOW = '2026-09-18T12:00:00.000Z';

const note = {
  id: 'note-one',
  title: 'Portable',
  content: '<p>Hello</p>',
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
  tagRefs: ['tag-one'],
  attachmentRefs: [],
};

async function archive(extraAfterManifest = false) {
  const bodies = [
    { path: 'data/notes.ndjson', body: bytes(`${JSON.stringify(note)}\n`) },
    { path: 'data/tags.json', body: bytes(JSON.stringify([{ sourceId: 'tag-one', normalizedName: 'work' }])) },
    { path: 'attachments/index.ndjson', body: new Uint8Array() },
  ];
  const manifestEntries = bodies.map(({ path, body }) => ({ path, bytes: body.byteLength, sha256: hash(body) }));
  const base = {
    type: 'signote-vault-export' as const,
    formatVersion: 1 as const,
    minimumReaderVersion: 1 as const,
    exportId: '01999999-9999-7999-8999-999999999999',
    createdAt: NOW,
    source: { schemaVersion: 1 as const, profileId: null, encryptionGeneration: 0, vaultKeyId: null },
    selection: ['notes'] as const,
    counts: { notes: 1, secrets: 0, seals: 0, authenticators: 0, attachments: 0 },
    categoryBytes: { notes: bodies[0].body.byteLength, secrets: 0, seals: 0, authenticators: 0 },
    includesRetainedDeletedRecords: true as const,
  };
  const withoutDigest = vaultExportManifestWithoutDigest({ ...base, selection: [...base.selection] }, manifestEntries);
  const manifest = bytes(JSON.stringify({ ...withoutDigest, digest: hash(bytes(JSON.stringify(withoutDigest))) }));
  const entries: VaultBackupArchiveEntry[] = [
    ...bodies.map(({ path, body }) => ({ path, size: body.byteLength, source: [body] })),
    { path: 'manifest.json', size: manifest.byteLength, source: [manifest] },
  ];
  if (extraAfterManifest) entries.push({ path: 'unexpected.bin', size: 1, source: [Uint8Array.of(1)] });
  const result = await createEncryptedVaultBackupArchive(entries, PASSWORD, OPTIONS);
  const encrypted = await collectChunks(result.readable);
  await result.completed;
  return encrypted;
}

describe('portable vault import parser', () => {
  it('decrypts and validates a complete archive before exposing records', async () => {
    const parsed = await parseVaultImportArchive([await archive()], PASSWORD);
    expect(parsed.analysis.manifest.counts.notes).toBe(1);
    expect(parsed.analysis.tags).toEqual([{ sourceId: 'tag-one', normalizedName: 'work' }]);
    expect(parsed.records.notes).toMatchObject([{ id: 'note-one', content: '<p>Hello</p>' }]);
  });

  it('rejects entries after the authenticated final manifest', async () => {
    await expect(parseVaultImportArchive([await archive(true)], PASSWORD)).rejects.toMatchObject({
      code: 'INVALID_ARCHIVE',
    });
  });

  it('does not confuse a wrong password with a valid empty archive', async () => {
    await expect(parseVaultImportArchive([await archive()], 'wrong password')).rejects.toMatchObject({
      code: 'WRONG_PASSWORD',
    });
  });

  it('reaches attachments past skipped entries when the archive is read as a File', async () => {
    // A File streams in pieces. Cancelling a skipped entry's body used to stall
    // the TAR decoder there, so the attachment pass never reached the files.
    const file = new Uint8Array(4 * 1024 * 1024).fill(7);
    const entry = (path: string, body: Uint8Array) => ({ path, size: body.byteLength, source: [body] });
    const encrypted = await collectChunks(
      (
        await createEncryptedVaultBackupArchive(
          [
            entry('profile.json', bytes('{}')),
            entry('data/notes.ndjson', new Uint8Array(60_000).fill(65)),
            entry('attachments/file-one', file),
            entry('manifest.json', bytes('{}')),
          ],
          PASSWORD,
          OPTIONS,
        )
      ).readable,
    );
    const visited: Array<[string, number]> = [];
    await visitVaultImportAttachments(new Blob([encrypted]).stream(), PASSWORD, async (id, body) => {
      visited.push([id, body.byteLength]);
    });
    expect(visited).toEqual([['file-one', file.byteLength]]);
  }, 20_000);
});
