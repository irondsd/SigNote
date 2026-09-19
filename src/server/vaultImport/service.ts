/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, asc, eq, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';

import { autoTagColor } from '@/config/noteStyles';
import { MAX_USER_STORAGE } from '@/config/fileConstants';
import { normalizeTagName } from '@/controllers/tags';
import { getDb, type Db } from '@/db/client';
import { withAccountLock } from '@/db/encryptionState';
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
  vaultImportItems,
  vaultImports,
  type VaultImportAction,
  type VaultImportCounts,
} from '@/db/schema';
import { attachmentAggregate, authenticatorAggregate, canonicalJson, tierAggregate } from '@/lib/vaultBackup/aggregate';
import {
  VAULT_IMPORT_LIMITS,
  portableAttachmentSchema,
  portableTagSchema,
  vaultImportAnalysisSchema,
  vaultImportLookupSchema,
  vaultImportPlanSchema,
  vaultImportRecordSchemas,
  vaultImportStagedRecordSchemas,
} from '@/lib/vaultBackup/importSchemas';
import type {
  PortableAttachment,
  PortableAuthenticator,
  PortableEncryptionProfile,
  PortableTag,
  PortableTierRecord,
  VaultImportAnalysis,
  VaultImportLookupAttachment,
  VaultImportLookupRecord,
  VaultImportReview,
} from '@/lib/vaultBackup/importTypes';
import { vaultExportManifestBase, vaultExportManifestWithoutDigest } from '@/lib/vaultBackup/manifest';
import { digest, jsonBytes } from '@/server/rotation/contracts';
import { captureAuthenticators, captureTags, captureTier } from '@/server/vaultExport/service';
import type { VaultImportObjectStore } from './objectStore';

type TierCategory = 'notes' | 'secrets' | 'seals';
type RecordCategory = TierCategory | 'authenticators';
type TierKind = 'note' | 'secret' | 'seal';
type ImportItem = typeof vaultImportItems.$inferSelect;
type ImportOperation = typeof vaultImports.$inferSelect;
type PortableAttachmentRow = Omit<PortableAttachment, 'createdAt'> & { createdAt: Date };

const zeroCounts = (): VaultImportCounts => ({ notes: 0, secrets: 0, seals: 0, authenticators: 0, attachments: 0 });
const categoryKind = { notes: 'note', secrets: 'secret', seals: 'seal', authenticators: 'authenticator' } as const;
const kindCategory = { note: 'notes', secret: 'secrets', seal: 'seals', authenticator: 'authenticators' } as const;
const tierKind = { notes: 'note', secrets: 'secret', seals: 'seal' } as const satisfies Record<TierCategory, TierKind>;
const tierTables = {
  notes: { table: notes, versions: noteVersions, joins: noteTags },
  secrets: { table: secretNotes, versions: secretNoteVersions, joins: secretNoteTags },
  seals: { table: sealNotes, versions: sealNoteVersions, joins: sealNoteTags },
} as const;

export class VaultImportError extends Error {
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'EXPIRED'
      | 'INVALID_ARCHIVE'
      | 'UNSUPPORTED_ARCHIVE'
      | 'VAULT_KEY_MISMATCH'
      | 'VAULT_ID_REQUIRED'
      | 'CONFLICT'
      | 'IMPORT_IN_PROGRESS'
      | 'DESTINATION_CHANGED'
      | 'INCOMPLETE'
      | 'LIMIT'
      | 'STORAGE_MISMATCH',
  ) {
    super(code);
    this.name = 'VaultImportError';
  }
}

type Actor = { userId: string; sid: string };

/** Server half of the merge comparison; the Worker digests the archived side
 * with the same canonical JSON (lib/vaultBackup/aggregate.ts). */
const aggregateDigest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');

function assertArchiveStructure(input: VaultImportAnalysis) {
  const { manifest, profile, tags: archiveTags, attachments } = input;
  if (
    createHash('sha256')
      .update(JSON.stringify(vaultExportManifestWithoutDigest(vaultExportManifestBase(manifest), manifest.entries)))
      .digest('hex') !== manifest.digest
  )
    throw new VaultImportError('INVALID_ARCHIVE');
  if (new Set(manifest.selection).size !== manifest.selection.length) throw new VaultImportError('INVALID_ARCHIVE');
  const recordCount =
    manifest.counts.notes + manifest.counts.secrets + manifest.counts.seals + manifest.counts.authenticators;
  if (recordCount > VAULT_IMPORT_LIMITS.maxRecords || manifest.counts.attachments > VAULT_IMPORT_LIMITS.maxAttachments)
    throw new VaultImportError('LIMIT');
  if (manifest.counts.attachments !== attachments.length) throw new VaultImportError('INVALID_ARCHIVE');
  if (manifest.totals.attachmentBytes > MAX_USER_STORAGE) throw new VaultImportError('LIMIT');

  const encrypted = manifest.selection.some((category) => category !== 'notes');
  if (encrypted && (!profile || manifest.source.vaultKeyId !== profile.vaultKeyId))
    throw new VaultImportError('INVALID_ARCHIVE');
  if (profile && manifest.source.vaultKeyId !== profile.vaultKeyId) throw new VaultImportError('INVALID_ARCHIVE');

  const expectedPaths = new Set<string>(['data/tags.json', 'attachments/index.ndjson']);
  if (profile) expectedPaths.add('profile.json');
  for (const category of manifest.selection) expectedPaths.add(`data/${category}.ndjson`);
  for (const attachment of attachments) expectedPaths.add(`attachments/${attachment.id}`);
  if (manifest.entries.length !== expectedPaths.size) throw new VaultImportError('INVALID_ARCHIVE');
  const entryByPath = new Map(manifest.entries.map((entry) => [entry.path, entry]));
  for (const path of expectedPaths) if (!entryByPath.has(path)) throw new VaultImportError('INVALID_ARCHIVE');

  const seenTags = new Set<string>();
  const seenNames = new Set<string>();
  for (const tag of archiveTags) {
    if (seenTags.has(tag.sourceId) || seenNames.has(tag.normalizedName)) throw new VaultImportError('INVALID_ARCHIVE');
    seenTags.add(tag.sourceId);
    seenNames.add(tag.normalizedName);
  }
  const seenAttachments = new Set<string>();
  let attachmentBytes = 0;
  for (const attachment of attachments) {
    if (seenAttachments.has(attachment.id)) throw new VaultImportError('INVALID_ARCHIVE');
    seenAttachments.add(attachment.id);
    const entry = entryByPath.get(`attachments/${attachment.id}`)!;
    if (entry.bytes !== attachment.size || entry.sha256 !== attachment.checksum)
      throw new VaultImportError('INVALID_ARCHIVE');
    attachmentBytes += attachment.size;
  }
  if (attachmentBytes !== manifest.totals.attachmentBytes) throw new VaultImportError('INVALID_ARCHIVE');
}

