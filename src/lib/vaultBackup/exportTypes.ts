import type { VaultExportCategory, VaultExportCounts, VaultExportSelection } from '@/db/schema';

export const VAULT_EXPORT_MIME = 'application/vnd.signote.vault';
export const VAULT_EXPORT_FORMAT_VERSION = 1 as const;
export const VAULT_EXPORT_MIN_READER_VERSION = 1 as const;

export const VAULT_EXPORT_CATEGORIES: VaultExportCategory[] = ['notes', 'secrets', 'seals', 'authenticators'];

export type { VaultExportCategory, VaultExportCounts, VaultExportSelection };

export type VaultExportSummaryCategory = {
  count: number;
  attachmentCount: number;
  estimatedBytes: number;
};

export type VaultExportSummary = {
  available: boolean;
  profileExists: boolean;
  vaultKeyId: string | null;
  rotationInProgress: boolean;
  categories: Record<VaultExportCategory, VaultExportSummaryCategory>;
};

export type VaultExportAvailability = Pick<
  VaultExportSummary,
  'available' | 'profileExists' | 'vaultKeyId' | 'rotationInProgress'
>;

export type VaultExportEntryPlan = {
  path: string;
  size: number;
  url: string;
  category: VaultExportCategory | 'profile' | 'tags' | 'attachments';
  itemCount: number;
};

export type VaultExportManifestBase = {
  type: 'signote-vault-export';
  formatVersion: typeof VAULT_EXPORT_FORMAT_VERSION;
  minimumReaderVersion: typeof VAULT_EXPORT_MIN_READER_VERSION;
  exportId: string;
  createdAt: string;
  source: {
    schemaVersion: 1;
    profileId: string | null;
    encryptionGeneration: number;
    vaultKeyId: string | null;
  };
  selection: VaultExportCategory[];
  counts: VaultExportCounts;
  categoryBytes: Record<VaultExportCategory, number>;
  includesRetainedDeletedRecords: true;
};

export type VaultExportBeginResult = {
  operationId: string;
  generation: number;
  filename: string;
  createdAt: string;
  expiresAt: string;
  entries: VaultExportEntryPlan[];
  manifest: VaultExportManifestBase;
  estimatedArchiveBytes: number;
};

export type VaultExportProgress = {
  category: VaultExportEntryPlan['category'] | 'encrypting';
  itemsProcessed: number;
  itemCount: number;
  sourceBytes: number;
  sourceTotalBytes: number;
};

export type VaultExportWorkerResult = {
  manifestDigest: string;
  plaintextBytes: number;
};
