/* eslint-disable @typescript-eslint/no-explicit-any */
import { AsyncLocalStorage } from 'node:async_hooks';
import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { getDb, type Db } from '@/db/client';
import { withAccountLock, withVaultRead } from '@/db/encryptionState';
import {
  encryptionProfiles,
  fileAttachments,
  noteTags,
  noteVersions,
  notes,
  otpRecords,
  sealNoteTags,
  sealNoteVersions,
  sealNotes,
  secretNoteTags,
  secretNoteVersions,
  secretNotes,
  tags,
  vaultExportItems,
  vaultExports,
  type VaultExportCategory,
  type VaultExportCounts,
  type VaultExportItemKind,
  type VaultExportSelection,
} from '@/db/schema';
import {
  VAULT_EXPORT_CATEGORIES,
  VAULT_EXPORT_FORMAT_VERSION,
  VAULT_EXPORT_MIN_READER_VERSION,
  type VaultExportBeginResult,
  type VaultExportAvailability,
  type VaultExportEntryPlan,
  type VaultExportSummary,
} from '@/lib/vaultBackup/exportTypes';
import { VAULT_IMPORT_LIMITS } from '@/lib/vaultBackup/importSchemas';
import { readableStreamFromChunks } from '@/lib/vaultBackup/stream';
import { streamFromS3 } from '@/lib/s3';
import { digest } from '@/server/rotation/contracts';
import { normalizeTagName } from '@/controllers/tags';

const EXPORT_LIFETIME_MS = 30 * 60 * 1000;
const MAX_EXPORT_ITEMS = 100_000;
const PAGE_SIZE = 25;
// Ids per `IN (…)` list; see captureTier.
const CAPTURE_CHUNK = 1_000;
const encoder = new TextEncoder();

type TierKind = 'note' | 'secret' | 'seal';
type ExportItem = {
  kind: VaultExportItemKind;
  resourceId: string;
  sourceDigest: string;
  bytes: number;
  ordinal: number;
};
type PortableAttachment = {
  id: string;
  owner: { category: 'notes' | 'secrets' | 'seals'; recordId: string };
  filename: string;
  size: number;
  mimeType: string;
  encrypted: boolean;
  encryptionIv: string | null;
  keyScope: 'vault' | 'seal';
  keyNoteId: string | null;
  createdAt: Date;
};
type CapturedAttachment = { portable: PortableAttachment; internal: PortableAttachment & { s3Key: string } };
type PortableTierRecord = Record<string, unknown> & { id: string; tagRefs: string[]; attachmentRefs: string[] };

const tierConfig = {
  note: { table: notes, versions: noteVersions, joins: noteTags, category: 'notes', body: 'content' },
  secret: {
    table: secretNotes,
    versions: secretNoteVersions,
    joins: secretNoteTags,
    category: 'secrets',
    body: 'encryptedBody',
  },
  seal: { table: sealNotes, versions: sealNoteVersions, joins: sealNoteTags, category: 'seals', body: 'encryptedBody' },
} as const;

export class VaultExportError extends Error {
  constructor(
    readonly code:
      | 'DISABLED'
      | 'NOT_FOUND'
      | 'INVALID_SELECTION'
      | 'PROFILE_REQUIRED'
      | 'VAULT_ID_REQUIRED'
      | 'ROTATION_IN_PROGRESS'
      | 'VAULT_CHANGED'
      | 'EXPIRED'
      | 'LIMIT',
  ) {
    super(code);
    this.name = 'VaultExportError';
  }
}

const json = (value: unknown) => JSON.stringify(value);
const bytes = (value: string) => encoder.encode(value);
const line = (value: unknown) => bytes(`${json(value)}\n`);
const sumBytes = (values: Uint8Array[]) => values.reduce((total, value) => total + value.byteLength, 0);

function portableAttachment(row: typeof fileAttachments.$inferSelect): CapturedAttachment {
  if (!row.noteId || !row.noteTier) throw new VaultExportError('VAULT_CHANGED');
  const category = row.noteTier === 'note' ? 'notes' : row.noteTier === 'secret' ? 'secrets' : 'seals';
  const portable: PortableAttachment = {
    id: row.id,
    owner: { category, recordId: row.noteId },
    filename: row.filename,
    size: row.size,
    mimeType: row.mimeType,
    encrypted: row.encrypted,
    encryptionIv: row.encryptionIv,
    keyScope: row.keyScope,
    keyNoteId: row.keyNoteId,
    createdAt: row.createdAt,
  };
  return { portable, internal: { ...portable, s3Key: row.s3Key } };
}