async function destinationProfile(db: Db, userId: string) {
  const [row] = await db
    .select({ id: encryptionProfiles.id, vaultKeyId: encryptionProfiles.vaultKeyId })
    .from(encryptionProfiles)
    .where(eq(encryptionProfiles.userId, userId))
    .limit(1);
  return row ?? null;
}

async function hasRows(db: Db, userId: string, tables: Array<{ id: any; userId: any }>) {
  const found = await Promise.all(
    tables.map((table) => (db as any).select({ id: table.id }).from(table).where(eq(table.userId, userId)).limit(1)),
  );
  return found.some((rows: unknown[]) => rows.length > 0);
}

function profileMaterial(profile: PortableEncryptionProfile) {
  return {
    version: profile.version,
    serverShare: profile.serverShare,
    salt: profile.salt,
    kdf: profile.kdf,
    keyCheck: profile.keyCheck,
    vaultKeyId: profile.vaultKeyId,
  };
}

async function destinationTagNames(db: Db, userId: string): Promise<Map<string, string>> {
  const rows = await db.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.userId, userId));
  return new Map(rows.map((row) => [normalizeTagName(row.name), row.id]));
}

function review(row: ImportOperation, tagCount: number, tagMatches: number): VaultImportReview {
  const manifest = row.manifest as any;
  return {
    operationId: row.id,
    generation: row.generation,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    archiveCreatedAt: manifest.createdAt,
    selection: manifest.selection,
    counts: row.counts,
    tagCount,
    tagMatches,
    attachmentBytes: row.attachmentBytes,
    installsEncryptionProfile: row.profile !== null,
    mode: row.mode,
  };
}

async function owned(db: Db, actor: Actor, operationId: string, phases?: string[]) {
  const [row] = await db
    .select()
    .from(vaultImports)
    .where(
      and(
        eq(vaultImports.id, operationId),
        eq(vaultImports.userId, actor.userId),
        eq(vaultImports.ownerSid, actor.sid),
      ),
    )
    .limit(1);
  if (!row) throw new VaultImportError('NOT_FOUND');
  if (row.expiresAt <= new Date()) throw new VaultImportError('EXPIRED');
  if (phases && !phases.includes(row.phase)) throw new VaultImportError('CONFLICT');
  return row;
}

/** The destination vault identity the plan was made against must still hold. */
async function assertSameDestination(db: Db, userId: string, operation: ImportOperation) {
  const profile = await destinationProfile(db, userId);
  if ((profile?.id ?? null) !== operation.destinationProfileId) throw new VaultImportError('DESTINATION_CHANGED');
  if ((profile?.vaultKeyId ?? null) !== operation.destinationVaultKeyId)
    throw new VaultImportError('DESTINATION_CHANGED');
}

// Ids per `IN (…)` list: a commit can reach VAULT_IMPORT_LIMITS.maxRecords,
// far past Postgres's 65,535 bind parameters in a single statement.
const ID_CHUNK = 1_000;

async function inChunks<K, V>(ids: string[], load: (chunk: string[]) => Promise<Map<K, V>>) {
  const merged = new Map<K, V>();
  for (let offset = 0; offset < ids.length; offset += ID_CHUNK)
    for (const [key, value] of await load(ids.slice(offset, offset + ID_CHUNK))) merged.set(key, value);
  return merged;
}

/** Destination aggregates for archived ids, with their digests. */
function destinationTier(db: Db, userId: string, category: TierCategory, ids: string[]) {
  return inChunks(ids, (chunk) => destinationTierChunk(db, userId, category, chunk));
}

async function destinationTierChunk(db: Db, userId: string, category: TierCategory, ids: string[]) {
  const { records, attachments } = await captureTier(db, userId, tierKind[category], ids);
  const tagIds = [...new Set(records.flatMap((record) => record.tagRefs))];
  const tagNames = new Map((await captureTags(db, userId, tagIds)).map((tag) => [tag.sourceId, tag.normalizedName]));
  const byOwner = new Map<string, PortableAttachmentRow[]>();
  for (const attachment of attachments) {
    const list = byOwner.get(attachment.portable.owner.recordId) ?? [];
    list.push(attachment.portable);
    byOwner.set(attachment.portable.owner.recordId, list);
  }
  return new Map(
    records.map((record: any) => {
      const files = byOwner.get(record.id) ?? [];
      const aggregate = tierAggregate(
        category,
        record,
        record.tagRefs.map((tagId: string) => tagNames.get(tagId) ?? tagId),
        files,
      );
      return [
        record.id as string,
        { record, digest: aggregateDigest(aggregate), attachmentIds: files.map((file) => file.id) },
      ];
    }),
  );
}

function destinationAuthenticators(db: Db, userId: string, ids: string[]) {
  return inChunks(ids, async (chunk) => {
    const records = await captureAuthenticators(db, userId, chunk);
    return new Map(
      records.map((record) => [record.id, { record, digest: aggregateDigest(authenticatorAggregate(record)) }]),
    );
  });
}

/** Every destination row holding an archived attachment id, deleted ones
 * included: a deleted row still owns the id, so it can be neither reused nor
 * inserted over. */
function destinationAttachments(db: Db, userId: string, ids: string[]) {
  return inChunks(ids, (chunk) => destinationAttachmentChunk(db, userId, chunk));
}

