import { z } from 'zod';

import {
  ENC_PBKDF2_ITERATIONS,
  ENC_PBKDF2_LENGTH,
  ENC_VERSION,
  MAX_CIPHER,
  MAX_CONTENT,
  MAX_OTP_CIPHER,
  MAX_TAGS_PER_NOTE,
  MAX_TITLE,
  MAX_VERSIONS,
  OTP_PAYLOAD_VERSION,
} from '@/config/constants';
import { MAX_ENCRYPTED_FILE_SIZE, MAX_FILE_SIZE, MAX_USER_STORAGE } from '@/config/fileConstants';
import { NOTE_COLORS, NOTE_PATTERNS } from '@/config/noteStyles';
import { VAULT_EXPORT_CATEGORIES, VAULT_EXPORT_FORMAT_VERSION, VAULT_EXPORT_MIN_READER_VERSION } from './exportTypes';

export const VAULT_IMPORT_LIMITS = {
  maxRecords: 100_000,
  maxTags: 5_000,
  maxAttachments: Math.ceil(MAX_USER_STORAGE / MAX_FILE_SIZE),
  maxMetadataBytes: 64 * 1024 * 1024,
  maxExpandedBytes: MAX_USER_STORAGE + 64 * 1024 * 1024,
  maxEntries: 32 + Math.ceil(MAX_USER_STORAGE / MAX_FILE_SIZE),
  operationLifetimeMs: 60 * 60 * 1000,
  requestRecords: 50,
  requestBytes: 3_000_000,
  lookupIds: 200,
  grantSeconds: 120,
  cleanupGraceMs: 60_000,
} as const;

const id = z.string().min(1).max(128);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const date = z
  .string()
  .max(64)
  .refine((value) => Number.isFinite(Date.parse(value)), 'Invalid date');
const nullableDate = date.nullable();
const base64 = (decodedBytes?: number) =>
  z
    .string()
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
    .refine(
      (value) =>
        decodedBytes === undefined ||
        (value.length / 4) * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0) === decodedBytes,
    );
const base64url32 = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/)
  .refine((value) => {
    const padded = `${value.replaceAll('-', '+').replaceAll('_', '/')}=`;
    return base64(32).safeParse(padded).success;
  });

export const portablePayloadSchema = z
  .object({ alg: z.literal('A256GCM'), iv: base64(12), ciphertext: base64().max(MAX_CIPHER) })
  .strict();

export const portableProfileSchema = z
  .object({
    type: z.literal('signote-encryption-profile'),
    formatVersion: z.literal(1),
    version: z.literal(ENC_VERSION),
    serverShare: base64(32),
    salt: base64(32),
    kdf: z
      .object({
        name: z.literal('PBKDF2'),
        hash: z.literal('SHA-256'),
        iterations: z.literal(ENC_PBKDF2_ITERATIONS),
        length: z.literal(ENC_PBKDF2_LENGTH),
      })
      .strict(),
    keyCheck: portablePayloadSchema.refine((value) => value.ciphertext.length <= 1024),
    vaultKeyId: base64url32,
  })
  .strict();

const commonTier = {
  id,
  title: z.string().max(MAX_TITLE),
  position: z.number().finite(),
  createdAt: date,
  updatedAt: date,
  deletedAt: nullableDate,
  archived: z.boolean(),
  color: z.enum(NOTE_COLORS).nullable(),
  pattern: z.enum(NOTE_PATTERNS).nullable(),
  pinned: z.boolean(),
  expiresAt: nullableDate,
  burnAfterReading: z.boolean(),
  tagRefs: z.array(id).max(MAX_TAGS_PER_NOTE),
  attachmentRefs: z.array(id).max(VAULT_IMPORT_LIMITS.maxAttachments),
};
const plainHistory = z
  .object({ title: z.string().max(MAX_TITLE), content: z.string().max(MAX_CONTENT), createdAt: date })
  .strict();
const encryptedHistory = z
  .object({ title: z.string().max(MAX_TITLE), encryptedBody: portablePayloadSchema.nullable(), createdAt: date })
  .strict();

export const portableNoteSchema = z
  .object({ ...commonTier, content: z.string().max(MAX_CONTENT), history: z.array(plainHistory).max(MAX_VERSIONS) })
  .strict();
export const portableSecretSchema = z
  .object({
    ...commonTier,
    encryptedBody: portablePayloadSchema.nullable(),
    history: z.array(encryptedHistory).max(MAX_VERSIONS),
  })
  .strict();
export const portableSealSchema = z
  .object({
    ...commonTier,
    encryptedBody: portablePayloadSchema.nullable(),
    wrappedNoteKey: portablePayloadSchema.nullable(),
    history: z.array(encryptedHistory).max(MAX_VERSIONS),
  })
  .strict();
export const portableAuthenticatorSchema = z
  .object({
    id,
    payload: portablePayloadSchema.refine((value) => value.ciphertext.length <= MAX_OTP_CIPHER).nullable(),
    payloadVersion: z.literal(OTP_PAYLOAD_VERSION),
    position: z.number().finite(),
    revision: z.number().int().positive(),
    archived: z.boolean(),
    color: z.enum(NOTE_COLORS).nullable(),
    pattern: z.enum(NOTE_PATTERNS).nullable(),
    createdAt: date,
    updatedAt: date,
    deletedAt: nullableDate,
  })
  .strict();