export async function captureTier(db: Db, userId: string, kind: TierKind, ids?: string[]) {
  const cfg = tierConfig[kind];
  if (ids?.length === 0) return { records: [] as PortableTierRecord[], attachments: [] as CapturedAttachment[] };
  const idFilter = ids ? inArray(cfg.table.id, ids) : undefined;
  const heads = (await (db as any)
    .select()
    .from(cfg.table)
    .where(and(eq(cfg.table.userId, userId), idFilter))
    .orderBy(asc(cfg.table.id))) as Record<string, any>[];
  const headIds = heads.map((row) => row.id as string);
  if (!headIds.length) return { records: [] as PortableTierRecord[], attachments: [] as CapturedAttachment[] };

  // Chunked: a large vault holds more record ids than Postgres accepts bind
  // parameters in one statement. Heads are sorted by id, so concatenated
  // chunks keep history in (note, seq) order.
  const history: Record<string, any>[] = [];
  const joins: { noteId: string; tagId: string }[] = [];
  const fileRows: Array<typeof fileAttachments.$inferSelect> = [];
  for (let offset = 0; offset < headIds.length; offset += CAPTURE_CHUNK) {
    const chunk = headIds.slice(offset, offset + CAPTURE_CHUNK);
    history.push(
      ...((await (db as any)
        .select()
        .from(cfg.versions)
        .where(and(eq(cfg.versions.userId, userId), inArray(cfg.versions.noteId, chunk)))
        .orderBy(asc(cfg.versions.noteId), asc(cfg.versions.seq))) as Record<string, any>[]),
    );
    joins.push(
      ...((await (db as any)
        .select()
        .from(cfg.joins)
        .where(and(eq(cfg.joins.userId, userId), inArray(cfg.joins.noteId, chunk)))
        .orderBy(asc(cfg.joins.noteId), asc(cfg.joins.sortOrder))) as { noteId: string; tagId: string }[]),
    );
    fileRows.push(
      ...(await db
        .select()
        .from(fileAttachments)
        .where(
          and(
            eq(fileAttachments.userId, userId),
            eq(fileAttachments.noteTier, kind),
            inArray(fileAttachments.noteId, chunk),
            isNull(fileAttachments.deletedAt),
            isNull(fileAttachments.storageDeletedAt),
          ),
        )),
    );
  }
  fileRows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const historyById = new Map<string, Record<string, any>[]>();
  for (const version of history) {
    const list = historyById.get(version.noteId) ?? [];
    list.push(version);
    historyById.set(version.noteId, list);
  }
  const tagsById = new Map<string, string[]>();
  for (const relation of joins) {
    const list = tagsById.get(relation.noteId) ?? [];
    list.push(relation.tagId);
    tagsById.set(relation.noteId, list);
  }
  const attachments = fileRows.map(portableAttachment);
  const attachmentsById = new Map<string, CapturedAttachment[]>();
  for (const attachment of attachments) {
    const list = attachmentsById.get(attachment.portable.owner.recordId) ?? [];
    list.push(attachment);
    attachmentsById.set(attachment.portable.owner.recordId, list);
  }

  const records = heads.map((row): PortableTierRecord => {
    const versions = (historyById.get(row.id) ?? []).map((version) => ({
      title: version.title,
      ...(kind === 'note' ? { content: version.content } : { encryptedBody: version.encryptedBody }),
      createdAt: version.createdAt,
    }));
    const common = {
      id: row.id,
      title: row.title,
      ...(kind === 'note' ? { content: row.content } : { encryptedBody: row.encryptedBody }),
      ...(kind === 'seal' ? { wrappedNoteKey: row.wrappedNoteKey } : {}),
      position: row.position,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
      archived: row.archived,
      color: row.color,
      pattern: row.pattern,
      pinned: row.pinned,
      expiresAt: row.expiresAt,
      burnAfterReading: row.burnAfterReading,
      history: versions,
      tagRefs: tagsById.get(row.id) ?? [],
      attachmentRefs: (attachmentsById.get(row.id) ?? []).map((attachment) => attachment.portable.id),
    };
    return common;
  });
  return { records, attachments };
}