async function destinationAttachmentChunk(db: Db, userId: string, ids: string[]) {
  const rows = await db
    .select()
    .from(fileAttachments)
    .where(and(eq(fileAttachments.userId, userId), inArray(fileAttachments.id, ids)));
  return new Map(
    rows.map((row) => {
      const live = row.deletedAt === null && row.storageDeletedAt === null && row.noteId && row.noteTier;
      const owner = live
        ? { category: kindCategory[row.noteTier as TierKind] as TierCategory, recordId: row.noteId as string }
        : null;
      const value = owner
        ? aggregateDigest(
            attachmentAggregate({
              id: row.id,
              owner,
              filename: row.filename,
              size: row.size,
              mimeType: row.mimeType,
              encrypted: row.encrypted,
              encryptionIv: row.encryptionIv,
              keyScope: row.keyScope,
              keyNoteId: row.keyNoteId,
              createdAt: row.createdAt,
            }),
          )
        : null;
      return [row.id, { row, owner, digest: value }];
    }),
  );
}

const iso = (value: Date | null) => (value ? value.toISOString() : null);

export function createVaultImportService({ storage }: { storage: VaultImportObjectStore }) {
  const analyze = async (actor: Actor, raw: unknown): Promise<VaultImportReview> => {
    const parsed = vaultImportAnalysisSchema.safeParse(raw);
    if (!parsed.success) throw new VaultImportError('INVALID_ARCHIVE');
    const input = parsed.data as VaultImportAnalysis;
    assertArchiveStructure(input);
    return withAccountLock(actor.userId, async (db, state) => {
      if (state.activeRotationId) throw new VaultImportError('CONFLICT');
      const now = new Date();
      await db
        .update(vaultImports)
        .set({ phase: 'aborted', updatedAt: now })
        .where(
          and(
            eq(vaultImports.userId, actor.userId),
            lt(vaultImports.expiresAt, now),
            ne(vaultImports.phase, 'committed'),
          ),
        );
      const [active] = await db
        .select({ id: vaultImports.id })
        .from(vaultImports)
        .where(and(eq(vaultImports.userId, actor.userId), inArray(vaultImports.phase, ['review', 'staging', 'ready'])))
        .limit(1);
      // Its own code, not CONFLICT: unlike a rotation the user can clear it,
      // and a tab closed mid-import otherwise blocks the account for an hour.
      if (active) throw new VaultImportError('IMPORT_IN_PROGRESS');

      // Ciphertext may only land under the key it was made with. A Notes-only
      // archive carries nothing encrypted, so any destination accepts it.
      const encrypted = input.manifest.selection.some((category) => category !== 'notes');
      const existing = await destinationProfile(db, actor.userId);
      let installsProfile = false;
      if (existing) {
        if (encrypted && !existing.vaultKeyId) throw new VaultImportError('VAULT_ID_REQUIRED');
        if (encrypted && existing.vaultKeyId !== input.profile!.vaultKeyId)
          throw new VaultImportError('VAULT_KEY_MISMATCH');
      } else if (input.profile) {
        // No profile means nothing encrypted can exist here; installing the
        // archived one is what makes the restored ciphertext openable.
        if (await hasRows(db, actor.userId, [secretNotes, sealNotes, otpRecords]))
          throw new VaultImportError('CONFLICT');
        installsProfile = true;
      }
      const hasData = await hasRows(db, actor.userId, [
        notes,
        secretNotes,
        sealNotes,
        otpRecords,
        fileAttachments,
        tags,
      ]);
      const destinationTags = await destinationTagNames(db, actor.userId);
      const tagMatches = input.tags.filter((tag) => destinationTags.has(tag.normalizedName)).length;

      const operationId = uuidv7();
      const expiresAt = new Date(now.getTime() + VAULT_IMPORT_LIMITS.operationLifetimeMs);
      await db.insert(vaultImports).values({
        id: operationId,
        userId: actor.userId,
        ownerSid: actor.sid,
        generation: state.generation,
        phase: 'review',
        mode: hasData || existing ? 'merge' : 'fresh',
        destinationProfileId: existing?.id ?? null,
        destinationVaultKeyId: existing?.vaultKeyId ?? null,
        manifestDigest: input.manifest.digest,
        manifest: input.manifest as unknown as Record<string, unknown>,
        profile: installsProfile ? profileMaterial(input.profile!) : null,
        counts: input.manifest.counts,
        stagedCounts: zeroCounts(),
        attachmentBytes: input.manifest.totals.attachmentBytes,
        createdAt: now,
        updatedAt: now,
        expiresAt,
      });
      const tagRows = input.tags.map((tag, ordinal) => ({
        importId: operationId,
        kind: 'tag' as const,
        resourceId: tag.sourceId,
        payload: tag as unknown as Record<string, unknown>,
        sourceDigest: digest(tag),
        bytes: jsonBytes(tag),
        ordinal,
      }));
      const attachmentRows = input.attachments.map((attachment) => {
        const { checksum, ordinal, ...payload } = attachment;
        return {
          importId: operationId,
          kind: 'attachment' as const,
          resourceId: payload.id,
          payload: payload as unknown as Record<string, unknown>,
          sourceDigest: digest(payload),
          bytes: payload.size,
          ordinal,
          checksum,
        };
      });
      for (let offset = 0; offset < tagRows.length; offset += 500)
        await db.insert(vaultImportItems).values(tagRows.slice(offset, offset + 500));
      for (let offset = 0; offset < attachmentRows.length; offset += 500)
        await db.insert(vaultImportItems).values(attachmentRows.slice(offset, offset + 500));
      const [row] = await db.select().from(vaultImports).where(eq(vaultImports.id, operationId));
      return review(row, input.tags.length, tagMatches);
    });
  };

  /** What the destination already holds under archived ids. Read-only, and it
   * returns digests and review metadata — never content. */
  const lookup = async (
    actor: Actor,
    operationId: string,
    raw: unknown,
  ): Promise<VaultImportLookupRecord[] | VaultImportLookupAttachment[]> => {
    const parsed = vaultImportLookupSchema.safeParse(raw);
    if (!parsed.success) throw new VaultImportError('INVALID_ARCHIVE');
    const { category, ids } = parsed.data;
    return withAccountLock(actor.userId, async (db, state) => {
      const operation = await owned(db, actor, operationId, ['review']);
      if (state.generation !== operation.generation) throw new VaultImportError('DESTINATION_CHANGED');
      if (category === 'attachments') {
        const found = await destinationAttachments(db, actor.userId, ids);
        return [...found.values()].map(({ row, owner, digest: value }) => ({ id: row.id, digest: value, owner }));
      }
      if (category === 'authenticators') {
        const found = await destinationAuthenticators(db, actor.userId, ids);
        return [...found.values()].map(({ record, digest: value }) => ({
          id: record.id,
          digest: value,
          title: null,
          createdAt: record.createdAt.toISOString(),
          updatedAt: record.updatedAt.toISOString(),
          deletedAt: iso(record.deletedAt),
          archived: record.archived,
          color: record.color,
          pattern: record.pattern,
          revision: record.revision,
          attachmentIds: [],
        }));
      }
      const found = await destinationTier(db, actor.userId, category, ids);
      return [...found.values()].map(({ record, digest: value, attachmentIds }) => ({
        id: record.id,
        digest: value,
        title: record.title,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
        deletedAt: iso(record.deletedAt),
        archived: record.archived,
        color: record.color,
        pattern: record.pattern,
        revision: null,
        attachmentIds,
      }));
    });
  };

  const begin = async (actor: Actor, operationId: string, raw: unknown) => {
    const parsed = vaultImportPlanSchema.safeParse(raw);
    if (!parsed.success) throw new VaultImportError('INVALID_ARCHIVE');
    const plan = parsed.data;
    return withAccountLock(actor.userId, async (db, state) => {
      const operation = await owned(db, actor, operationId, ['review']);
      if (state.generation !== operation.generation || state.activeRotationId)
        throw new VaultImportError('DESTINATION_CHANGED');
      await assertSameDestination(db, actor.userId, operation);
      if (
        (Object.keys(plan.expected) as Array<keyof VaultImportCounts>).some(
          (key) => plan.expected[key] > operation.counts[key],
        ) ||
        plan.expectedAttachmentBytes > operation.attachmentBytes
      )
        throw new VaultImportError('INVALID_ARCHIVE');
      const noWork = Object.values(plan.expected).every((count) => count === 0);
      await db
        .update(vaultImports)
        .set({
          phase: noWork ? 'ready' : 'staging',
          tagPolicy: plan.tagPolicy,
          expectedCounts: plan.expected,
          expectedAttachmentBytes: plan.expectedAttachmentBytes,
          updatedAt: new Date(),
        })
        .where(eq(vaultImports.id, operationId));
      return { operationId, phase: noWork ? ('ready' as const) : ('staging' as const) };
    });
  };

  const stageRecords = async (actor: Actor, operationId: string, category: RecordCategory, raw: unknown) => {
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > VAULT_IMPORT_LIMITS.requestRecords)
      throw new VaultImportError('INVALID_ARCHIVE');
    if (jsonBytes(raw) > VAULT_IMPORT_LIMITS.requestBytes) throw new VaultImportError('LIMIT');
    const schema = vaultImportStagedRecordSchemas[category];
    const staged = raw.map((value) => {
      const result = schema.safeParse(value);
      if (!result.success) throw new VaultImportError('INVALID_ARCHIVE');
      return result.data as StagedRecord<PortableTierRecord | PortableAuthenticator>;
    });
    if (new Set(staged.map((item) => item.record.id)).size !== staged.length)
      throw new VaultImportError('INVALID_ARCHIVE');

    return withAccountLock(actor.userId, async (db, state) => {
      const operation = await owned(db, actor, operationId, ['staging']);
      if (state.generation !== operation.generation || !(operation.manifest as any).selection.includes(category))
        throw new VaultImportError('DESTINATION_CHANGED');
      const kind = categoryKind[category];
      const [current] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(vaultImportItems)
        .where(and(eq(vaultImportItems.importId, operationId), eq(vaultImportItems.kind, kind)));
      const expected = operation.expectedCounts?.[category] ?? 0;
      if ((current?.count ?? 0) + staged.length > expected) throw new VaultImportError('INVALID_ARCHIVE');
      const existing = await db
        .select({ resourceId: vaultImportItems.resourceId })
        .from(vaultImportItems)
        .where(
          and(
            eq(vaultImportItems.importId, operationId),
            eq(vaultImportItems.kind, kind),
            inArray(
              vaultImportItems.resourceId,
              staged.map((item) => item.record.id),
            ),
          ),
        );
      if (existing.length) throw new VaultImportError('CONFLICT');
      await db.insert(vaultImportItems).values(
        staged.map((item, offset) => ({
          importId: operationId,
          kind,
          resourceId: item.record.id,
          payload: item.record as unknown as Record<string, unknown>,
          sourceDigest: digest(item.record),
          bytes: jsonBytes(item.record),
          ordinal: (current?.count ?? 0) + offset,
          action: item.action,
          expectedDigest: item.expected,
        })),
      );
      const stagedCounts = { ...operation.stagedCounts, [category]: (current?.count ?? 0) + staged.length };
      await db
        .update(vaultImports)
        .set({ stagedCounts, updatedAt: new Date() })
        .where(eq(vaultImports.id, operationId));
      await markReadyIfComplete(db, operationId);
      return { accepted: staged.length };
    });
  };

  const attachmentGrant = async (actor: Actor, operationId: string, attachmentId: string) => {
    const object = await withAccountLock(actor.userId, async (db, state) => {
      const operation = await owned(db, actor, operationId, ['staging']);
      if (state.generation !== operation.generation) throw new VaultImportError('DESTINATION_CHANGED');
      const [item] = await db
        .select()
        .from(vaultImportItems)
        .where(
          and(
            eq(vaultImportItems.importId, operationId),
            eq(vaultImportItems.kind, 'attachment'),
            eq(vaultImportItems.resourceId, attachmentId),
          ),
        )
        .limit(1);
      if (!item || !item.checksum || item.fileVerified) throw new VaultImportError('CONFLICT');
      const allocated = item.stageKey
        ? { key: item.stageKey, bytes: item.bytes, checksum: item.checksum }
        : storage.allocate(operationId, item.bytes, item.checksum);
      const grantExpiresAt = new Date(
        Date.now() + VAULT_IMPORT_LIMITS.grantSeconds * 1000 + VAULT_IMPORT_LIMITS.cleanupGraceMs,
      );
      await db
        .update(vaultImportItems)
        .set({ stageKey: allocated.key, grantExpiresAt })
        .where(
          and(
            eq(vaultImportItems.importId, operationId),
            eq(vaultImportItems.kind, 'attachment'),
            eq(vaultImportItems.resourceId, attachmentId),
          ),
        );
      return allocated;
    });
    return {
      ...(await storage.uploadGrant(object, VAULT_IMPORT_LIMITS.grantSeconds)),
      expiresIn: VAULT_IMPORT_LIMITS.grantSeconds,
    };
  };

  const verifyAttachment = async (actor: Actor, operationId: string, attachmentId: string) => {
    const item = await withAccountLock(actor.userId, async (db) => {
      await owned(db, actor, operationId, ['staging']);
      const [row] = await db
        .select()
        .from(vaultImportItems)
        .where(
          and(
            eq(vaultImportItems.importId, operationId),
            eq(vaultImportItems.kind, 'attachment'),
            eq(vaultImportItems.resourceId, attachmentId),
          ),
        )
        .limit(1);
      if (!row?.stageKey || !row.checksum) throw new VaultImportError('CONFLICT');
      return row;
    });
    let verified: { etag: string };
    try {
      verified = await storage.verify({ key: item.stageKey!, bytes: item.bytes, checksum: item.checksum! });
    } catch {
      throw new VaultImportError('STORAGE_MISMATCH');
    }
    return withAccountLock(actor.userId, async (db) => {
      const operation = await owned(db, actor, operationId, ['staging']);
      const [fresh] = await db
        .select()
        .from(vaultImportItems)
        .where(
          and(
            eq(vaultImportItems.importId, operationId),
            eq(vaultImportItems.kind, 'attachment'),
            eq(vaultImportItems.resourceId, attachmentId),
          ),
        )
        .limit(1);
      if (!fresh || fresh.stageKey !== item.stageKey || fresh.checksum !== item.checksum)
        throw new VaultImportError('CONFLICT');
      if (!fresh.fileVerified) {
        if (operation.stagedCounts.attachments + 1 > (operation.expectedCounts?.attachments ?? 0))
          throw new VaultImportError('INVALID_ARCHIVE');
        await db
          .update(vaultImportItems)
          .set({ fileVerified: true, etag: verified.etag })
          .where(
            and(
              eq(vaultImportItems.importId, operationId),
              eq(vaultImportItems.kind, 'attachment'),
              eq(vaultImportItems.resourceId, attachmentId),
            ),
          );
        await db
          .update(vaultImports)
          .set({
            verifiedAttachmentBytes: operation.verifiedAttachmentBytes + fresh.bytes,
            stagedCounts: { ...operation.stagedCounts, attachments: operation.stagedCounts.attachments + 1 },
            updatedAt: new Date(),
          })
          .where(eq(vaultImports.id, operationId));
      }
      await markReadyIfComplete(db, operationId);
      return { verified: true as const };
    });
  };

  const status = async (actor: Actor, operationId: string) => {
    const db = getDb();
    const operation = await owned(db, actor, operationId);
    return {
      operationId,
      phase: operation.phase,
      counts: operation.counts,
      expectedCounts: operation.expectedCounts,
      stagedCounts: operation.stagedCounts,
      attachmentBytes: operation.attachmentBytes,
      verifiedAttachmentBytes: operation.verifiedAttachmentBytes,
      expiresAt: operation.expiresAt.toISOString(),
    };
  };

  const cancel = async (actor: Actor, operationId: string) =>
    withAccountLock(actor.userId, async (db) => {
      const operation = await owned(db, actor, operationId);
      if (operation.phase === 'committed') throw new VaultImportError('CONFLICT');
      await db
        .update(vaultImports)
        .set({ phase: 'aborted', updatedAt: new Date() })
        .where(eq(vaultImports.id, operationId));
      return { cancelled: true as const };
    });

  /** Abort every unfinished import on the account, whichever session opened
   * it — the escape hatch for one left behind by a closed tab or another
   * device. Nothing is lost: an import is invisible until its atomic commit,
   * which re-checks the phase under the same lock, and the daily cleanup
   * removes what the aborted ones staged. */
  const discardUnfinished = async (actor: Actor) =>
    withAccountLock(actor.userId, async (db) => {
      const discarded = await db
        .update(vaultImports)
        .set({ phase: 'aborted', updatedAt: new Date() })
        .where(and(eq(vaultImports.userId, actor.userId), inArray(vaultImports.phase, ['review', 'staging', 'ready'])))
        .returning({ id: vaultImports.id });
      return { discarded: discarded.length };
    });

  const commit = async (actor: Actor, operationId: string) => {
    const db = getDb();
    await owned(db, actor, operationId, ['ready']);
    const verifiedFiles = await db
      .select()
      .from(vaultImportItems)
      .where(
        and(
          eq(vaultImportItems.importId, operationId),
          eq(vaultImportItems.kind, 'attachment'),
          eq(vaultImportItems.fileVerified, true),
        ),
      )
      .orderBy(asc(vaultImportItems.ordinal));
    for (const item of verifiedFiles) {
      if (!item.stageKey || !item.checksum || !item.etag) throw new VaultImportError('INCOMPLETE');
      try {
        await storage.verifyMetadata({
          key: item.stageKey,
          bytes: item.bytes,
          checksum: item.checksum,
          etag: item.etag,
        });
      } catch {
        throw new VaultImportError('STORAGE_MISMATCH');
      }
    }

    return withAccountLock(actor.userId, async (tx, state) => {
      const active = await owned(tx, actor, operationId, ['ready']);
      if (state.generation !== active.generation || state.activeRotationId)
        throw new VaultImportError('DESTINATION_CHANGED');
      await assertSameDestination(tx, actor.userId, active);
      const items = await tx
        .select()
        .from(vaultImportItems)
        .where(eq(vaultImportItems.importId, operationId))
        .orderBy(asc(vaultImportItems.ordinal));
      const plan = validatePlan(active, items);
      await applyPlan(tx, actor.userId, active, plan);
      const now = new Date();
      await tx
        .update(vaultImports)
        .set({ phase: 'committed', committedAt: now, updatedAt: now })
        .where(eq(vaultImports.id, operationId));
      return { committed: true as const, counts: plan.summary, installsEncryptionProfile: active.profile !== null };
    });
  };

  const removeStaged = async (
    db: Db,
    rows: Array<{
      importId: string;
      resourceId: string;
      stageKey: string | null;
      bytes: number;
      checksum: string | null;
    }>,
  ) => {
    let removed = 0;
    for (const item of rows) {
      if (!item.stageKey || !item.checksum) continue;
      try {
        await storage.remove({ key: item.stageKey, bytes: item.bytes, checksum: item.checksum });
        await db
          .update(vaultImportItems)
          .set({ stageKey: null, etag: null, fileVerified: false })
          .where(
            and(
              eq(vaultImportItems.importId, item.importId),
              eq(vaultImportItems.kind, 'attachment'),
              eq(vaultImportItems.resourceId, item.resourceId),
            ),
          );
        removed++;
      } catch {
        // Retry on the next sweep.
      }
    }
    return removed;
  };

  const cleanup = async () => {
    const db = getDb();
    const now = new Date();
    await db
      .update(vaultImports)
      .set({ phase: 'aborted', updatedAt: now })
      .where(and(lt(vaultImports.expiresAt, now), inArray(vaultImports.phase, ['review', 'staging', 'ready'])));
    const staged = {
      importId: vaultImportItems.importId,
      resourceId: vaultImportItems.resourceId,
      stageKey: vaultImportItems.stageKey,
      bytes: vaultImportItems.bytes,
      checksum: vaultImportItems.checksum,
    };
    const graceOver = or(lt(vaultImportItems.grantExpiresAt, now), isNull(vaultImportItems.grantExpiresAt));
    // Everything an aborted import staged, and — after a commit — any object
    // that was granted but never verified: neither belongs to a live row.
    const due = await db
      .select(staged)
      .from(vaultImportItems)
      .innerJoin(vaultImports, eq(vaultImports.id, vaultImportItems.importId))
      .where(
        and(
          isNotNull(vaultImportItems.stageKey),
          graceOver,
          or(
            eq(vaultImports.phase, 'aborted'),
            and(eq(vaultImports.phase, 'committed'), eq(vaultImportItems.fileVerified, false)),
          ),
        ),
      )
      .limit(100);
    const removed = await removeStaged(db, due);
    const candidates = await db
      .select({ id: vaultImports.id, phase: vaultImports.phase })
      .from(vaultImports)
      .where(
        or(
          eq(vaultImports.phase, 'aborted'),
          and(eq(vaultImports.phase, 'committed'), lt(vaultImports.expiresAt, now)),
        ),
      );
    let operations = 0;
    for (const candidate of candidates) {
      const [left] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(vaultImportItems)
        .where(
          and(
            eq(vaultImportItems.importId, candidate.id),
            isNotNull(vaultImportItems.stageKey),
            // A committed import's verified objects are live attachments now.
            candidate.phase === 'committed' ? eq(vaultImportItems.fileVerified, false) : undefined,
          ),
        );
      if ((left?.count ?? 0) === 0) {
        await db.delete(vaultImports).where(eq(vaultImports.id, candidate.id));
        operations++;
      }
    }
    return { removed, operations };
  };

  return {
    analyze,
    lookup,
    begin,
    stageRecords,
    attachmentGrant,
    verifyAttachment,
    status,
    cancel,
    discardUnfinished,
    commit,
    cleanup,
  };
}

