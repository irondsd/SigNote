import sodium from 'libsodium-wrappers-sumo';

import { readVaultBackupTarEntries } from './archive';
import { decryptVaultBackupStream } from './envelope';
import { VAULT_EXPORT_CATEGORIES, type VaultExportCategory } from './exportTypes';
import {
  VAULT_IMPORT_LIMITS,
  portableAttachmentSchema,
  portableProfileSchema,
  portableTagSchema,
  vaultImportManifestSchema,
  vaultImportRecordSchemas,
} from './importSchemas';
import type {
  PortableAttachment,
  PortableAuthenticator,
  PortableEncryptionProfile,
  PortableTag,
  PortableTierRecord,
  VaultImportAnalysis,
} from './importTypes';
import { vaultExportManifestBase, vaultExportManifestWithoutDigest, type VaultExportManifestEntry } from './manifest';
import { collectChunks, readableStreamValues, type VaultBackupChunkSource } from './stream';

const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();
const categoryPaths = new Map(VAULT_EXPORT_CATEGORIES.map((category) => [`data/${category}.ndjson`, category]));

export class VaultImportArchiveError extends Error {
  constructor(readonly code: 'INVALID_ARCHIVE' | 'WRONG_PASSWORD' | 'LIMIT' | 'CANCELLED') {
    super(code);
    this.name = 'VaultImportArchiveError';
  }
}

export type ParsedVaultImport = {
  analysis: VaultImportAnalysis;
  records: Record<VaultExportCategory, Array<PortableTierRecord | PortableAuthenticator>>;
};

function sha256(bytes: Uint8Array) {
  return sodium.to_hex(sodium.crypto_hash_sha256(bytes));
}

function uniqueIds(values: Array<{ id: string }>) {
  return new Set(values.map((value) => value.id)).size === values.length;
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    throw new VaultImportArchiveError('INVALID_ARCHIVE');
  }
}

function parseNdjson(bytes: Uint8Array, category: VaultExportCategory) {
  const text = decoder.decode(bytes);
  if (!text) return [];
  if (!text.endsWith('\n')) throw new VaultImportArchiveError('INVALID_ARCHIVE');
  const lines = text.slice(0, -1).split('\n');
  if (lines.length > VAULT_IMPORT_LIMITS.maxRecords) throw new VaultImportArchiveError('LIMIT');
  const schema = vaultImportRecordSchemas[category];
  const records = lines.map((line) => {
    try {
      const result = schema.safeParse(JSON.parse(line));
      if (!result.success) throw new Error();
      return result.data as PortableTierRecord | PortableAuthenticator;
    } catch {
      throw new VaultImportArchiveError('INVALID_ARCHIVE');
    }
  });
  if (!uniqueIds(records)) throw new VaultImportArchiveError('INVALID_ARCHIVE');
  return records;
}

async function readAndHash(source: ReadableStream<Uint8Array>, maxBytes: number) {
  const state = sodium.crypto_hash_sha256_init();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of readableStreamValues(source)) {
    total += chunk.byteLength;
    if (total > maxBytes) throw new VaultImportArchiveError('LIMIT');
    sodium.crypto_hash_sha256_update(state, chunk);
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, digest: sodium.to_hex(sodium.crypto_hash_sha256_final(state)) };
}

async function hashOnly(source: ReadableStream<Uint8Array>, expectedBytes: number) {
  const state = sodium.crypto_hash_sha256_init();
  let total = 0;
  for await (const chunk of readableStreamValues(source)) {
    total += chunk.byteLength;
    if (total > expectedBytes) throw new VaultImportArchiveError('INVALID_ARCHIVE');
    sodium.crypto_hash_sha256_update(state, chunk);
  }
  if (total !== expectedBytes) throw new VaultImportArchiveError('INVALID_ARCHIVE');
  return sodium.to_hex(sodium.crypto_hash_sha256_final(state));
}

/**
 * Cross-entry consistency, checked before anything leaves the device (the
 * server repeats it at commit): every tag and attachment a record names exists
 * and, for attachments, is owned by that record; every attachment has an owner
 * among the archived records; and a record references each attachment once.
 */
