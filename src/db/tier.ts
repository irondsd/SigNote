/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, asc, desc, eq, exists, gt, inArray, isNull, notInArray, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, AnyPgTable } from 'drizzle-orm/pg-core';

import { MAX_SEARCH, MAX_VERSIONS, POSITION_STEP, VERSION_COMPRESSION_WINDOW_MS } from '@/config/constants';
import { getDb, type Db } from './client';
import { currentRequestGeneration, withVaultRead, withVaultWrite } from './encryptionState';

/**
 * Shared data layer for the three note tiers. The tables differ only in their
 * content columns (plaintext `content` vs `encryptedBody` [+ `wrappedNoteKey`]),
 * so each tier hands over a config and gets back the whole operation set.
 *
 * Internals use contained `any` casts (drizzle's builder generics don't
 * compose over a table-shaped interface); the exported surface is typed and
 * defines the JSON the API returns — `_id`, camelCase fields, `tags` as an
 * ordered id array.
 */

export type TierHeadRow = {
  _id: string;
  userId: string;
  title: string;
  position: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  archived: boolean;
  color: string | null;
  pattern: string | null;
  pinned: boolean;
  expiresAt: Date | null;
  burnAfterReading: boolean;
  tags: string[];
  /** Encryption generation used for this consistent snapshot. */
  generation: number;
} & Record<string, unknown>;

export type TierVersionRow = {
  _id: string;
  title: string;
  createdAt: Date;
  /** Encryption generation used for this consistent snapshot. */
  generation: number;
} & Record<string, unknown>;

export type MetaPatch = { pinned?: boolean; expiresAt?: Date | null; burnAfterReading?: boolean };

export type ListOptions = {
  archived?: boolean;
  limit?: number;
  offset?: number;
  search?: string;
  tagIds?: string[];
  tagMode?: 'or' | 'and';
};

export type TierConfig = {
  table: AnyPgTable;
  cols: {
    id: AnyPgColumn;
    userId: AnyPgColumn;
    title: AnyPgColumn;
    position: AnyPgColumn;
    createdAt: AnyPgColumn;
    updatedAt: AnyPgColumn;
    deletedAt: AnyPgColumn;
    archived: AnyPgColumn;
    color: AnyPgColumn;
    pattern: AnyPgColumn;
    pinned: AnyPgColumn;
    expiresAt: AnyPgColumn;
    burnAfterReading: AnyPgColumn;
    /** Generated, weighted tsvector over the tier's searchable columns. */
    searchTsv: AnyPgColumn;
  };
  /** Row keys of the tier's content fields, carried onto head reads. */
  contentKeys: string[];
  versions: {
    table: AnyPgTable;
    // `seq` is the insertion-order identity column — all history ordering and
    // the MAX_VERSIONS cap go by it. See the note on `versionSeq` in schema.ts.
    cols: {
      id: AnyPgColumn;
      seq: AnyPgColumn;
      userId: AnyPgColumn;
      noteId: AnyPgColumn;
      title: AnyPgColumn;
      createdAt: AnyPgColumn;
    };
    contentKeys: string[];
  };
  join: {
    table: AnyPgTable;
    cols: { userId: AnyPgColumn; noteId: AnyPgColumn; tagId: AnyPgColumn; sortOrder: AnyPgColumn };
  };
};

// One-hour grace on top of expiry: while the row still physically exists (the
// cleanup cron hasn't reaped it yet), a user with the note open can still cancel
// the self-destruct. Strict-future filtering happens in `list`.
const EXPIRY_GRACE_MS = 3600_000;

/**
 * Turns a raw search box string into a prefix `tsquery`.
 *
 * Every term gets a `:*` so an incremental search still matches as you type
 * ("groc" finds "groceries") — the behaviour the old case-insensitive regex
 * gave. Terms are reduced to alphanumerics, which both keeps tsquery operators
 * (`&`, `|`, `!`, `:`, parens) from being parsed and makes the string safe to
 * hand to `to_tsquery`. Returns null when nothing searchable is left, which
 * the caller turns into "match nothing".
 */