async function markReadyIfComplete(db: Db, operationId: string) {
  const [operation] = await db.select().from(vaultImports).where(eq(vaultImports.id, operationId)).limit(1);
  if (!operation || operation.phase !== 'staging' || !operation.expectedCounts) return;
  const expected = operation.expectedCounts;
  const complete = (Object.keys(expected) as Array<keyof VaultImportCounts>).every(
    (key) => operation.stagedCounts[key] === expected[key],
  );
  if (complete && operation.verifiedAttachmentBytes === operation.expectedAttachmentBytes)
    await db
      .update(vaultImports)
      .set({ phase: 'ready', updatedAt: new Date() })
      .where(eq(vaultImports.id, operationId));
}

type StagedRecord<T> = { action: VaultImportAction; expected: string | null; record: T };
type Plan = {
  tags: PortableTag[];
  tiers: Record<TierCategory, StagedRecord<PortableTierRecord>[]>;
  authenticators: StagedRecord<PortableAuthenticator>[];
  /** Every archived attachment, by id. */
  attachments: Map<string, { value: PortableAttachment; item: ImportItem }>;
  /** Staged (uploaded and verified) attachment ids. */
  uploaded: Set<string>;
  /** Keep-both copies by `${category}:${archived id}`: the new record id and
   * archived attachment id → the id its copy is stored under. */
  copies: Map<string, { id: string; files: Map<string, string> }>;
  summary: Record<RecordCategory, Record<VaultImportAction, number>>;
};