export async function captureAuthenticators(db: Db, userId: string, ids?: string[]) {
  if (ids?.length === 0) return [];
  const rows = await db
    .select()
    .from(otpRecords)
    .where(and(eq(otpRecords.userId, userId), ids ? inArray(otpRecords.id, ids) : undefined))
    .orderBy(asc(otpRecords.id));
  return rows.map((row) => ({
    id: row.id,
    payload: row.payload,
    payloadVersion: row.payloadVersion,
    position: row.position,
    revision: row.revision,
    archived: row.archived,
    color: row.color,
    pattern: row.pattern,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  }));
}

export async function captureTags(db: Db, userId: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = await db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(and(eq(tags.userId, userId), inArray(tags.id, ids)))
    .orderBy(asc(tags.id));
  return rows.map((row) => ({ sourceId: row.id, normalizedName: normalizeTagName(row.name) }));
}

function profileDocument(profile: typeof encryptionProfiles.$inferSelect) {
  return {
    type: 'signote-encryption-profile',
    formatVersion: 1,
    version: profile.version,
    serverShare: profile.serverShare,
    salt: profile.salt,
    kdf: profile.kdf,
    keyCheck: profile.keyCheck,
    vaultKeyId: profile.vaultKeyId,
  };
}

const kindForCategory = (category: VaultExportCategory): VaultExportItemKind =>
  category === 'authenticators' ? 'authenticator' : (category.slice(0, -1) as VaultExportItemKind);

function categoryPath(category: VaultExportCategory): string {
  return `data/${category}.ndjson`;
}

function estimatedEncryptedBytes(plainBytes: number): number {
  const tarHeaders = 512 * 12;
  const framed = plainBytes + tarHeaders;
  return 68 + framed + Math.ceil(framed / (1024 * 1024)) * 17;
}

async function cleanupExpired(db: Db, now: Date) {
  await db.delete(vaultExports).where(lt(vaultExports.expiresAt, now));
}

// Rough JSON overhead per record and per history version on top of the
// measured text: keys, timestamps, flags, refs. The summary is an estimate.
const RECORD_OVERHEAD = 400;
const VERSION_OVERHEAD = 80;

/**
 * Counts and estimated sizes, from aggregates. Rendering every record (as
 * `beginVaultExport` must) would read the whole vault, history included, on
 * every visit to the export page just to print a few numbers.
 */
async function summarizeTier(db: Db, userId: string, kind: TierKind) {
  const { table, versions } = tierConfig[kind];
  const t = table as any;
  const v = versions as any;
  const body = (columns: any) =>
    kind === 'note'
      ? sql`octet_length(${columns.content})`
      : sql`coalesce(octet_length(${columns.encryptedBody}::text), 0)`;
  const sealKey = kind === 'seal' ? sql` + coalesce(octet_length(${t.wrappedNoteKey}::text), 0)` : sql``;
  const [heads] = await db
    .select({
      count: sql<number>`count(*)::int`,
      bytes: sql<number>`coalesce(sum(octet_length(${t.title}) + ${body(t)}${sealKey}), 0)::bigint`,
    })
    .from(t)
    .where(eq(t.userId, userId));
  const [history] = await db
    .select({
      count: sql<number>`count(*)::int`,
      bytes: sql<number>`coalesce(sum(octet_length(${v.title}) + ${body(v)}), 0)::bigint`,
    })
    .from(v)
    .where(eq(v.userId, userId));
  const [files] = await db
    .select({
      count: sql<number>`count(*)::int`,
      bytes: sql<number>`coalesce(sum(${fileAttachments.size}), 0)::bigint`,
    })
    .from(fileAttachments)
    .where(
      and(
        eq(fileAttachments.userId, userId),
        eq(fileAttachments.noteTier, kind),
        isNull(fileAttachments.deletedAt),
        isNull(fileAttachments.storageDeletedAt),
      ),
    );
  return {
    count: heads.count,
    attachmentCount: files.count,
    estimatedBytes:
      Number(heads.bytes) +
      heads.count * RECORD_OVERHEAD +
      Number(history.bytes) +
      history.count * VERSION_OVERHEAD +
      Number(files.bytes),
  };
}