function assertRelationships(
  records: ParsedVaultImport['records'],
  tags: PortableTag[],
  attachments: PortableAttachment[],
) {
  const tagIds = new Set(tags.map((tag) => tag.sourceId));
  const byId = new Map(attachments.map((attachment) => [attachment.id, attachment]));
  const referenced = new Set<string>();
  for (const category of ['notes', 'secrets', 'seals'] as const) {
    for (const record of records[category] as PortableTierRecord[]) {
      if (new Set(record.tagRefs).size !== record.tagRefs.length) throw new VaultImportArchiveError('INVALID_ARCHIVE');
      for (const tagId of record.tagRefs) if (!tagIds.has(tagId)) throw new VaultImportArchiveError('INVALID_ARCHIVE');
      for (const attachmentId of record.attachmentRefs) {
        const attachment = byId.get(attachmentId);
        if (
          !attachment ||
          referenced.has(attachmentId) ||
          attachment.owner.category !== category ||
          attachment.owner.recordId !== record.id
        )
          throw new VaultImportArchiveError('INVALID_ARCHIVE');
        referenced.add(attachmentId);
      }
    }
  }
  if (referenced.size !== attachments.length) throw new VaultImportArchiveError('INVALID_ARCHIVE');
}

export async function parseVaultImportArchive(
  source: VaultBackupChunkSource,
  password: string,
): Promise<ParsedVaultImport> {
  await sodium.ready;
  const checksums: VaultExportManifestEntry[] = [];
  const records: ParsedVaultImport['records'] = { notes: [], secrets: [], seals: [], authenticators: [] };
  let profile: PortableEncryptionProfile | null = null;
  let tags: PortableTag[] | null = null;
  let attachments: PortableAttachment[] | null = null;
  let manifestValue: unknown = null;
  let sawManifest = false;

  try {
    const decrypted = await decryptVaultBackupStream(source, password);
    const entries = readVaultBackupTarEntries(decrypted, {
      maxEntries: VAULT_IMPORT_LIMITS.maxEntries + 1,
      maxEntryBytes: VAULT_IMPORT_LIMITS.maxExpandedBytes,
      maxTotalBytes: VAULT_IMPORT_LIMITS.maxExpandedBytes,
    });
    for await (const entry of readableStreamValues(entries)) {
      if (sawManifest) throw new VaultImportArchiveError('INVALID_ARCHIVE');
      if (entry.path === 'manifest.json') {
        const body = await collectChunks(entry.body, 2 * 1024 * 1024);
        manifestValue = parseJson(body);
        sawManifest = true;
        continue;
      }
      if (entry.path.startsWith('attachments/') && entry.path !== 'attachments/index.ndjson') {
        checksums.push({ path: entry.path, bytes: entry.size, sha256: await hashOnly(entry.body, entry.size) });
        continue;
      }
      const { bytes, digest } = await readAndHash(entry.body, VAULT_IMPORT_LIMITS.maxMetadataBytes);
      if (bytes.byteLength !== entry.size) throw new VaultImportArchiveError('INVALID_ARCHIVE');
      checksums.push({ path: entry.path, bytes: bytes.byteLength, sha256: digest });
      if (entry.path === 'profile.json') {
        const parsed = portableProfileSchema.safeParse(parseJson(bytes));
        if (!parsed.success || profile) throw new VaultImportArchiveError('INVALID_ARCHIVE');
        profile = parsed.data;
      } else if (entry.path === 'data/tags.json') {
        const parsed = portableTagSchema.array().max(VAULT_IMPORT_LIMITS.maxTags).safeParse(parseJson(bytes));
        if (!parsed.success || tags) throw new VaultImportArchiveError('INVALID_ARCHIVE');
        tags = parsed.data;
      } else if (entry.path === 'attachments/index.ndjson') {
        const text = decoder.decode(bytes);
        const values = text ? (text.endsWith('\n') ? text.slice(0, -1).split('\n') : []) : [];
        if (text && !values.length) throw new VaultImportArchiveError('INVALID_ARCHIVE');
        const parsed = portableAttachmentSchema
          .array()
          .max(VAULT_IMPORT_LIMITS.maxAttachments)
          .safeParse(values.map((line) => JSON.parse(line)));
        if (!parsed.success || attachments) throw new VaultImportArchiveError('INVALID_ARCHIVE');
        attachments = parsed.data;
      } else {
        const category = categoryPaths.get(entry.path);
        if (!category) throw new VaultImportArchiveError('INVALID_ARCHIVE');
        records[category] = parseNdjson(bytes, category);
      }
    }
  } catch (error) {
    if (error instanceof VaultImportArchiveError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') throw new VaultImportArchiveError('CANCELLED');
    if (error instanceof Error && /password|authentication|damaged/i.test(error.message))
      throw new VaultImportArchiveError('WRONG_PASSWORD');
    throw new VaultImportArchiveError('INVALID_ARCHIVE');
  }

  const manifestResult = vaultImportManifestSchema.safeParse(manifestValue);
  if (!sawManifest || !manifestResult.success || !tags || !attachments)
    throw new VaultImportArchiveError('INVALID_ARCHIVE');
  const manifest = manifestResult.data;
  if (
    checksums.length !== manifest.entries.length ||
    checksums.some(
      (entry, index) =>
        entry.path !== manifest.entries[index].path ||
        entry.bytes !== manifest.entries[index].bytes ||
        entry.sha256 !== manifest.entries[index].sha256,
    )
  )
    throw new VaultImportArchiveError('INVALID_ARCHIVE');
  const calculatedDigest = sha256(
    encoder.encode(
      JSON.stringify(vaultExportManifestWithoutDigest(vaultExportManifestBase(manifest), manifest.entries)),
    ),
  );
  if (calculatedDigest !== manifest.digest) throw new VaultImportArchiveError('INVALID_ARCHIVE');
  for (const category of VAULT_EXPORT_CATEGORIES) {
    const included = manifest.selection.includes(category);
    if (
      (included ? records[category].length : 0) !== manifest.counts[category] ||
      (!included && records[category].length)
    )
      throw new VaultImportArchiveError('INVALID_ARCHIVE');
  }
  if (attachments.length !== manifest.counts.attachments || !uniqueIds(attachments))
    throw new VaultImportArchiveError('INVALID_ARCHIVE');
  if (
    new Set(tags.map((tag) => tag.sourceId)).size !== tags.length ||
    new Set(tags.map((tag) => tag.normalizedName)).size !== tags.length
  )
    throw new VaultImportArchiveError('INVALID_ARCHIVE');

  // The v1 entry set and order are normative: exactly these entries, in this
  // order, with manifest.json last. Anything else — an extra category file,
  // an attachment body with no index line — is refused here, before upload.
  const expectedPaths = [
    ...(profile ? ['profile.json'] : []),
    ...VAULT_EXPORT_CATEGORIES.filter((category) => manifest.selection.includes(category)).map(
      (category) => `data/${category}.ndjson`,
    ),
    'data/tags.json',
    'attachments/index.ndjson',
    ...attachments.map((attachment) => `attachments/${attachment.id}`),
  ];
  if (expectedPaths.length !== checksums.length || expectedPaths.some((path, index) => checksums[index].path !== path))
    throw new VaultImportArchiveError('INVALID_ARCHIVE');
  // The profile travels exactly when something encrypted does. A Notes-only
  // export still names its source vaultKeyId, as a diagnostic, without one.
  const encrypted = manifest.selection.some((category) => category !== 'notes');
  if (encrypted !== !!profile || (profile && profile.vaultKeyId !== manifest.source.vaultKeyId))
    throw new VaultImportArchiveError('INVALID_ARCHIVE');

  assertRelationships(records, tags, attachments);

  const entryByPath = new Map(checksums.map((entry, ordinal) => [entry.path, { ...entry, ordinal }]));
  const analyzedAttachments = attachments.map((attachment) => {
    const entry = entryByPath.get(`attachments/${attachment.id}`);
    if (!entry || entry.bytes !== attachment.size) throw new VaultImportArchiveError('INVALID_ARCHIVE');
    return { ...attachment, checksum: entry.sha256, ordinal: entry.ordinal };
  });

  return { analysis: { manifest, profile, tags, attachments: analyzedAttachments }, records };
}

export async function visitVaultImportAttachments(
  source: VaultBackupChunkSource,
  password: string,
  visitor: (attachmentId: string, body: Uint8Array) => Promise<void>,
) {
  const decrypted = await decryptVaultBackupStream(source, password);
  const entries = readVaultBackupTarEntries(decrypted, {
    maxEntries: VAULT_IMPORT_LIMITS.maxEntries + 1,
    maxEntryBytes: VAULT_IMPORT_LIMITS.maxExpandedBytes,
    maxTotalBytes: VAULT_IMPORT_LIMITS.maxExpandedBytes,
  });
  for await (const entry of readableStreamValues(entries)) {
    if (entry.path.startsWith('attachments/') && entry.path !== 'attachments/index.ndjson') {
      const id = entry.path.slice('attachments/'.length);
      await visitor(id, await collectChunks(entry.body, MAX_USER_STORAGE_PER_OBJECT));
    } else {
      // Drain, don't cancel: modern-tar's decoder stalls on a cancelled entry
      // body once its input arrives in more than one chunk, and the next entry
      // never comes — the import hung at 99%, before the first attachment.
      for await (const _chunk of readableStreamValues(entry.body)) void _chunk;
    }
  }
}

const MAX_USER_STORAGE_PER_OBJECT = 5 * 1024 * 1024 + 16;