function validatePlan(operation: ImportOperation, items: ImportItem[]): Plan {
  const expected = operation.expectedCounts;
  if (!expected || operation.verifiedAttachmentBytes !== operation.expectedAttachmentBytes)
    throw new VaultImportError('INCOMPLETE');
  const counts = zeroCounts();
  const plan: Plan = {
    tags: [],
    tiers: { notes: [], secrets: [], seals: [] },
    authenticators: [],
    attachments: new Map(),
    uploaded: new Set(),
    copies: new Map(),
    summary: {
      notes: { insert: 0, replace: 0, copy: 0 },
      secrets: { insert: 0, replace: 0, copy: 0 },
      seals: { insert: 0, replace: 0, copy: 0 },
      authenticators: { insert: 0, replace: 0, copy: 0 },
    },
  };
  for (const item of items) {
    if (item.kind === 'tag') {
      const tag = portableTagSchema.parse(item.payload);
      if (digest(tag) !== item.sourceDigest) throw new VaultImportError('INVALID_ARCHIVE');
      plan.tags.push(tag);
    } else if (item.kind === 'attachment') {
      const value = portableAttachmentSchema.parse(item.payload) as PortableAttachment;
      if (digest(value) !== item.sourceDigest) throw new VaultImportError('INVALID_ARCHIVE');
      plan.attachments.set(value.id, { value, item });
      if (item.fileVerified) {
        plan.uploaded.add(value.id);
        counts.attachments++;
      }
    } else {
      const category = kindCategory[item.kind as keyof typeof kindCategory];
      const record = vaultImportRecordSchemas[category].parse(item.payload) as PortableTierRecord &
        PortableAuthenticator;
      if (digest(record) !== item.sourceDigest || !item.action) throw new VaultImportError('INVALID_ARCHIVE');
      if ((item.action === 'replace') !== (item.expectedDigest !== null)) throw new VaultImportError('INVALID_ARCHIVE');
      if (item.action === 'copy' && (category === 'seals' || category === 'authenticators'))
        throw new VaultImportError('INVALID_ARCHIVE');
      const staged = { action: item.action, expected: item.expectedDigest, record };
      if (category === 'authenticators') plan.authenticators.push(staged);
      else plan.tiers[category].push(staged);
      plan.summary[category][item.action]++;
      counts[category]++;
    }
  }
  if ((Object.keys(counts) as Array<keyof VaultImportCounts>).some((key) => counts[key] !== expected[key]))
    throw new VaultImportError('INCOMPLETE');

  const tagIds = new Set(plan.tags.map((tag) => tag.sourceId));
  const stagedOwners = new Set<string>();
  for (const category of ['notes', 'secrets', 'seals'] as const)
    for (const { record } of plan.tiers[category]) {
      stagedOwners.add(`${category}:${record.id}`);
      for (const tagId of record.tagRefs) if (!tagIds.has(tagId)) throw new VaultImportError('INVALID_ARCHIVE');
      for (const attachmentId of record.attachmentRefs) {
        const attachment = plan.attachments.get(attachmentId);
        if (
          !attachment ||
          attachment.value.owner.recordId !== record.id ||
          attachment.value.owner.category !== category
        )
          throw new VaultImportError('INVALID_ARCHIVE');
      }
    }
  // Uploading an attachment whose record stays as it is would stage an object
  // with nothing to own it.
  for (const id of plan.uploaded) {
    const { owner } = plan.attachments.get(id)!.value;
    if (!stagedOwners.has(`${owner.category}:${owner.recordId}`)) throw new VaultImportError('INVALID_ARCHIVE');
  }
  return plan;
}