async function summarizeAuthenticators(db: Db, userId: string) {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      bytes: sql<number>`coalesce(sum(coalesce(octet_length(${otpRecords.payload}::text), 0)), 0)::bigint`,
    })
    .from(otpRecords)
    .where(eq(otpRecords.userId, userId));
  return { count: row.count, attachmentCount: 0, estimatedBytes: Number(row.bytes) + row.count * RECORD_OVERHEAD };
}

export async function getVaultExportSummary(userId: string, available: boolean): Promise<VaultExportSummary> {
  return withVaultRead(userId, async (state) => {
    const db = getDb();
    const [profile] = await db.select().from(encryptionProfiles).where(eq(encryptionProfiles.userId, userId)).limit(1);
    const [notesSummary, secretsSummary, sealsSummary, authenticatorsSummary] = await Promise.all([
      summarizeTier(db, userId, 'note'),
      summarizeTier(db, userId, 'secret'),
      summarizeTier(db, userId, 'seal'),
      summarizeAuthenticators(db, userId),
    ]);
    return {
      available,
      profileExists: !!profile,
      vaultKeyId: profile?.vaultKeyId ?? null,
      rotationInProgress: state.activeRotationId !== null,
      categories: {
        notes: notesSummary,
        secrets: secretsSummary,
        seals: sealsSummary,
        authenticators: authenticatorsSummary,
      },
    };
  });
}

export async function getVaultExportAvailability(userId: string, available: boolean): Promise<VaultExportAvailability> {
  return withVaultRead(userId, async (state) => {
    const [profile] = await getDb()
      .select({ vaultKeyId: encryptionProfiles.vaultKeyId })
      .from(encryptionProfiles)
      .where(eq(encryptionProfiles.userId, userId))
      .limit(1);
    return {
      available,
      profileExists: !!profile,
      vaultKeyId: profile?.vaultKeyId ?? null,
      rotationInProgress: state.activeRotationId !== null,
    };
  });
}

