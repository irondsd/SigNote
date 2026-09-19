import type { VaultExportEntryPlan, VaultExportManifestBase } from './exportTypes';

export type VaultExportManifestEntry = { path: string; bytes: number; sha256: string };
export type VaultExportManifest = VaultExportManifestBase & {
  totals: { plaintextBytes: number; attachmentBytes: number };
  entries: VaultExportManifestEntry[];
  digest: string;
};

/** Runtime-safe projection for readers. Passing a parsed manifest directly to
 * a spread-based helper would otherwise retain its authenticated `digest`. */
export function vaultExportManifestBase(manifest: VaultExportManifest): VaultExportManifestBase {
  return {
    type: manifest.type,
    formatVersion: manifest.formatVersion,
    minimumReaderVersion: manifest.minimumReaderVersion,
    exportId: manifest.exportId,
    createdAt: manifest.createdAt,
    source: manifest.source,
    selection: manifest.selection,
    counts: manifest.counts,
    categoryBytes: manifest.categoryBytes,
    includesRetainedDeletedRecords: manifest.includesRetainedDeletedRecords,
  };
}

export function vaultExportManifestWithoutDigest(
  base: VaultExportManifestBase,
  entries: VaultExportManifestEntry[],
): Omit<VaultExportManifest, 'digest'> {
  return {
    ...base,
    totals: {
      plaintextBytes: entries.reduce((total, entry) => total + entry.bytes, 0),
      attachmentBytes: entries
        .filter((entry) => entry.path.startsWith('attachments/') && entry.path !== 'attachments/index.ndjson')
        .reduce((total, entry) => total + entry.bytes, 0),
    },
    entries,
  };
}

export function vaultExportManifestBytes(manifest: VaultExportManifest): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(manifest));
}

/** All digests are fixed-width lowercase SHA-256, so the placeholder and final
 * manifest have exactly the same UTF-8 length. TAR can therefore be planned
 * before any source response has been consumed. */
export function plannedVaultExportManifestSize(base: VaultExportManifestBase, entries: VaultExportEntryPlan[]): number {
  const placeholderEntries = entries.map((entry) => ({ path: entry.path, bytes: entry.size, sha256: '0'.repeat(64) }));
  return vaultExportManifestBytes({
    ...vaultExportManifestWithoutDigest(base, placeholderEntries),
    digest: '0'.repeat(64),
  }).byteLength;
}