async function applyPlan(db: Db, userId: string, operation: ImportOperation, plan: Plan) {
  if (operation.profile) {
    if (await destinationProfile(db, userId)) throw new VaultImportError('DESTINATION_CHANGED');
    await db.insert(encryptionProfiles).values({ userId, ...operation.profile });
  }
  const tagMap = await resolveTags(db, userId, operation.tagPolicy ?? 'drop', plan.tags);
  const now = new Date();

  for (const category of ['notes', 'secrets', 'seals'] as const) {
    const staged = plan.tiers[category];
    if (!staged.length) continue;
    const ids = staged.filter((entry) => entry.action !== 'copy').map((entry) => entry.record.id);
    const current = ids.length ? await destinationTier(db, userId, category, ids) : new Map();
    const retireFiles: string[] = [];
    const rows: PortableTierRecord[] = [];
    for (const entry of staged) {
      const existing = current.get(entry.record.id);
      if (entry.action === 'insert') {
        // Created since the review: the user never saw this conflict.
        if (existing) throw new VaultImportError('DESTINATION_CHANGED');
        rows.push(entry.record);
      } else if (entry.action === 'replace') {
        if (!existing || existing.digest !== entry.expected) throw new VaultImportError('DESTINATION_CHANGED');
        const kept = new Set(entry.record.attachmentRefs.filter((id) => !plan.uploaded.has(id)));
        retireFiles.push(...existing.attachmentIds.filter((id: string) => !kept.has(id)));
        rows.push(entry.record);
      } else {
        rows.push(copyOf(category, entry.record, plan));
      }
    }
    await assertReusedFiles(db, userId, category, staged, plan);
    // Attachments the replaced record drops are soft-deleted; the regular
    // storage sweep removes their objects.
    if (retireFiles.length)
      await db
        .update(fileAttachments)
        .set({ deletedAt: now })
        .where(and(eq(fileAttachments.userId, userId), inArray(fileAttachments.id, retireFiles)));
    const replaced = staged.filter((entry) => entry.action === 'replace').map((entry) => entry.record.id);
    const { table } = tierTables[category];
    // A replace swaps the whole aggregate: history and tag links go with the
    // old head (ON DELETE CASCADE) and come back from the archive.
    for (let offset = 0; offset < replaced.length; offset += 500)
      await (db as any)
        .delete(table)
        .where(and(eq(table.userId, userId), inArray(table.id, replaced.slice(offset, offset + 500))));
    await insertTier(db, userId, category, rows, tagMap);
  }

  if (plan.authenticators.length) {
    const current = await destinationAuthenticators(
      db,
      userId,
      plan.authenticators.map((entry) => entry.record.id),
    );
    for (const { action, expected, record } of plan.authenticators) {
      const existing = current.get(record.id);
      const values = {
        payload: record.payload,
        payloadVersion: record.payloadVersion,
        position: record.position,
        archived: record.archived,
        color: record.color,
        pattern: record.pattern,
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
        deletedAt: record.deletedAt ? new Date(record.deletedAt) : null,
      };
      if (action === 'insert') {
        if (existing) throw new VaultImportError('DESTINATION_CHANGED');
        await db.insert(otpRecords).values({ id: record.id, userId, revision: record.revision, ...values });
      } else {
        if (!existing || existing.digest !== expected) throw new VaultImportError('DESTINATION_CHANGED');
        // `revision` is what every device syncs on, so it must move past both
        // histories — or a device holding the old row keeps it.
        await db
          .update(otpRecords)
          .set({ ...values, revision: Math.max(existing.record.revision, record.revision) + 1 })
          .where(and(eq(otpRecords.userId, userId), eq(otpRecords.id, record.id)));
      }
    }
  }

  // Staged objects become attachments, under the owner (and, for a copied
  // Note, the id) the plan settled on.
  const fileRows = [...plan.uploaded].map((id) => {
    const { value, item } = plan.attachments.get(id)!;
    const copy = plan.copies.get(`${value.owner.category}:${value.owner.recordId}`);
    return {
      id: copy?.files.get(id) ?? value.id,
      userId,
      noteId: copy?.id ?? value.owner.recordId,
      noteTier: tierKind[value.owner.category],
      s3Key: item.stageKey!,
      filename: value.filename,
      size: value.size,
      mimeType: value.mimeType,
      encrypted: value.encrypted,
      encryptionIv: value.encryptionIv,
      keyScope: value.keyScope,
      keyNoteId: value.keyNoteId,
      createdAt: new Date(value.createdAt),
    };
  });
  if (fileRows.length) {
    const ids = fileRows.map((row) => row.id);
    for (let offset = 0; offset < ids.length; offset += 500) {
      const taken = await db
        .select({ id: fileAttachments.id })
        .from(fileAttachments)
        .where(and(eq(fileAttachments.userId, userId), inArray(fileAttachments.id, ids.slice(offset, offset + 500))))
        .limit(1);
      if (taken.length) throw new VaultImportError('DESTINATION_CHANGED');
    }
    for (let offset = 0; offset < fileRows.length; offset += 500)
      await db.insert(fileAttachments).values(fileRows.slice(offset, offset + 500));
  }
}