export async function beginVaultExport(
  userId: string,
  selection: VaultExportSelection,
): Promise<VaultExportBeginResult> {
  if (!VAULT_EXPORT_CATEGORIES.some((category) => selection[category])) throw new VaultExportError('INVALID_SELECTION');
  return withVaultRead(userId, async (state) => {
    const db = getDb();
    const now = new Date();
    await cleanupExpired(db, now);
    const encrypted = selection.secrets || selection.seals || selection.authenticators;
    if (encrypted && state.activeRotationId) throw new VaultExportError('ROTATION_IN_PROGRESS');
    const [profile] = await db.select().from(encryptionProfiles).where(eq(encryptionProfiles.userId, userId)).limit(1);
    if (encrypted && !profile) throw new VaultExportError('PROFILE_REQUIRED');
    if (encrypted && !profile?.vaultKeyId) throw new VaultExportError('VAULT_ID_REQUIRED');

    const operationId = uuidv7();
    const itemRows: ExportItem[] = [];
    const counts: VaultExportCounts = { notes: 0, secrets: 0, seals: 0, authenticators: 0, attachments: 0 };
    const categoryBytes: Record<VaultExportCategory, number> = {
      notes: 0,
      secrets: 0,
      seals: 0,
      authenticators: 0,
    };
    const entrySizes: Record<string, number> = {};
    const tagIds = new Set<string>();
    const allAttachments = new Map<string, CapturedAttachment>();
    let ordinal = 0;

    for (const kind of ['note', 'secret', 'seal'] as const) {
      const category = tierConfig[kind].category;
      if (!selection[category]) continue;
      const captured = await captureTier(db, userId, kind);
      counts[category] = captured.records.length;
      const rendered = captured.records.map(line);
      entrySizes[categoryPath(category)] = sumBytes(rendered);
      categoryBytes[category] =
        entrySizes[categoryPath(category)] +
        captured.attachments.reduce((total, attachment) => total + attachment.portable.size, 0);
      for (let index = 0; index < captured.records.length; index++) {
        const record = captured.records[index];
        const related = captured.attachments.filter((value) => value.portable.owner.recordId === record.id);
        itemRows.push({
          kind,
          resourceId: record.id,
          sourceDigest: digest({ record, attachments: related.map((value) => value.portable) }),
          bytes: rendered[index].byteLength,
          ordinal: ordinal++,
        });
        record.tagRefs.forEach((id) => tagIds.add(id));
      }
      captured.attachments.forEach((attachment) => allAttachments.set(attachment.portable.id, attachment));
    }

    if (selection.authenticators) {
      const records = await captureAuthenticators(db, userId);
      counts.authenticators = records.length;
      const rendered = records.map(line);
      entrySizes[categoryPath('authenticators')] = sumBytes(rendered);
      categoryBytes.authenticators = entrySizes[categoryPath('authenticators')];
      records.forEach((record, index) =>
        itemRows.push({
          kind: 'authenticator',
          resourceId: record.id,
          sourceDigest: digest(record),
          bytes: rendered[index].byteLength,
          ordinal: ordinal++,
        }),
      );
    }

    const tagRecords = await captureTags(db, userId, [...tagIds]);
    const tagBody = bytes(json(tagRecords));
    entrySizes['data/tags.json'] = tagBody.byteLength;
    tagRecords.forEach((tag) =>
      itemRows.push({
        kind: 'tag',
        resourceId: tag.sourceId,
        sourceDigest: digest(tag),
        bytes: bytes(json(tag)).byteLength,
        ordinal: ordinal++,
      }),
    );

    const attachmentRecords = [...allAttachments.values()].sort((a, b) => a.portable.id.localeCompare(b.portable.id));
    counts.attachments = attachmentRecords.length;
    entrySizes['attachments/index.ndjson'] = sumBytes(attachmentRecords.map((value) => line(value.portable)));
    for (const attachment of attachmentRecords) {
      itemRows.push({
        kind: 'attachment',
        resourceId: attachment.portable.id,
        sourceDigest: digest(attachment.internal),
        bytes: attachment.portable.size,
        ordinal: ordinal++,
      });
      entrySizes[`attachments/${attachment.portable.id}`] = attachment.portable.size;
    }
    // An archive the importer would refuse is not a backup.
    if (itemRows.length > MAX_EXPORT_ITEMS || attachmentRecords.length > VAULT_IMPORT_LIMITS.maxAttachments)
      throw new VaultExportError('LIMIT');

    if (encrypted && profile) entrySizes['profile.json'] = bytes(json(profileDocument(profile))).byteLength;
    const expiresAt = new Date(now.getTime() + EXPORT_LIFETIME_MS);
    await db.insert(vaultExports).values({
      id: operationId,
      userId,
      generation: state.generation,
      profileId: profile?.id ?? null,
      profileDigest: profile ? digest(profileDocument(profile)) : null,
      vaultKeyId: profile?.vaultKeyId ?? null,
      selection,
      counts,
      entrySizes,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      expiresAt,
    });
    for (let offset = 0; offset < itemRows.length; offset += 1_000) {
      await db
        .insert(vaultExportItems)
        .values(itemRows.slice(offset, offset + 1_000).map((item) => ({ exportId: operationId, ...item })));
    }

    const entries: VaultExportEntryPlan[] = [];
    if (entrySizes['profile.json'] !== undefined)
      entries.push({
        path: 'profile.json',
        size: entrySizes['profile.json'],
        url: `/api/vault-export/${operationId}/profile`,
        category: 'profile',
        itemCount: 1,
      });
    for (const category of VAULT_EXPORT_CATEGORIES) {
      if (!selection[category]) continue;
      const path = categoryPath(category);
      entries.push({
        path,
        size: entrySizes[path],
        url: `/api/vault-export/${operationId}/${category}`,
        category,
        itemCount: counts[category],
      });
    }
    entries.push({
      path: 'data/tags.json',
      size: entrySizes['data/tags.json'],
      url: `/api/vault-export/${operationId}/tags`,
      category: 'tags',
      itemCount: tagRecords.length,
    });
    entries.push({
      path: 'attachments/index.ndjson',
      size: entrySizes['attachments/index.ndjson'],
      url: `/api/vault-export/${operationId}/attachment-index`,
      category: 'attachments',
      itemCount: attachmentRecords.length,
    });
    for (const attachment of attachmentRecords) {
      const path = `attachments/${attachment.portable.id}`;
      entries.push({
        path,
        size: attachment.portable.size,
        url: `/api/vault-export/${operationId}/attachment/${attachment.portable.id}`,
        category: 'attachments',
        itemCount: 1,
      });
    }
    const plainBytes = Object.values(entrySizes).reduce((total, value) => total + value, 0);
    return {
      operationId,
      generation: state.generation,
      filename: `signote-vault-${now.toISOString().slice(0, 10)}.snvault`,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      entries,
      manifest: {
        type: 'signote-vault-export',
        formatVersion: VAULT_EXPORT_FORMAT_VERSION,
        minimumReaderVersion: VAULT_EXPORT_MIN_READER_VERSION,
        exportId: operationId,
        createdAt: now.toISOString(),
        source: {
          schemaVersion: 1,
          profileId: profile?.id ?? null,
          encryptionGeneration: state.generation,
          vaultKeyId: profile?.vaultKeyId ?? null,
        },
        selection: VAULT_EXPORT_CATEGORIES.filter((category) => selection[category]),
        counts,
        categoryBytes,
        includesRetainedDeletedRecords: true,
      },
      estimatedArchiveBytes: estimatedEncryptedBytes(plainBytes),
    };
  });
}

