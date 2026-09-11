import { and, asc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { withAccountLock, type EncryptionState } from '@/db/encryptionState';
import {
  authSessions,
  encryptionProfiles,
  encryptionRotations,
  encryptionStates,
  rotationItems,
  rotationCleanup,
  secretNotes,
  secretNoteVersions,
  sealNotes,
  sealNoteVersions,
  otpRecords,
  fileAttachments,
  type RotationKind,
  type RotationCipherValue,
} from '@/db/schema';
import { createRotationObjectStore } from './objectStore';
import { captureInventory } from './inventory';
import {
  beginSchema,
  digest,
  jsonBytes,
  payloadSchema,
  RotationError,
  ROTATION_LIMITS,
  type Actor,
  type BeginInput,
  type Worker,
  type RotationLimits,
} from './contracts';

type Operation = typeof encryptionRotations.$inferSelect;
type Item = typeof rotationItems.$inferSelect;
type Ref = { kind: RotationKind; resourceId: string };
type FileValue = { key: string; iv: string; bytes: number; checksum: string };
type Storage = ReturnType<typeof createRotationObjectStore>;
const terminal = (op: Operation) => ['committed', 'cleaned', 'aborted'].includes(op.phase);
const committed = (op: Operation) => op.phase === 'committed' || op.phase === 'cleaned';
const fileValue = (value: RotationCipherValue): FileValue => {
  if (!value || !('key' in value)) throw new RotationError('SOURCE_CORRUPT');
  return value;
};
const itemWhere = (operationId: string, ref: Ref) =>
  and(
    eq(rotationItems.operationId, operationId),
    eq(rotationItems.kind, ref.kind),
    eq(rotationItems.resourceId, ref.resourceId),
  );

export function createRotationService(options: {
  storage: Storage;
  limits?: Partial<RotationLimits>;
  now?: () => Date;
  /** Dependency injection for in-process tests only; never exposed as an RPC. */
  commitCheckpoint?: (step: string) => void | Promise<void>;
}) {
  const limits = { ...ROTATION_LIMITS, ...options.limits };
  for (const value of Object.values(limits))
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid rotation limits');
  const now = options.now ?? (() => new Date());
  const storage = options.storage;
  const budget = (value: unknown) => {
    if (jsonBytes(value) > limits.maxRequestBytes - 4096) throw new RotationError('LIMIT');
  };
  const statusValue = (op: Operation) => ({
    operationId: op.id,
    phase: op.phase,
    paused: op.paused,
    ownerSid: op.ownerSid,
    workerFence: op.workerFence,
    profileId: op.profileId,
    sourceGeneration: op.sourceGeneration,
    targetGeneration: op.targetGeneration,
    itemCount: op.itemCount,
    sourceBytes: op.sourceBytes,
    fileBytes: op.fileBytes,
    stagedBytes: op.stagedBytes,
    inventoryDigest: op.inventoryDigest,
    recoveryReady: op.recoveryDigest !== null,
    expiresAt: op.expiresAt,
    committedAt: op.committedAt,
    limits,
    // After activation only active material should be used. Do not provide a
    // stale pending-material path from terminal operation status.
    pendingMaterial: terminal(op) ? null : op.pendingMaterial,
  });
  async function owned(db: Db, actor: Actor, id: string) {
    const [op] = await db
      .select()
      .from(encryptionRotations)
      .where(and(eq(encryptionRotations.id, id), eq(encryptionRotations.userId, actor.userId)));
    if (!op) throw new RotationError('NOT_FOUND');
    return op;
  }
  async function sessions(db: Db, actor: Actor, state: EncryptionState) {
    if (
      !actor.sid ||
      state.sessionEpoch === 0 ||
      state.survivingSid !== actor.sid ||
      state.rotationSessionSid !== actor.sid
    )
      throw new RotationError('SESSION_PREREQUISITE');
    const rows = await db
      .select({ id: authSessions.id })
      .from(authSessions)
      .where(
        and(eq(authSessions.userId, actor.userId), isNull(authSessions.revokedAt), gt(authSessions.expiresAt, now())),
      )
      .limit(2);
    if (rows.length !== 1 || rows[0].id !== actor.sid) throw new RotationError('SESSION_PREREQUISITE');
  }
  async function worker(db: Db, actor: Actor, token: Worker, state: EncryptionState, allowPaused = false) {
    const op = await owned(db, actor, token.operationId);
    if (
      terminal(op) ||
      op.ownerSid !== actor.sid ||
      op.workerFence !== token.workerFence ||
      op.sourceGeneration !== token.generation ||
      state.generation !== op.sourceGeneration ||
      state.activeRotationId !== op.id ||
      (op.paused && !allowPaused)
    )
      throw new RotationError('CONFLICT');
    if (op.expiresAt <= now()) throw new RotationError('EXPIRED');
    await sessions(db, actor, state);
    return op;
  }
  async function allItems(db: Db, operationId: string) {
    return db
      .select()
      .from(rotationItems)
      .where(eq(rotationItems.operationId, operationId))
      .orderBy(asc(rotationItems.kind), asc(rotationItems.resourceId));
  }
  async function getItem(db: Db, operationId: string, ref: Ref) {
    const [item] = await db.select().from(rotationItems).where(itemWhere(operationId, ref));
    if (!item) throw new RotationError('NOT_FOUND');
    return item;
  }
  async function touch(db: Db, op: Operation, patch: Partial<typeof encryptionRotations.$inferInsert> = {}) {
    const [next] = await db
      .update(encryptionRotations)
      .set({ ...patch, updatedAt: now(), expiresAt: new Date(now().getTime() + limits.retentionMs) })
      .where(eq(encryptionRotations.id, op.id))
      .returning();
    return next;
  }
  async function queue(db: Db, op: Operation, key: string, notBefore: Date, reservedBytes = 0) {
    await db
      .insert(rotationCleanup)
      .values({ operationId: op.id, userId: op.userId, objectKey: key, notBefore, reservedBytes })
      .onConflictDoNothing({ target: rotationCleanup.objectKey });
  }
  async function abort(db: Db, op: Operation) {
    if (committed(op)) throw new RotationError('CONFLICT');
    if (op.phase === 'aborted') return op;
    for (const item of await allItems(db, op.id))
      if (item.fileGrant) await queue(db, op, item.fileGrant.key, item.grantExpiresAt ?? now(), item.fileGrant.bytes);
    const [result] = await db
      .update(encryptionRotations)
      .set({ phase: 'aborted', pendingMaterial: null, paused: false, updatedAt: now() })
      .where(eq(encryptionRotations.id, op.id))
      .returning();
    await db
      .update(encryptionStates)
      .set({ activeRotationId: null })
      .where(and(eq(encryptionStates.userId, op.userId), eq(encryptionStates.activeRotationId, op.id)));
    await db.delete(rotationItems).where(eq(rotationItems.operationId, op.id));
    return result;
  }
  async function ready(db: Db, op: Operation) {
    const [counts] = await db
      .select({
        total: sql<number>`count(*)::int`,
        incomplete: sql<number>`count(*) filter (where ${rotationItems.replacementDigest} is null or ${rotationItems.verifiedDigest} is distinct from ${rotationItems.replacementDigest} or (${rotationItems.kind} = 'file' and not ${rotationItems.fileVerified}))::int`,
      })
      .from(rotationItems)
      .where(eq(rotationItems.operationId, op.id));
    const complete = counts.total === op.itemCount && counts.incomplete === 0;
    return touch(db, op, { phase: complete && op.recoveryDigest ? 'ready' : 'migrating' });
  }
  async function stageValue(db: Db, op: Operation, item: Item, value: RotationCipherValue, stageKey: string) {
    if (!stageKey || stageKey.length > 128) throw new RotationError('INVALID_INPUT');
    const hash = digest(value);
    if (item.replacementDigest !== null) {
      if (item.replacementDigest !== hash || item.stageKey !== stageKey) throw new RotationError('CONFLICT');
      return item;
    }
    const bytes = jsonBytes(value);
    if (op.stagedBytes + bytes > limits.maxStagedBytes) throw new RotationError('LIMIT');
    const [result] = await db
      .update(rotationItems)
      .set({ replacement: value, replacementDigest: hash, stageKey, stagedBytes: bytes })
      .where(itemWhere(op.id, item))
      .returning();
    await touch(db, op, { stagedBytes: op.stagedBytes + bytes });
    return result;
  }

  const service = {
    async status(actor: Actor, operationId?: string) {
      return withAccountLock(actor.userId, async (db, state) => {
        let op: Operation | undefined;
        if (operationId) op = await owned(db, actor, operationId);
        else {
          const rows = await db
            .select()
            .from(encryptionRotations)
            .where(eq(encryptionRotations.userId, actor.userId))
            .orderBy(sql`${encryptionRotations.createdAt} desc`)
            .limit(1);
          op = rows[0];
        }
        if (op && !terminal(op) && op.expiresAt <= now()) op = await abort(db, op);
        return { generation: state.generation, operation: op ? statusValue(op) : null };
      });
    },
    async begin(actor: Actor, raw: BeginInput) {
      budget(raw);
      const parsed = beginSchema.safeParse(raw);
      if (!parsed.success) throw new RotationError('INVALID_INPUT');
      const input = parsed.data;
      return withAccountLock(actor.userId, async (db, state) => {
        const [existing] = await db
          .select()
          .from(encryptionRotations)
          .where(eq(encryptionRotations.id, input.operationId));
        if (existing) {
          if (existing.userId !== actor.userId) throw new RotationError('NOT_FOUND');
          if (existing.beginDigest !== digest(input)) throw new RotationError('CONFLICT');
          return statusValue(existing);
        }
        if (state.activeRotationId) {
          const previous = await owned(db, actor, state.activeRotationId);
          if (previous.expiresAt <= now()) await abort(db, previous);
          else throw new RotationError('CONFLICT');
        }
        if (state.generation !== input.sourceGeneration) throw new RotationError('CONFLICT');
        await sessions(db, actor, state);
        const [profile] = await db.select().from(encryptionProfiles).where(eq(encryptionProfiles.userId, actor.userId));
        if (!profile || profile.id !== input.profileId) throw new RotationError('NOT_FOUND');
        if (
          profile.salt === input.material.salt ||
          profile.serverShare === input.material.serverShare ||
          digest(profile.keyCheck) === digest(input.material.keyCheck)
        )
          throw new RotationError('INVALID_INPUT');
        const inventory = await captureInventory(db, actor.userId, limits);
        const [op] = await db
          .insert(encryptionRotations)
          .values({
            id: input.operationId,
            userId: actor.userId,
            ownerSid: actor.sid,
            sourceGeneration: state.generation,
            targetGeneration: state.generation + 1,
            profileId: profile.id,
            profileDigest: digest(profile),
            beginDigest: digest(input),
            phase: 'migrating',
            pendingMaterial: input.material,
            inventoryDigest: inventory.inventoryDigest,
            itemCount: inventory.entries.length,
            sourceBytes: inventory.sourceBytes,
            fileBytes: inventory.fileBytes,
            createdAt: now(),
            updatedAt: now(),
            expiresAt: new Date(now().getTime() + limits.retentionMs),
          })
          .returning();
        // Bounded chunks keep the driver's SQL parameter count and individual
        // statement payload manageable even for many small inventory records.
        for (let i = 0; i < inventory.entries.length; i += 20)
          await db
            .insert(rotationItems)
            .values(inventory.entries.slice(i, i + 20).map((entry) => ({ operationId: op.id, ...entry })));
        await db
          .update(encryptionStates)
          .set({ activeRotationId: op.id })
          .where(eq(encryptionStates.userId, actor.userId));
        return statusValue(op);
      });
    },
    async inventory(actor: Actor, token: Worker, after?: Ref) {
      return withAccountLock(actor.userId, async (db, state) => {
        const op = await worker(db, actor, token, state);
        const items = await allItems(db, op.id);
        const index = after
          ? items.findIndex((item) => item.kind === after.kind && item.resourceId === after.resourceId)
          : -1;
        if (after && index === -1) throw new RotationError('INVALID_INPUT');
        const page: Item[] = [];
        // Budget full envelope incl. cursor and ciphertext JSON, not item count.
        for (const item of items.slice(index + 1)) {
          if (
            jsonBytes({ items: [...page, item], next: { kind: item.kind, resourceId: item.resourceId } }) >
            limits.maxResponseBytes - 4096
          ) {
            if (!page.length) throw new RotationError('LIMIT');
            break;
          }
          page.push(item);
        }
        const last = page.at(-1);
        return {
          items: page,
          next:
            last && index + 1 + page.length < items.length ? { kind: last.kind, resourceId: last.resourceId } : null,
        };
      });
    },
    async stage(actor: Actor, token: Worker, ref: Ref, value: RotationCipherValue, stageKey: string) {
      budget({ token, ref, value, stageKey });
      return withAccountLock(actor.userId, async (db, state) => {
        const op = await worker(db, actor, token, state);
        const item = await getItem(db, op.id, ref);
        if (item.kind === 'file' || (item.source === null ? value !== null : !payloadSchema.safeParse(value).success))
          throw new RotationError('INVALID_INPUT');
        if ((item.kind === 'seal' || item.kind === 'seal-version') && item.source !== null) {
          const wrapper = await getItem(db, op.id, { kind: 'seal-wrapper', resourceId: item.parentId! });
          if (!wrapper.replacementDigest || wrapper.replacement === null) throw new RotationError('INCOMPLETE');
        }
        if (item.source !== null && digest(item.source) === digest(value)) throw new RotationError('INVALID_INPUT');
        return stageValue(db, op, item, value, stageKey);
      });
    },
    async verify(actor: Actor, token: Worker, ref: Ref, replacementDigest: string) {
      return withAccountLock(actor.userId, async (db, state) => {
        const op = await worker(db, actor, token, state);
        const item = await getItem(db, op.id, ref);
        if (
          !item.replacementDigest ||
          item.replacementDigest !== replacementDigest ||
          (item.kind === 'file' && !item.fileVerified)
        )
          throw new RotationError('CONFLICT');
        await db.update(rotationItems).set({ verifiedDigest: replacementDigest }).where(itemWhere(op.id, ref));
        return statusValue(await ready(db, op));
      });
    },
    async confirmRecovery(
      actor: Actor,
      token: Worker,
      input: { profileId: string; generation: number; inventoryDigest: string; acknowledged: true },
    ) {
      return withAccountLock(actor.userId, async (db, state) => {
        const op = await worker(db, actor, token, state);
        if (
          input.acknowledged !== true ||
          input.profileId !== op.profileId ||
          input.generation !== op.targetGeneration ||
          input.inventoryDigest !== op.inventoryDigest
        )
          throw new RotationError('INVALID_INPUT');
        const next = await touch(db, op, { recoveryDigest: digest({ operationId: op.id, ...input }) });
        return statusValue(await ready(db, next));
      });
    },
    async pause(actor: Actor, token: Worker, paused: boolean) {
      return withAccountLock(actor.userId, async (db, state) => {
        const op = await worker(db, actor, token, state, true);
        return statusValue(await touch(db, op, { paused }));
      });
    },
    async claim(actor: Actor, operationId: string, expectedWorkerFence: number) {
      return withAccountLock(actor.userId, async (db, state) => {
        const op = await owned(db, actor, operationId);
        if (terminal(op) || op.expiresAt <= now() || state.activeRotationId !== op.id)
          throw new RotationError('CONFLICT');
        await sessions(db, actor, state);
        // CAS makes a lost takeover response safely resolvable via status.
        if (op.workerFence !== expectedWorkerFence) {
          if (op.ownerSid === actor.sid && op.workerFence === expectedWorkerFence + 1) return statusValue(op);
          throw new RotationError('CONFLICT');
        }
        return statusValue(
          await touch(db, op, { ownerSid: actor.sid, workerFence: op.workerFence + 1, paused: false }),
        );
      });
    },
    async cancel(actor: Actor, token: Worker) {
      return withAccountLock(actor.userId, async (db, state) => {
        const op = await owned(db, actor, token.operationId);
        if (op.phase === 'aborted') return statusValue(op);
        if (committed(op)) throw new RotationError('CONFLICT');
        // Expired staging can always be discarded by its authenticated account.
        if (op.expiresAt <= now()) return statusValue(await abort(db, op));
        await worker(db, actor, token, state, true);
        return statusValue(await abort(db, op));
      });
    },
    async sourceFile(actor: Actor, token: Worker, resourceId: string) {
      return withAccountLock(actor.userId, async (db, state) => {
        const op = await worker(db, actor, token, state);
        const source = fileValue((await getItem(db, op.id, { kind: 'file', resourceId })).source);
        return {
          url: await storage.sourceReadGrant(source.key, limits.grantSeconds),
          bytes: source.bytes,
          iv: source.iv,
        };
      });
    },
    async reserveFile(
      actor: Actor,
      token: Worker,
      resourceId: string,
      input: { iv: string; bytes: number; checksum: string },
    ) {
      budget(input);
      return withAccountLock(actor.userId, async (db, state) => {
        const op = await worker(db, actor, token, state);
        const ref = { kind: 'file' as const, resourceId };
        const item = await getItem(db, op.id, ref);
        const source = fileValue(item.source);
        if (
          input.bytes !== source.bytes ||
          Buffer.from(input.iv, 'base64').length !== 12 ||
          Buffer.from(input.iv, 'base64').toString('base64') !== input.iv ||
          input.iv === source.iv
        )
          throw new RotationError('INVALID_INPUT');
        if (item.replacementDigest) throw new RotationError('CONFLICT');
        let grant = item.fileGrant;
        if (!grant || grant.iv !== input.iv || grant.bytes !== input.bytes || grant.checksum !== input.checksum) {
          // Cancel/restart cannot reset the account's temporary storage quota.
          // Reservations remain charged until grant-safe cleanup succeeds.
          const [usage] = await db
            .select({ bytes: sql<number>`coalesce(sum(${encryptionRotations.reservedFileBytes}), 0)::bigint` })
            .from(encryptionRotations)
            .where(eq(encryptionRotations.userId, actor.userId));
          if (Number(usage.bytes) + input.bytes > limits.maxTemporaryFileBytes) throw new RotationError('LIMIT');
          if (grant) await queue(db, op, grant.key, item.grantExpiresAt ?? now(), grant.bytes);
          grant = { ...storage.allocate(op.id, input.bytes, input.checksum), iv: input.iv };
          await touch(db, op, { reservedFileBytes: op.reservedFileBytes + input.bytes });
        }
        // A buffer beyond URL expiry covers signing/clock precision and prevents
        // queued garbage from being deleted while an old grant can recreate it.
        const expires = new Date(now().getTime() + (limits.grantSeconds + 60) * 1000);
        await db.update(rotationItems).set({ fileGrant: grant, grantExpiresAt: expires }).where(itemWhere(op.id, ref));
        return { object: grant, grant: await storage.uploadGrant(grant, limits.grantSeconds), expiresAt: expires };
      });
    },
    async finalizeFile(actor: Actor, token: Worker, resourceId: string, key: string, stageKey: string) {
      // No storage I/O in the account's activation transaction. Verification is
      // followed by a new locked generation/fence/reference check.
      const inspected = await withAccountLock(actor.userId, async (db, state) => {
        const op = await worker(db, actor, token, state);
        const item = await getItem(db, op.id, { kind: 'file', resourceId });
        if (!item.fileGrant || item.fileGrant.key !== key) throw new RotationError('CONFLICT');
        return { grant: item.fileGrant, source: fileValue(item.source) };
      });
      const sourceInfo = await storage.inspectSource(inspected.source.key);
      if (sourceInfo.bytes !== inspected.source.bytes) throw new RotationError('SOURCE_CORRUPT');
      await storage.verify(inspected.grant);
      return withAccountLock(actor.userId, async (db, state) => {
        const op = await worker(db, actor, token, state);
        const item = await getItem(db, op.id, { kind: 'file', resourceId });
        if (!item.fileGrant || digest(item.fileGrant) !== digest(inspected.grant)) throw new RotationError('CONFLICT');
        const staged = await stageValue(db, op, item, item.fileGrant, stageKey);
        await db.update(rotationItems).set({ fileVerified: true }).where(itemWhere(op.id, item));
        return { ...staged, fileVerified: true };
      });
    },
    async stagedFile(actor: Actor, token: Worker, resourceId: string) {
      return withAccountLock(actor.userId, async (db, state) => {
        const op = await worker(db, actor, token, state);
        const item = await getItem(db, op.id, { kind: 'file', resourceId });
        if (!item.fileVerified || !item.replacementDigest) throw new RotationError('INCOMPLETE');
        const file = fileValue(item.replacement);
        return {
          url: await storage.readGrant(file, limits.grantSeconds),
          iv: file.iv,
          bytes: file.bytes,
          replacementDigest: item.replacementDigest,
        };
      });
    },
    async commit(actor: Actor, token: Worker) {
      // Resolve retries before origin I/O: a committed receipt needs no old keys
      // or objects, even after all obsolete data has been cleaned.
      const preparation = await withAccountLock(actor.userId, async (db, state) => {
        const op = await owned(db, actor, token.operationId);
        if (committed(op)) return { receipt: statusValue(op), files: [] as Item[] };
        await worker(db, actor, token, state);
        if (op.phase !== 'ready') throw new RotationError(op.recoveryDigest ? 'INCOMPLETE' : 'RECOVERY_REQUIRED');
        return { receipt: null, files: (await allItems(db, op.id)).filter((item) => item.kind === 'file') };
      });
      if (preparation.receipt) return preparation.receipt;
      for (const item of preparation.files) {
        const source = fileValue(item.source);
        const replacement = fileValue(item.replacement);
        if ((await storage.inspectSource(source.key)).bytes !== source.bytes) throw new RotationError('SOURCE_CORRUPT');
        await storage.verify(replacement);
      }
      return withAccountLock(actor.userId, async (db, state) => {
        const before = await owned(db, actor, token.operationId);
        if (committed(before)) return statusValue(before);
        const op = await worker(db, actor, token, state);
        if (op.phase !== 'ready' || !op.recoveryDigest || !op.pendingMaterial) throw new RotationError('INCOMPLETE');
        const [profile] = await db.select().from(encryptionProfiles).where(eq(encryptionProfiles.userId, actor.userId));
        if (!profile || digest(profile) !== op.profileDigest) throw new RotationError('SOURCE_CHANGED');
        const source = await captureInventory(db, actor.userId, limits);
        if (source.inventoryDigest !== op.inventoryDigest || source.entries.length !== op.itemCount)
          throw new RotationError('SOURCE_CHANGED');
        const items = await allItems(db, op.id);
        if (items.length !== source.entries.length) throw new RotationError('INCOMPLETE');
        const sourceMap = new Map(source.entries.map((item) => [`${item.kind}:${item.resourceId}`, item.sourceDigest]));
        for (const item of items) {
          if (
            sourceMap.get(`${item.kind}:${item.resourceId}`) !== item.sourceDigest ||
            !item.replacementDigest ||
            item.verifiedDigest !== item.replacementDigest ||
            digest(item.replacement) !== item.replacementDigest ||
            (item.kind === 'file' && !item.fileVerified)
          )
            throw new RotationError('INCOMPLETE');
        }
        for (const file of preparation.files) {
          const current = items.find((item) => item.kind === 'file' && item.resourceId === file.resourceId);
          if (!current || current.replacementDigest !== file.replacementDigest) throw new RotationError('CONFLICT');
        }
        const tables = [
          ['secret', secretNotes, 'encrypted_body'],
          ['secret-version', secretNoteVersions, 'encrypted_body'],
          ['seal', sealNotes, 'encrypted_body'],
          ['seal-version', sealNoteVersions, 'encrypted_body'],
          ['seal-wrapper', sealNotes, 'wrapped_note_key'],
          ['auth', otpRecords, 'payload'],
        ] as const;
        for (const [kind, table, column] of tables) {
          const values = items
            .filter((item) => item.kind === kind)
            .map((item) => ({ id: item.resourceId, value: item.replacement }));
          if (values.length)
            await db.execute(
              sql`update ${table} as target set ${sql.identifier(column)} = replacement.value ${kind === 'auth' ? sql`, revision = target.revision + 1` : sql``} from jsonb_to_recordset(${JSON.stringify(values)}::jsonb) as replacement(id text, value jsonb) where target.id = replacement.id`,
            );
          await options.commitCheckpoint?.(kind);
        }
        const fileValues = items
          .filter((item) => item.kind === 'file')
          .map((item) => ({ id: item.resourceId, ...fileValue(item.replacement) }));
        if (fileValues.length)
          await db.execute(
            sql`update ${fileAttachments} as target set s3_key = replacement.key, encryption_iv = replacement.iv from jsonb_to_recordset(${JSON.stringify(fileValues)}::jsonb) as replacement(id text, key text, iv text) where target.id = replacement.id`,
          );
        await options.commitCheckpoint?.('files');
        await db
          .update(encryptionProfiles)
          .set({ ...op.pendingMaterial, updatedAt: now() })
          .where(eq(encryptionProfiles.id, op.profileId));
        await options.commitCheckpoint?.('profile');
        await db
          .update(encryptionStates)
          .set({ generation: op.targetGeneration, activeRotationId: null })
          .where(eq(encryptionStates.userId, actor.userId));
        for (const item of items.filter((item) => item.kind === 'file'))
          await queue(db, op, fileValue(item.source).key, now(), fileValue(item.source).bytes);
        await options.commitCheckpoint?.('cleanup');
        const [result] = await db
          .update(encryptionRotations)
          .set({ phase: 'committed', paused: false, committedAt: now(), updatedAt: now(), pendingMaterial: null })
          .where(eq(encryptionRotations.id, op.id))
          .returning();
        await options.commitCheckpoint?.('receipt');
        return statusValue(result);
      });
    },
    async expire() {
      const due = await getDb()
        .select({ id: encryptionRotations.id, userId: encryptionRotations.userId })
        .from(encryptionRotations)
        .where(
          and(
            inArray(encryptionRotations.phase, ['preparing', 'migrating', 'ready']),
            lte(encryptionRotations.expiresAt, now()),
          ),
        )
        .limit(100);
      let expired = 0;
      for (const candidate of due)
        await withAccountLock(candidate.userId, async (db) => {
          const op = await owned(db, { userId: candidate.userId, sid: '' }, candidate.id);
          if (!terminal(op) && op.expiresAt <= now()) {
            await abort(db, op);
            expired++;
          }
        });
      return expired;
    },
    async cleanup(limit = 20) {
      await service.expire();
      const due = await getDb()
        .select()
        .from(rotationCleanup)
        .where(lte(rotationCleanup.notBefore, now()))
        .orderBy(asc(rotationCleanup.notBefore))
        .limit(limit);
      let removed = 0;
      for (const candidate of due)
        await withAccountLock(candidate.userId, async (db) => {
          const [task] = await db.select().from(rotationCleanup).where(eq(rotationCleanup.id, candidate.id));
          if (!task || task.notBefore > now()) return;
          const [active] = await db
            .select({ id: fileAttachments.id })
            .from(fileAttachments)
            .where(eq(fileAttachments.s3Key, task.objectKey))
            .limit(1);
          const [staged] = await db
            .select({ id: rotationItems.resourceId })
            .from(rotationItems)
            .where(
              and(
                eq(rotationItems.operationId, task.operationId),
                sql`${rotationItems.fileGrant}->>'key' = ${task.objectKey}`,
              ),
            )
            .limit(1);
          const op = await owned(db, { userId: task.userId, sid: '' }, task.operationId);
          if (active || (!terminal(op) && staged)) return;
          try {
            // Cleanup holds the same account fence while deleting one object.
            // Activation itself never performs S3 operations in its transaction.
            await storage.removeKey(task.objectKey);
            await db
              .update(rotationCleanup)
              .set({
                completedAt: task.completedAt ?? now(),
                attempts: task.attempts + 1,
                lastError: null,
                // A PUT begun before expiry may finish after deletion. Durable
                // tombstones are reaped again daily so such late objects cannot
                // become permanent orphans. Active pointers are always rechecked.
                notBefore: new Date(now().getTime() + 24 * 60 * 60 * 1000),
              })
              .where(eq(rotationCleanup.id, task.id));
            if (!task.completedAt && task.reservedBytes)
              await db
                .update(encryptionRotations)
                .set({ reservedFileBytes: Math.max(0, op.reservedFileBytes - task.reservedBytes) })
                .where(eq(encryptionRotations.id, op.id));
            removed++;
          } catch {
            await db
              .update(rotationCleanup)
              .set({
                attempts: task.attempts + 1,
                lastError: 'OBJECT_DELETE_FAILED',
                notBefore: new Date(now().getTime() + Math.min(3600_000, 1000 * 2 ** Math.min(task.attempts, 12))),
              })
              .where(eq(rotationCleanup.id, task.id));
          }
        });
      const finished = await getDb()
        .select()
        .from(encryptionRotations)
        .where(
          and(
            eq(encryptionRotations.phase, 'committed'),
            sql`not exists (select 1 from ${rotationCleanup} where ${rotationCleanup.operationId} = ${encryptionRotations.id} and ${rotationCleanup.completedAt} is null)`,
          ),
        )
        .limit(100);
      for (const candidate of finished)
        await withAccountLock(candidate.userId, async (db) => {
          const op = await owned(db, { userId: candidate.userId, sid: '' }, candidate.id);
          if (!terminal(op)) return;
          const pending = await db
            .select({ id: rotationCleanup.id })
            .from(rotationCleanup)
            .where(and(eq(rotationCleanup.operationId, op.id), isNull(rotationCleanup.completedAt)))
            .limit(1);
          if (!pending.length) {
            await db.delete(rotationItems).where(eq(rotationItems.operationId, op.id));
            if (op.phase === 'committed')
              await db.update(encryptionRotations).set({ phase: 'cleaned' }).where(eq(encryptionRotations.id, op.id));
          }
        });
      return { removed };
    },
  };
  return service;
}