/**
 * Keep both. The copy is a new record: a new id, and saved "now", so it sorts
 * and reads as the newest item — while its history keeps its own timestamps.
 *
 * A Note's attachments get new ids too, rewritten into its plaintext body. A
 * Secret's body is ciphertext that names its attachments by id, so the copy
 * keeps them; the review only offers Keep both when none of those ids exist
 * here already.
 */
function copyOf(category: TierCategory, record: PortableTierRecord, plan: Plan): PortableTierRecord {
  const id = uuidv7();
  const files = new Map<string, string>();
  for (const attachmentId of record.attachmentRefs) {
    if (!plan.uploaded.has(attachmentId)) throw new VaultImportError('INCOMPLETE');
    files.set(attachmentId, category === 'notes' ? uuidv7() : attachmentId);
  }
  plan.copies.set(`${category}:${record.id}`, { id, files });
  const rewrite = (html: string) =>
    html.replace(/data-file-id="([^"]+)"/g, (match, fileId: string) =>
      files.has(fileId) ? `data-file-id="${files.get(fileId)}"` : match,
    );
  const now = new Date().toISOString();
  return {
    ...record,
    id,
    createdAt: now,
    updatedAt: now,
    ...(category === 'notes' ? { content: rewrite(record.content ?? '') } : {}),
    history: record.history.map((version) =>
      category === 'notes' ? { ...version, content: rewrite(version.content ?? '') } : version,
    ),
    attachmentRefs: [...files.values()],
  };
}