async function ownedActive(db: Db, userId: string, operationId: string, now = new Date()) {
  const [operation] = await db
    .select()
    .from(vaultExports)
    .where(and(eq(vaultExports.id, operationId), eq(vaultExports.userId, userId)))
    .limit(1);
  if (!operation) throw new VaultExportError('NOT_FOUND');
  if (operation.expiresAt <= now) throw new VaultExportError('EXPIRED');
  if (operation.status !== 'active') throw new VaultExportError('NOT_FOUND');
  return operation;
}

async function verifyOperation(userId: string, operationId: string) {
  return withVaultRead(userId, async (state) => {
    const operation = await ownedActive(getDb(), userId, operationId);
    if (
      state.activeRotationId &&
      (operation.selection.secrets || operation.selection.seals || operation.selection.authenticators)
    )
      throw new VaultExportError('ROTATION_IN_PROGRESS');
    if (operation.generation !== state.generation) throw new VaultExportError('VAULT_CHANGED');
    return operation;
  });
}

async function itemPage(userId: string, operationId: string, kind: VaultExportItemKind, offset: number) {
  return withVaultRead(userId, async (state) => {
    const db = getDb();
    const operation = await ownedActive(db, userId, operationId);
    if (
      state.activeRotationId &&
      (operation.selection.secrets || operation.selection.seals || operation.selection.authenticators)
    )
      throw new VaultExportError('ROTATION_IN_PROGRESS');
    if (operation.generation !== state.generation) throw new VaultExportError('VAULT_CHANGED');
    return db
      .select()
      .from(vaultExportItems)
      .where(and(eq(vaultExportItems.exportId, operationId), eq(vaultExportItems.kind, kind)))
      .orderBy(asc(vaultExportItems.ordinal))
      .limit(PAGE_SIZE)
      .offset(offset);
  });
}

async function renderRecordPage(userId: string, operationId: string, category: VaultExportCategory, offset: number) {
  const kind = kindForCategory(category);
  const page = await itemPage(userId, operationId, kind, offset);
  if (!page.length) return [];
  return withVaultRead(userId, async () => {
    const db = getDb();
    const ids = page.map((item) => item.resourceId);
    if (category === 'authenticators') {
      const records = await captureAuthenticators(db, userId, ids);
      const byId = new Map(records.map((record) => [record.id, record]));
      return page.map((item) => {
        const record = byId.get(item.resourceId);
        if (!record || digest(record) !== item.sourceDigest) throw new VaultExportError('VAULT_CHANGED');
        const rendered = line(record);
        if (rendered.byteLength !== item.bytes) throw new VaultExportError('VAULT_CHANGED');
        return rendered;
      });
    }
    const tierKind = kind as TierKind;
    const captured = await captureTier(db, userId, tierKind, ids);
    const byId = new Map(captured.records.map((record) => [record.id, record]));
    return page.map((item) => {
      const record = byId.get(item.resourceId);
      if (!record) throw new VaultExportError('VAULT_CHANGED');
      const related = captured.attachments.filter((value) => value.portable.owner.recordId === record.id);
      if (digest({ record, attachments: related.map((value) => value.portable) }) !== item.sourceDigest)
        throw new VaultExportError('VAULT_CHANGED');
      const rendered = line(record);
      if (rendered.byteLength !== item.bytes) throw new VaultExportError('VAULT_CHANGED');
      return rendered;
    });
  });
}

