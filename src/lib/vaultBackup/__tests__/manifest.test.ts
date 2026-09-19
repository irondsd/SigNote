import {
  plannedVaultExportManifestSize,
  vaultExportManifestBytes,
  vaultExportManifestWithoutDigest,
} from '../manifest';
import type { VaultExportBeginResult } from '../exportTypes';

const plan = {
  manifest: {
    type: 'signote-vault-export',
    formatVersion: 1,
    minimumReaderVersion: 1,
    exportId: '01999999-9999-7999-8999-999999999999',
    createdAt: '2026-09-18T00:00:00.000Z',
    source: { schemaVersion: 1, profileId: null, encryptionGeneration: 0, vaultKeyId: null },
    selection: ['notes'],
    counts: { notes: 1, secrets: 0, seals: 0, authenticators: 0, attachments: 1 },
    categoryBytes: { notes: 111, secrets: 0, seals: 0, authenticators: 0 },
    includesRetainedDeletedRecords: true,
  },
  entries: [
    { path: 'data/notes.ndjson', size: 12, url: '/notes', category: 'notes', itemCount: 1 },
    { path: 'attachments/file', size: 99, url: '/file', category: 'attachments', itemCount: 1 },
  ],
} satisfies Pick<VaultExportBeginResult, 'manifest' | 'entries'>;

it('keeps the final manifest byte length equal to its fixed-digest plan', () => {
  const entries = plan.entries.map((entry, index) => ({
    path: entry.path,
    bytes: entry.size,
    sha256: String(index).repeat(64),
  }));
  const withoutDigest = vaultExportManifestWithoutDigest(plan.manifest, entries);
  const final = vaultExportManifestBytes({ ...withoutDigest, digest: 'f'.repeat(64) });

  expect(final.byteLength).toBe(plannedVaultExportManifestSize(plan.manifest, plan.entries));
  expect(withoutDigest.totals).toEqual({ plaintextBytes: 111, attachmentBytes: 99 });
});