/** An attachment a replaced record keeps without uploading must be the very
 * row the review compared: same id, same metadata, same owner. */
async function assertReusedFiles(
  db: Db,
  userId: string,
  category: TierCategory,
  staged: StagedRecord<PortableTierRecord>[],
  plan: Plan,
) {
  const reused = staged.flatMap((entry) =>
    entry.record.attachmentRefs.filter((id) => !plan.uploaded.has(id)).map((id) => ({ id, entry })),
  );
  if (!reused.length) return;
  const found = await destinationAttachments(
    db,
    userId,
    reused.map(({ id }) => id),
  );
  for (const { id, entry } of reused) {
    if (entry.action !== 'replace') throw new VaultImportError('INCOMPLETE');
    const archived = plan.attachments.get(id)!.value;
    const current = found.get(id);
    if (!current?.digest || current.digest !== aggregateDigest(attachmentAggregate(archived)))
      throw new VaultImportError('DESTINATION_CHANGED');
    if (current.owner?.category !== category || current.owner.recordId !== entry.record.id)
      throw new VaultImportError('DESTINATION_CHANGED');
  }
}

/** Source tag id → destination tag id. Tag identity is the normalized name; an
 * existing tag is reused as it is — its color is never touched. */
async function resolveTags(
  db: Db,
  userId: string,
  policy: 'drop' | 'reuse' | 'create',
  archived: PortableTag[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (policy === 'drop' || !archived.length) return map;
  const existing = await destinationTagNames(db, userId);
  const missing: Array<{ id: string; userId: string; name: string; color: string }> = [];
  for (const tag of archived) {
    const found = existing.get(tag.normalizedName);
    if (found) map.set(tag.sourceId, found);
    else if (policy === 'create') {
      const id = uuidv7();
      map.set(tag.sourceId, id);
      missing.push({ id, userId, name: tag.normalizedName, color: autoTagColor(tag.normalizedName) });
    }
  }
  for (let offset = 0; offset < missing.length; offset += 500)
    await db.insert(tags).values(missing.slice(offset, offset + 500));
  return map;
}

async function insertTier(
  db: Db,
  userId: string,
  category: TierCategory,
  records: PortableTierRecord[],
  tagMap: Map<string, string>,
) {
  if (!records.length) return;
  const { table, versions, joins } = tierTables[category];
  const kind = tierKind[category];
  for (let offset = 0; offset < records.length; offset += 200)
    await (db as any).insert(table).values(
      records.slice(offset, offset + 200).map((row) => ({
        id: row.id,
        userId,
        title: row.title,
        ...(kind === 'note' ? { content: row.content } : { encryptedBody: row.encryptedBody }),
        ...(kind === 'seal' ? { wrappedNoteKey: row.wrappedNoteKey } : {}),
        position: row.position,
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt),
        deletedAt: row.deletedAt ? new Date(row.deletedAt) : null,
        archived: row.archived,
        color: row.color,
        pattern: row.pattern,
        pinned: row.pinned,
        expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
        burnAfterReading: row.burnAfterReading,
      })),
    );
  // In archived order, so the generated `seq` reproduces the history order.
  const history = records.flatMap((row) =>
    row.history.map((version) => ({
      userId,
      noteId: row.id,
      title: version.title,
      ...(kind === 'note' ? { content: version.content } : { encryptedBody: version.encryptedBody }),
      createdAt: new Date(version.createdAt),
    })),
  );
  for (let offset = 0; offset < history.length; offset += 500)
    await (db as any).insert(versions).values(history.slice(offset, offset + 500));
  const relations = records.flatMap((row) => {
    let sortOrder = 0;
    // A dropped tag leaves no gap: the remaining ones keep their relative order.
    return row.tagRefs.flatMap((sourceId) => {
      const tagId = tagMap.get(sourceId);
      return tagId ? [{ userId, noteId: row.id, tagId, sortOrder: sortOrder++ }] : [];
    });
  });
  for (let offset = 0; offset < relations.length; offset += 500)
    await (db as any).insert(joins).values(relations.slice(offset, offset + 500));
}