export const portableTagSchema = z
  .object({
    sourceId: id,
    normalizedName: z
      .string()
      .min(1)
      .max(100)
      .refine((value) => value === value.trim().toLowerCase()),
  })
  .strict();
export const portableAttachmentSchema = z
  .object({
    id,
    owner: z.object({ category: z.enum(['notes', 'secrets', 'seals']), recordId: id }).strict(),
    filename: z.string().min(1).max(255),
    size: z.number().int().nonnegative().max(MAX_ENCRYPTED_FILE_SIZE),
    mimeType: z.string().min(1).max(255),
    encrypted: z.boolean(),
    encryptionIv: base64(12).nullable(),
    keyScope: z.enum(['vault', 'seal']),
    keyNoteId: id.nullable(),
    createdAt: date,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.encrypted !== (value.encryptionIv !== null))
      ctx.addIssue({ code: 'custom', message: 'Attachment encryption metadata is inconsistent' });
    if ((value.keyScope === 'seal') !== (value.keyNoteId !== null))
      ctx.addIssue({ code: 'custom', message: 'Attachment key scope is inconsistent' });
    if (value.keyScope === 'seal' && (value.owner.category !== 'seals' || value.keyNoteId !== value.owner.recordId))
      ctx.addIssue({ code: 'custom', message: 'Seal attachment key binding is invalid' });
  });

const countsSchema = z
  .object({
    notes: z.number().int().nonnegative(),
    secrets: z.number().int().nonnegative(),
    seals: z.number().int().nonnegative(),
    authenticators: z.number().int().nonnegative(),
    attachments: z.number().int().nonnegative(),
  })
  .strict();
const manifestBaseSchema = z
  .object({
    type: z.literal('signote-vault-export'),
    formatVersion: z.literal(VAULT_EXPORT_FORMAT_VERSION),
    minimumReaderVersion: z.literal(VAULT_EXPORT_MIN_READER_VERSION),
    exportId: id,
    createdAt: date,
    source: z
      .object({
        schemaVersion: z.literal(1),
        profileId: id.nullable(),
        encryptionGeneration: z.number().int().nonnegative(),
        vaultKeyId: base64url32.nullable(),
      })
      .strict(),
    selection: z
      .array(
        z.enum(
          VAULT_EXPORT_CATEGORIES as [(typeof VAULT_EXPORT_CATEGORIES)[number], ...typeof VAULT_EXPORT_CATEGORIES],
        ),
      )
      .max(4),
    counts: countsSchema,
    categoryBytes: z
      .object({
        notes: z.number().int().nonnegative(),
        secrets: z.number().int().nonnegative(),
        seals: z.number().int().nonnegative(),
        authenticators: z.number().int().nonnegative(),
      })
      .strict(),
    includesRetainedDeletedRecords: z.literal(true),
  })
  .strict();

export const vaultImportManifestSchema = manifestBaseSchema
  .extend({
    totals: z
      .object({ plaintextBytes: z.number().int().nonnegative(), attachmentBytes: z.number().int().nonnegative() })
      .strict(),
    entries: z
      .array(z.object({ path: z.string().min(1).max(1024), bytes: z.number().int().nonnegative(), sha256 }).strict())
      .max(VAULT_IMPORT_LIMITS.maxEntries),
    digest: sha256,
  })
  .strict();

export const vaultImportAnalysisSchema = z
  .object({
    manifest: vaultImportManifestSchema,
    profile: portableProfileSchema.nullable(),
    tags: z.array(portableTagSchema).max(VAULT_IMPORT_LIMITS.maxTags),
    attachments: z
      .array(
        portableAttachmentSchema.and(z.object({ checksum: sha256, ordinal: z.number().int().nonnegative() }).strict()),
      )
      .max(VAULT_IMPORT_LIMITS.maxAttachments),
  })
  .strict();

export const vaultImportRecordSchemas = {
  notes: portableNoteSchema,
  secrets: portableSecretSchema,
  seals: portableSealSchema,
  authenticators: portableAuthenticatorSchema,
} as const;

export const vaultImportLookupSchema = z
  .object({
    category: z.enum(['notes', 'secrets', 'seals', 'authenticators', 'attachments']),
    ids: z.array(id).min(1).max(VAULT_IMPORT_LIMITS.lookupIds),
  })
  .strict();

export const vaultImportPlanSchema = z
  .object({
    tagPolicy: z.enum(['drop', 'reuse', 'create']),
    expected: countsSchema,
    expectedAttachmentBytes: z.number().int().nonnegative(),
  })
  .strict();

const stagedAction = z.enum(['insert', 'replace', 'copy']);
const stagedRecord = <T extends z.ZodType>(record: T, copyAllowed: boolean) =>
  z
    .object({ action: stagedAction, expected: sha256.nullable(), record })
    .strict()
    .superRefine((value, ctx) => {
      if ((value.action === 'replace') !== (value.expected !== null))
        ctx.addIssue({ code: 'custom', message: 'Only a replace carries the reviewed destination digest' });
      // Seal and Authenticator ciphertext is bound to its id: no second copy.
      if (value.action === 'copy' && !copyAllowed)
        ctx.addIssue({ code: 'custom', message: 'Keep both is not available for this category' });
    });

export const vaultImportStagedRecordSchemas = {
  notes: stagedRecord(portableNoteSchema, true),
  secrets: stagedRecord(portableSecretSchema, true),
  seals: stagedRecord(portableSealSchema, false),
  authenticators: stagedRecord(portableAuthenticatorSchema, false),
} as const;