async function* recordEntry(userId: string, operationId: string, category: VaultExportCategory) {
  let offset = 0;
  for (;;) {
    const chunks = await renderRecordPage(userId, operationId, category, offset);
    if (!chunks.length) return;
    yield* chunks;
    offset += chunks.length;
  }
}

/**
 * The response body is pulled after the route handler has returned, outside
 * the request's AsyncLocalStorage context. Without re-entering it every later
 * page's `withVaultRead` sees no request generation, and a rotated vault
 * (generation > 0) fails with GENERATION_MISMATCH mid-body. The snapshot is
 * taken here, synchronously, not inside the generator, whose body only runs
 * once the stream first pulls.
 */
function inRequestContext<T>(source: AsyncGenerator<T>): AsyncGenerator<T> {
  const run = AsyncLocalStorage.snapshot();
  return (async function* () {
    let completed = false;
    try {
      for (;;) {
        const result = await run(() => source.next());
        if (result.done) {
          completed = true;
          return;
        }
        yield result.value;
      }
    } finally {
      if (!completed) await run(() => source.return(undefined));
    }
  })();
}

async function renderTags(userId: string, operationId: string) {
  const rendered: { sourceId: string; normalizedName: string }[] = [];
  let offset = 0;
  for (;;) {
    const items = await itemPage(userId, operationId, 'tag', offset);
    if (!items.length) return bytes(json(rendered));
    const records = await withVaultRead(userId, async () =>
      captureTags(
        getDb(),
        userId,
        items.map((item) => item.resourceId),
      ),
    );
    const byId = new Map(records.map((record) => [record.sourceId, record]));
    for (const item of items) {
      const record = byId.get(item.resourceId);
      if (!record || digest(record) !== item.sourceDigest) throw new VaultExportError('VAULT_CHANGED');
      rendered.push(record);
    }
    offset += items.length;
  }
}

async function renderAttachmentIndex(userId: string, operationId: string) {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  for (;;) {
    const page = await itemPage(userId, operationId, 'attachment', offset);
    if (!page.length) return chunks;
    const captured = await withVaultRead(userId, async () => {
      const rows = await getDb()
        .select()
        .from(fileAttachments)
        .where(
          and(
            eq(fileAttachments.userId, userId),
            inArray(
              fileAttachments.id,
              page.map((item) => item.resourceId),
            ),
          ),
        );
      return rows.map(portableAttachment);
    });
    const byId = new Map(captured.map((value) => [value.portable.id, value]));
    for (const item of page) {
      const attachment = byId.get(item.resourceId);
      if (!attachment || digest(attachment.internal) !== item.sourceDigest) throw new VaultExportError('VAULT_CHANGED');
      chunks.push(line(attachment.portable));
    }
    offset += page.length;
  }
}