export function buildPrefixTsQuery(search: string): string | null {
  const terms = search
    .split(/\s+/)
    .map((term) => term.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  if (terms.length === 0) return null;
  return terms.map((term) => `${term}:*`).join(' & ');
}

/** Version compression: a displaced head is recorded only if its content stood
 *  for at least the window (or history is empty), so an autosave burst counts
 *  as one version — its final state. Measured against the time of the edit,
 *  not the previous version: comparing two save times drops a burst's last
 *  state no matter how long it stood. */
export function shouldRecordVersion(hasVersions: boolean, snapshotCreatedAt: Date, now: Date = new Date()): boolean {
  return !hasVersions || now.getTime() - snapshotCreatedAt.getTime() >= VERSION_COMPRESSION_WINDOW_MS;
}

export function makeTierRepo(cfg: TierConfig) {
  const { table, cols, versions, join } = cfg;

  // Ids are unique per account, not globally (see `ownedId` in schema.ts), so
  // every id-addressed statement is also scoped to its owner.
  const byId = (userId: string, id: string): SQL => and(eq(cols.userId, userId), eq(cols.id, id)) as SQL;
  const childOf = (child: { userId: AnyPgColumn; noteId: AnyPgColumn }, userId: string, noteId: string): SQL =>
    and(eq(child.userId, userId), eq(child.noteId, noteId)) as SQL;

  const activeById = (userId: string, id: string): SQL =>
    and(
      byId(userId, id),
      or(isNull(cols.expiresAt), gt(cols.expiresAt, new Date(Date.now() - EXPIRY_GRACE_MS))),
    ) as SQL;

  const tagsFor = async (db: Db, userId: string, noteIds: string[]): Promise<Map<string, string[]>> => {
    const map = new Map<string, string[]>();
    if (noteIds.length === 0) return map;
    const rows = (await (db as any)
      .select({ noteId: join.cols.noteId, tagId: join.cols.tagId })
      .from(join.table)
      .where(and(eq(join.cols.userId, userId), inArray(join.cols.noteId, noteIds)))
      .orderBy(asc(join.cols.noteId), asc(join.cols.sortOrder))) as { noteId: string; tagId: string }[];
    for (const row of rows) {
      const list = map.get(row.noteId);
      if (list) list.push(row.tagId);
      else map.set(row.noteId, [row.tagId]);
    }
    return map;
  };

  const mapHead = (
    raw: Record<string, unknown>,
    tags: string[],
    generation = currentRequestGeneration(),
  ): TierHeadRow => {
    const head: Record<string, unknown> = {
      _id: raw.id,
      userId: raw.userId,
      title: raw.title,
      position: raw.position,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      deletedAt: raw.deletedAt,
      archived: raw.archived,
      color: raw.color,
      pattern: raw.pattern,
      pinned: raw.pinned,
      expiresAt: raw.expiresAt,
      burnAfterReading: raw.burnAfterReading,
      tags,
      generation,
    };
    for (const key of cfg.contentKeys) head[key] = raw[key];
    return head as TierHeadRow;
  };

  const mapVersion = (raw: Record<string, unknown>, generation = currentRequestGeneration()): TierVersionRow => {
    const version: Record<string, unknown> = {
      _id: raw.id,
      title: raw.title,
      createdAt: raw.createdAt,
      generation,
    };
    for (const key of versions.contentKeys) version[key] = raw[key];
    return version as TierVersionRow;
  };

  // The generated tsvector is an implementation detail of search — it must
  // never ride along on a head read into the API response.
  const headColumns = (): Record<string, AnyPgColumn> => {
    const selection: Record<string, AnyPgColumn> = { ...cols };
    delete selection.searchTsv;
    for (const key of cfg.contentKeys) {
      selection[key] = (table as any)[key] as AnyPgColumn;
    }
    return selection;
  };

  const withTags = async (
    db: Db,
    raw: Record<string, unknown> | undefined,
    generation = currentRequestGeneration(),
  ): Promise<TierHeadRow | null> => {
    if (!raw) return null;
    const tagMap = await tagsFor(db, raw.userId as string, [raw.id as string]);
    return mapHead(raw, tagMap.get(raw.id as string) ?? [], generation);
  };

  const findRawById = async (db: Db, userId: string, id: string): Promise<Record<string, unknown> | undefined> => {
    const rows = (await (db as any).select(headColumns()).from(table).where(byId(userId, id)).limit(1)) as Record<
      string,
      unknown
    >[];
    return rows[0];
  };

  const updateHead = async (
    db: Db,
    userId: string,
    id: string,
    values: Record<string, unknown>,
  ): Promise<TierHeadRow | null> => {
    const rows = (await (db as any)
      .update(table)
      .set(values)
      .where(byId(userId, id))
      .returning(headColumns())) as Record<string, unknown>[];
    return withTags(db, rows[0]);
  };

  const replaceTags = async (db: Db, userId: string, noteId: string, tagIds: string[]): Promise<void> => {
    await (db as any).delete(join.table).where(childOf(join.cols, userId, noteId));
    if (tagIds.length > 0) {
      await (db as any)
        .insert(join.table)
        .values(tagIds.map((tagId, sortOrder) => ({ userId, noteId, tagId, sortOrder })));
    }
  };

  const hasVersions = async (db: Db, userId: string, noteId: string): Promise<boolean> => {
    const rows = (await (db as any)
      .select({ id: versions.cols.id })
      .from(versions.table)
      .where(childOf(versions.cols, userId, noteId))
      .limit(1)) as { id: string }[];
    return rows.length > 0;
  };

  // Insert a snapshot, then drop everything beyond the newest MAX_VERSIONS.
  const insertVersionCapped = async (
    db: Db,
    userId: string,
    noteId: string,
    values: Record<string, unknown>,
  ): Promise<void> => {
    await (db as any).insert(versions.table).values({ ...values, userId, noteId });
    const keep = (db as any)
      .select({ id: versions.cols.id })
      .from(versions.table)
      .where(childOf(versions.cols, userId, noteId))
      .orderBy(desc(versions.cols.seq))
      .limit(MAX_VERSIONS);
    await (db as any)
      .delete(versions.table)
      .where(and(childOf(versions.cols, userId, noteId), notInArray(versions.cols.id, keep)));
  };

  const getNextPosition = async (db: Db, userId: string): Promise<number> => {
    const rows = (await (db as any)
      .select({ position: cols.position })
      .from(table)
      .where(and(eq(cols.userId, userId), isNull(cols.deletedAt)))
      .orderBy(desc(cols.position))
      .limit(1)) as { position: number }[];
    return (rows[0]?.position ?? 0) + POSITION_STEP;
  };

  const writeById = <T>(userId: string, fn: () => Promise<T>): Promise<T> => withVaultWrite(userId, fn);

  return {
    async create(
      userId: string,
      data: Record<string, unknown>,
      color?: string | null,
      pattern?: string | null,
      tagIds?: string[],
    ): Promise<TierHeadRow> {
      return withVaultWrite(userId, async () =>
        getDb().transaction(async (tx: any) => {
          const now = new Date();
          const position = await getNextPosition(tx, userId);
          const rows = (await tx
            .insert(table)
            .values({
              userId,
              ...data,
              position,
              ...(color != null && { color }),
              ...(pattern != null && { pattern }),
              createdAt: now,
              updatedAt: now,
            })
            .returning(headColumns())) as Record<string, unknown>[];
          const row = rows[0];
          const appliedTags = Array.isArray(tagIds) && tagIds.length > 0 ? tagIds : [];
          if (appliedTags.length > 0) await replaceTags(tx, userId, row.id as string, appliedTags);
          return mapHead(row, appliedTags);
        }),
      );
    },

    async list(userId: string, opts: ListOptions = {}): Promise<TierHeadRow[]> {
      return withVaultRead(userId, async ({ generation }) => {
        const db = getDb();
        const { archived, limit = 30, offset = 0, search = '', tagIds, tagMode = 'or' } = opts;

        const conditions: SQL[] = [
          eq(cols.userId, userId) as SQL,
          isNull(cols.deletedAt) as SQL,
          or(isNull(cols.expiresAt), gt(cols.expiresAt, new Date())) as SQL,
        ];
        if (archived !== undefined) conditions.push(eq(cols.archived, archived) as SQL);

        if (tagIds && tagIds.length > 0) {
          if (tagMode === 'and') {
            conditions.push(
              sql`(select count(*) from ${join.table} where ${join.cols.userId} = ${cols.userId} and ${join.cols.noteId} = ${cols.id} and ${join.cols.tagId} in (${sql.join(
                tagIds.map((t) => sql`${t}`),
                sql`, `,
              )})) = ${tagIds.length}`,
            );
          } else {
            conditions.push(
              exists(
                (db as any)
                  .select({ one: sql`1` })
                  .from(join.table)
                  .where(
                    and(
                      eq(join.cols.userId, cols.userId),
                      eq(join.cols.noteId, cols.id),
                      inArray(join.cols.tagId, tagIds),
                    ),
                  ),
              ) as unknown as SQL,
            );
          }
        }

        const normalized = search.trim().slice(0, MAX_SEARCH);
        const tsquery = normalized ? buildPrefixTsQuery(normalized) : null;

        // A search that reduces to no searchable terms (punctuation only) matches
        // nothing, rather than silently listing everything.
        if (normalized && !tsquery) return [];

        // Search results rank by relevance — a title hit (weight A) outranks a
        // body hit (weight B) — then fall back to recency. Browsing without a
        // search term keeps the user's manual ordering.
        let orderBy: SQL[];
        if (tsquery) {
          const query = sql`to_tsquery('english', ${tsquery})`;
          conditions.push(sql`${cols.searchTsv} @@ ${query}` as SQL);
          orderBy = [
            desc(cols.pinned) as SQL,
            sql`ts_rank(${cols.searchTsv}, ${query}) desc`,
            desc(cols.updatedAt) as SQL,
          ];
        } else {
          orderBy = [desc(cols.pinned) as SQL, desc(cols.position) as SQL];
        }

        const rows = (await (db as any)
          .select(headColumns())
          .from(table)
          .where(and(...conditions))
          .orderBy(...orderBy)
          .offset(offset)
          .limit(limit)) as Record<string, unknown>[];

        const tagMap = await tagsFor(
          db,
          userId,
          rows.map((r) => r.id as string),
        );
        return rows.map((r) => mapHead(r, tagMap.get(r.id as string) ?? [], generation));
      });
    },

    async getByIdActive(userId: string, id: string): Promise<TierHeadRow | null> {
      return withVaultRead(userId, async ({ generation }) => {
        const db = getDb();
        const rows = (await (db as any)
          .select(headColumns())
          .from(table)
          .where(activeById(userId, id))
          .limit(1)) as Record<string, unknown>[];
        return withTags(db, rows[0], generation);
      });
    },

    async getVersionsByIdActive(
      userId: string,
      id: string,
    ): Promise<{ userId: string; versions: TierVersionRow[] } | null> {
      return withVaultRead(userId, async ({ generation }) => {
        const db = getDb();
        const heads = (await (db as any)
          .select({ id: cols.id, userId: cols.userId })
          .from(table)
          .where(activeById(userId, id))
          .limit(1)) as { id: string; userId: string }[];
        if (!heads[0]) return null;
        const rows = (await (db as any)
          .select()
          .from(versions.table)
          .where(childOf(versions.cols, userId, id))
          .orderBy(asc(versions.cols.seq))) as Record<string, unknown>[];
        return { userId: heads[0].userId, versions: rows.map((row) => mapVersion(row, generation)) };
      });
    },

    // Idempotent: deleting an id that's already gone still resolves to the
    // head. Null only when the parent note itself is missing/expired.
    async deleteVersionById(userId: string, id: string, versionId: string): Promise<TierHeadRow | null> {
      return writeById(userId, async () =>
        getDb().transaction(async (tx: any) => {
          const heads = (await tx.select(headColumns()).from(table).where(activeById(userId, id)).limit(1)) as Record<
            string,
            unknown
          >[];
          if (!heads[0]) return null;
          await tx
            .delete(versions.table)
            .where(and(childOf(versions.cols, userId, id), eq(versions.cols.id, versionId)));
          return withTags(tx, heads[0]);
        }),
      );
    },

    /**
     * Shared head-update flow with version recording. `compute` receives the
     * current raw head and decides what changes, whether the edit is a no-op
     * (nothing written, head returned as-is), and what pre-edit snapshot to
     * record (subject to the compression window).
     */
    async updateWithVersion(
      userId: string,
      id: string,
      compute: (head: Record<string, unknown>) => {
        changed: boolean;
        set: Record<string, unknown>;
        snapshot: (Record<string, unknown> & { createdAt: Date }) | null;
      },
    ): Promise<TierHeadRow | null> {
      return writeById(userId, async () =>
        getDb().transaction(async (tx: any) => {
          const head = await findRawById(tx, userId, id);
          if (!head) return null;

          const { changed, set, snapshot } = compute(head);
          if (!changed) return withTags(tx, head);

          if (snapshot) {
            if (shouldRecordVersion(await hasVersions(tx, userId, id), snapshot.createdAt)) {
              await insertVersionCapped(tx, userId, id, snapshot);
            }
          }

          return updateHead(tx, userId, id, { ...set, updatedAt: new Date() });
        }),
      );
    },

    /**
     * Restore a past version into the head. Always records a snapshot of the
     * current head first (so the restore is itself reversible) and bypasses
     * the compression window. The restored version row is left in place.
     */
    async restoreVersion(
      userId: string,
      id: string,
      versionId: string,
      setFromVersion: (version: Record<string, unknown>) => Record<string, unknown>,
      snapshotOfHead: (head: Record<string, unknown>) => Record<string, unknown>,
    ): Promise<TierHeadRow | null> {
      return writeById(userId, async () =>
        getDb().transaction(async (tx: any) => {
          const head = await findRawById(tx, userId, id);
          if (!head) return null;

          const versionRows = (await tx
            .select()
            .from(versions.table)
            .where(and(childOf(versions.cols, userId, id), eq(versions.cols.id, versionId)))
            .limit(1)) as Record<string, unknown>[];
          const version = versionRows[0];
          if (!version) return null;

          // Snapshot is stamped with when the pre-restore head was *saved*
          // (its updatedAt), not restore time.
          await insertVersionCapped(tx, userId, id, { ...snapshotOfHead(head), createdAt: head.updatedAt });

          return updateHead(tx, userId, id, { ...setFromVersion(version), updatedAt: new Date() });
        }),
      );
    },

    /** The discrete single-field mutations shared by all tiers (`commonOps`). */
    ops: {
      softDelete: (userId: string, id: string) =>
        writeById(userId, () => updateHead(getDb(), userId, id, { deletedAt: new Date() })),
      restore: (userId: string, id: string) =>
        writeById(userId, () => updateHead(getDb(), userId, id, { deletedAt: null })),
      archive: (userId: string, id: string) =>
        writeById(userId, () => updateHead(getDb(), userId, id, { archived: true })),
      unarchive: (userId: string, id: string) =>
        writeById(userId, () => updateHead(getDb(), userId, id, { archived: false })),
      updateColor: (userId: string, id: string, color: string | null) =>
        writeById(userId, () => updateHead(getDb(), userId, id, { color })),
      updatePattern: (userId: string, id: string, pattern: string | null) =>
        writeById(userId, () => updateHead(getDb(), userId, id, { pattern })),
      updatePosition: (userId: string, id: string, position: number) =>
        writeById(userId, () => updateHead(getDb(), userId, id, { position })),
      updateTags: async (userId: string, id: string, tagIds: string[]): Promise<TierHeadRow | null> =>
        writeById(userId, async () =>
          getDb().transaction(async (tx: any) => {
            const head = await findRawById(tx, userId, id);
            if (!head) return null;
            await replaceTags(tx, userId, id, tagIds);
            return mapHead(head, tagIds);
          }),
        ),
      applyPatch: (userId: string, id: string, update: MetaPatch) =>
        writeById(userId, () => updateHead(getDb(), userId, id, { ...update })),
    },

    /** Internals used by cross-tier queries (tag counts, orphan checks, erase). */
    _internal: { tagsFor, mapHead },
  };
}

export type TierRepo = ReturnType<typeof makeTierRepo>;
