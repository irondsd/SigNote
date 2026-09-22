import type {
  VaultExportCategory,
  VaultExportCounts,
  VaultImportAction,
  VaultImportMode,
  VaultImportTagPolicy,
} from '@/db/schema';
import type { NoteColor, NotePattern } from '@/config/noteStyles';
import type { EncryptedPayload } from '@/types/crypto';
import type { VaultExportManifest } from './manifest';

export type PortableEncryptionProfile = {
  type: 'signote-encryption-profile';
  formatVersion: 1;
  version: 1;
  serverShare: string;
  salt: string;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: 600_000; length: 32 };
  keyCheck: EncryptedPayload;
  vaultKeyId: string;
};

export type PortableHistory = {
  title: string;
  createdAt: string;
  content?: string;
  encryptedBody?: EncryptedPayload | null;
};

export type PortableTierRecord = {
  id: string;
  title: string;
  position: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  archived: boolean;
  color: NoteColor | null;
  pattern: NotePattern | null;
  pinned: boolean;
  expiresAt: string | null;
  burnAfterReading: boolean;
  history: PortableHistory[];
  tagRefs: string[];
  attachmentRefs: string[];
  content?: string;
  encryptedBody?: EncryptedPayload | null;
  wrappedNoteKey?: EncryptedPayload | null;
};

export type PortableAuthenticator = {
  id: string;
  payload: EncryptedPayload | null;
  payloadVersion: number;
  position: number;
  revision: number;
  archived: boolean;
  color: NoteColor | null;
  pattern: NotePattern | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type PortableTag = { sourceId: string; normalizedName: string };

export type PortableAttachment = {
  id: string;
  owner: { category: 'notes' | 'secrets' | 'seals'; recordId: string };
  filename: string;
  size: number;
  mimeType: string;
  encrypted: boolean;
  encryptionIv: string | null;
  keyScope: 'vault' | 'seal';
  keyNoteId: string | null;
  createdAt: string;
};

export type VaultImportAnalysis = {
  manifest: VaultExportManifest;
  profile: PortableEncryptionProfile | null;
  tags: PortableTag[];
  attachments: Array<PortableAttachment & { checksum: string; ordinal: number }>;
};

export type { VaultImportAction, VaultImportMode, VaultImportTagPolicy };

export type VaultImportReview = {
  operationId: string;
  generation: number;
  createdAt: string;
  expiresAt: string;
  archiveCreatedAt: string;
  selection: VaultExportCategory[];
  counts: VaultExportCounts;
  tagCount: number;
  /** Archive tags whose normalized name already exists in the destination. */
  tagMatches: number;
  attachmentBytes: number;
  installsEncryptionProfile: boolean;
  mode: VaultImportMode;
  /** Attachment bytes this account holds now, and what it may hold. */
  storageUsedBytes: number;
  storageLimitBytes: number;
};

/** What the destination holds under one archived id — never content, only the
 * aggregate digest and what the conflict review may show. */
export type VaultImportLookupRecord = {
  id: string;
  digest: string;
  /** Notes, Secrets and Seals: the plaintext title. Authenticators: null. */
  title: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  archived: boolean;
  color: string | null;
  pattern: string | null;
  /** Authenticators only. */
  revision: number | null;
  attachmentIds: string[];
};

export type VaultImportLookupAttachment = {
  id: string;
  /** Null for a row that still holds the id but is deleted: unusable and unreplaceable. */
  digest: string | null;
  owner: { category: 'notes' | 'secrets' | 'seals'; recordId: string } | null;
};

export type VaultImportLookupCategory = VaultExportCategory | 'attachments';

/** One record as the Worker stages it. */
export type VaultImportStagedRecord = {
  action: VaultImportAction;
  /** `replace`: the destination digest the user reviewed. Otherwise null. */
  expected: string | null;
  record: PortableTierRecord | PortableAuthenticator;
  /** Only when the record is split across requests: its full history length. */
  historyTotal?: number;
};

export type VaultImportPlan = {
  tagPolicy: VaultImportTagPolicy;
  expected: VaultExportCounts;
  expectedAttachmentBytes: number;
};

export type VaultImportProgress = {
  stage: 'records' | 'attachments' | 'committing';
  itemsProcessed: number;
  itemCount: number;
  bytesProcessed: number;
  byteCount: number;
};