export async function getVaultExportEntry(userId: string, operationId: string, entry: string) {
  const operation = await verifyOperation(userId, operationId);
  const sizeByEntry = operation.entrySizes;
  if (entry === 'profile') {
    if (sizeByEntry['profile.json'] === undefined || !operation.profileId || !operation.profileDigest)
      throw new VaultExportError('NOT_FOUND');
    const body = await withVaultRead(userId, async () => {
      const [profile] = await getDb()
        .select()
        .from(encryptionProfiles)
        .where(eq(encryptionProfiles.id, operation.profileId!));
      if (!profile) throw new VaultExportError('VAULT_CHANGED');
      const document = profileDocument(profile);
      if (digest(document) !== operation.profileDigest) throw new VaultExportError('VAULT_CHANGED');
      return bytes(json(document));
    });
    return {
      size: body.byteLength,
      stream: readableStreamFromChunks(
        (async function* () {
          yield body;
        })(),
      ),
    };
  }
  if (entry === 'tags') {
    const body = await renderTags(userId, operationId);
    if (body.byteLength !== sizeByEntry['data/tags.json']) throw new VaultExportError('VAULT_CHANGED');
    return {
      size: body.byteLength,
      stream: readableStreamFromChunks(
        (async function* () {
          yield body;
        })(),
      ),
    };
  }
  if (entry === 'attachment-index') {
    const chunks = await renderAttachmentIndex(userId, operationId);
    const size = sumBytes(chunks);
    if (size !== sizeByEntry['attachments/index.ndjson']) throw new VaultExportError('VAULT_CHANGED');
    return {
      size,
      stream: readableStreamFromChunks(
        (async function* () {
          yield* chunks;
        })(),
      ),
    };
  }
  if (VAULT_EXPORT_CATEGORIES.includes(entry as VaultExportCategory)) {
    const category = entry as VaultExportCategory;
    if (!operation.selection[category]) throw new VaultExportError('NOT_FOUND');
    // Render the first page before answering. A change caught there is then a
    // 409 the reader can explain, not a connection dropped before any headers.
    const records = inRequestContext(recordEntry(userId, operationId, category));
    const first = await records.next();
    return {
      size: sizeByEntry[categoryPath(category)],
      stream: readableStreamFromChunks(
        (async function* () {
          if (first.done) return;
          yield first.value;
          yield* records;
        })(),
      ),
    };
  }
  throw new VaultExportError('NOT_FOUND');
}

export async function getVaultExportAttachment(userId: string, operationId: string, attachmentId: string) {
  await verifyOperation(userId, operationId);
  const source = await withVaultRead(userId, async () => {
    const db = getDb();
    const [item] = await db
      .select()
      .from(vaultExportItems)
      .where(
        and(
          eq(vaultExportItems.exportId, operationId),
          eq(vaultExportItems.kind, 'attachment'),
          eq(vaultExportItems.resourceId, attachmentId),
        ),
      )
      .limit(1);
    const [row] = await db
      .select()
      .from(fileAttachments)
      .where(and(eq(fileAttachments.userId, userId), eq(fileAttachments.id, attachmentId)))
      .limit(1);
    if (!item || !row) throw new VaultExportError('NOT_FOUND');
    const captured = portableAttachment(row);
    if (digest(captured.internal) !== item.sourceDigest || row.size !== item.bytes)
      throw new VaultExportError('VAULT_CHANGED');
    return { size: row.size, key: row.s3Key };
  });
  // Never hold the account transaction while waiting on an object-store body.
  // The immutable key and expected length were fenced immediately above.
  const object = await streamFromS3(source.key);
  if (object.contentLength !== undefined && object.contentLength !== source.size)
    throw new VaultExportError('VAULT_CHANGED');
  return { size: source.size, body: object.body };
}

export async function finishVaultExport(userId: string, operationId: string, manifestDigest: string) {
  return withAccountLock(userId, async (db) => {
    await ownedActive(db, userId, operationId);
    // Each entry was revalidated immediately before the Worker consumed it.
    // A later vault change cannot make that already-complete archive mixed;
    // completion only records its authenticated manifest for audit/cleanup.
    const now = new Date();
    await db
      .update(vaultExports)
      .set({ status: 'completed', manifestDigest, completedAt: now, updatedAt: now })
      .where(eq(vaultExports.id, operationId));
    return { completedAt: now.toISOString() };
  });
}

export async function cancelVaultExport(userId: string, operationId: string) {
  return withAccountLock(userId, async (db) => {
    const [operation] = await db
      .select({ id: vaultExports.id, status: vaultExports.status })
      .from(vaultExports)
      .where(and(eq(vaultExports.id, operationId), eq(vaultExports.userId, userId)))
      .limit(1);
    if (!operation) return { cancelled: false };
    if (operation.status === 'active')
      await db
        .update(vaultExports)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(vaultExports.id, operationId));
    return { cancelled: true };
  });
}

export async function cleanupVaultExports(): Promise<number> {
  const rows = await getDb()
    .delete(vaultExports)
    .where(lt(vaultExports.expiresAt, new Date()))
    .returning({ id: vaultExports.id });
  return rows.length;
}
