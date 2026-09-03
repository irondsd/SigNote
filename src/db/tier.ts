/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, asc, desc, eq, exists, gt, inArray, isNull, notInArray, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, AnyPgTable } from 'drizzle-orm/pg-core';

import { MAX_SEARCH, MAX_VERSIONS, POSITION_STEP, VERSION_COMPRESSION_WINDOW_MS } from '@/config/constants';
import { getDb, type Db } from './client';

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
} & Record<string, unknown>;

export type TierVersionRow = {
  _id: string;
  title: string;
  createdAt: Date;
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
    cols: { id: AnyPgColumn; seq: AnyPgColumn; noteId: AnyPgColumn; title: AnyPgColumn; createdAt: AnyPgColumn };
    contentKeys: string[];
  };
  join: {
    table: AnyPgTable;
    cols: { noteId: AnyPgColumn; tagId: AnyPgColumn; sortOrder: AnyPgColumn };
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

/** Version compression: a snapshot landing within the window of the previous
 *  version is suppressed so an autosave burst counts as one version. */
export function shouldRecordVersion(lastCreatedAt: Date | null, snapshotCreatedAt: Date): boolean {
  return (
    lastCreatedAt === null || snapshotCreatedAt.getTime() - lastCreatedAt.getTime() >= VERSION_COMPRESSION_WINDOW_MS
  );
}

export function makeTierRepo(cfg: TierConfig) {
  const { table, cols, versions, join } = cfg;

  const activeById = (id: string): SQL =>
    and(eq(cols.id, id), or(isNull(cols.expiresAt), gt(cols.expiresAt, new Date(Date.now() - EXPIRY_GRACE_MS)))) as SQL;

  const tagsFor = async (db: Db, noteIds: string[]): Promise<Map<string, string[]>> => {
    const map = new Map<string, string[]>();
    if (noteIds.length === 0) return map;
    const rows = (await (db as any)
      .select({ noteId: join.cols.noteId, tagId: join.cols.tagId })
      .from(join.table)
      .where(inArray(join.cols.noteId, noteIds))
      .orderBy(asc(join.cols.noteId), asc(join.cols.sortOrder))) as { noteId: string; tagId: string }[];
    for (const row of rows) {
      const list = map.get(row.noteId);
      if (list) list.push(row.tagId);
      else map.set(row.noteId, [row.tagId]);
    }
    return map;
  };

  const mapHead = (raw: Record<string, unknown>, tags: string[]): TierHeadRow => {
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
    };
    for (const key of cfg.contentKeys) head[key] = raw[key];
    return head as TierHeadRow;
  };

  const mapVersion = (raw: Record<string, unknown>): TierVersionRow => {
    const version: Record<string, unknown> = {
      _id: raw.id,
      title: raw.title,
      createdAt: raw.createdAt,
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

  const withTags = async (db: Db, raw: Record<string, unknown> | undefined): Promise<TierHeadRow | null> => {
    if (!raw) return null;
    const tagMap = await tagsFor(db, [raw.id as string]);
    return mapHead(raw, tagMap.get(raw.id as string) ?? []);
  };

  const findRawById = async (db: Db, id: string): Promise<Record<string, unknown> | undefined> => {
    const rows = (await (db as any).select(headColumns()).from(table).where(eq(cols.id, id)).limit(1)) as Record<
      string,
      unknown
    >[];
    return rows[0];
  };

  const updateHead = async (db: Db, id: string, values: Record<string, unknown>): Promise<TierHeadRow | null> => {
    const rows = (await (db as any)
      .update(table)
      .set(values)
      .where(eq(cols.id, id))
      .returning(headColumns())) as Record<string, unknown>[];
    return withTags(db, rows[0]);
  };

  const replaceTags = async (db: Db, noteId: string, tagIds: string[]): Promise<void> => {
    await (db as any).delete(join.table).where(eq(join.cols.noteId, noteId));
    if (tagIds.length > 0) {
      await (db as any).insert(join.table).values(tagIds.map((tagId, sortOrder) => ({ noteId, tagId, sortOrder })));
    }
  };

  const latestVersionCreatedAt = async (db: Db, noteId: string): Promise<Date | null> => {
    const rows = (await (db as any)
      .select({ createdAt: versions.cols.createdAt })
      .from(versions.table)
      .where(eq(versions.cols.noteId, noteId))
      .orderBy(desc(versions.cols.seq))
      .limit(1)) as { createdAt: Date }[];
    return rows[0]?.createdAt ?? null;
  };

  // Insert a snapshot, then drop everything beyond the newest MAX_VERSIONS.
  const insertVersionCapped = async (db: Db, noteId: string, values: Record<string, unknown>): Promise<void> => {
    await (db as any).insert(versions.table).values({ ...values, noteId });
    const keep = (db as any)
      .select({ id: versions.cols.id })
      .from(versions.table)
      .where(eq(versions.cols.noteId, noteId))
      .orderBy(desc(versions.cols.seq))
      .limit(MAX_VERSIONS);
    await (db as any)
      .delete(versions.table)
      .where(and(eq(versions.cols.noteId, noteId), notInArray(versions.cols.id, keep)));
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

  return {
    async create(
      userId: string,
      data: Record<string, unknown>,
      color?: string | null,
      pattern?: string | null,
      tagIds?: string[],
    ): Promise<TierHeadRow> {
      return getDb().transaction(async (tx: any) => {
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
        if (appliedTags.length > 0) await replaceTags(tx, row.id as string, appliedTags);
        return mapHead(row, appliedTags);
      });
    },

    async list(userId: string, opts: ListOptions = {}): Promise<TierHeadRow[]> {
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
            sql`(select count(*) from ${join.table} where ${join.cols.noteId} = ${cols.id} and ${join.cols.tagId} in (${sql.join(
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
                .where(and(eq(join.cols.noteId, cols.id), inArray(join.cols.tagId, tagIds))),
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
        rows.map((r) => r.id as string),
      );
      return rows.map((r) => mapHead(r, tagMap.get(r.id as string) ?? []));
    },

    async getByIdActive(id: string): Promise<TierHeadRow | null> {
      const db = getDb();
      const rows = (await (db as any).select(headColumns()).from(table).where(activeById(id)).limit(1)) as Record<
        string,
        unknown
      >[];
      return withTags(db, rows[0]);
    },

    async getVersionsByIdActive(id: string): Promise<{ userId: string; versions: TierVersionRow[] } | null> {
      const db = getDb();
      const heads = (await (db as any)
        .select({ id: cols.id, userId: cols.userId })
        .from(table)
        .where(activeById(id))
        .limit(1)) as { id: string; userId: string }[];
      if (!heads[0]) return null;
      const rows = (await (db as any)
        .select()
        .from(versions.table)
        .where(eq(versions.cols.noteId, id))
        .orderBy(asc(versions.cols.seq))) as Record<string, unknown>[];
      return { userId: heads[0].userId, versions: rows.map(mapVersion) };
    },

    // Idempotent: deleting an id that's already gone still resolves to the
    // head. Null only when the parent note itself is missing/expired.
    async deleteVersionById(id: string, versionId: string): Promise<TierHeadRow | null> {
      return getDb().transaction(async (tx: any) => {
        const heads = (await tx.select(headColumns()).from(table).where(activeById(id)).limit(1)) as Record<
          string,
          unknown
        >[];
        if (!heads[0]) return null;
        await tx.delete(versions.table).where(and(eq(versions.cols.noteId, id), eq(versions.cols.id, versionId)));
        return withTags(tx, heads[0]);
      });
    },

    /**
     * Shared head-update flow with version recording. `compute` receives the
     * current raw head and decides what changes, whether the edit is a no-op
     * (nothing written, head returned as-is), and what pre-edit snapshot to
     * record (subject to the compression window).
     */
    async updateWithVersion(
      id: string,
      compute: (head: Record<string, unknown>) => {
        changed: boolean;
        set: Record<string, unknown>;
        snapshot: (Record<string, unknown> & { createdAt: Date }) | null;
      },
    ): Promise<TierHeadRow | null> {
      return getDb().transaction(async (tx: any) => {
        const head = await findRawById(tx, id);
        if (!head) return null;

        const { changed, set, snapshot } = compute(head);
        if (!changed) return withTags(tx, head);

        if (snapshot) {
          const last = await latestVersionCreatedAt(tx, id);
          if (shouldRecordVersion(last, snapshot.createdAt)) {
            await insertVersionCapped(tx, id, snapshot);
          }
        }

        return updateHead(tx, id, { ...set, updatedAt: new Date() });
      });
    },

    /**
     * Restore a past version into the head. Always records a snapshot of the
     * current head first (so the restore is itself reversible) and bypasses
     * the compression window. The restored version row is left in place.
     */
    async restoreVersion(
      id: string,
      versionId: string,
      setFromVersion: (version: Record<string, unknown>) => Record<string, unknown>,
      snapshotOfHead: (head: Record<string, unknown>) => Record<string, unknown>,
    ): Promise<TierHeadRow | null> {
      return getDb().transaction(async (tx: any) => {
        const head = await findRawById(tx, id);
        if (!head) return null;

        const versionRows = (await tx
          .select()
          .from(versions.table)
          .where(and(eq(versions.cols.noteId, id), eq(versions.cols.id, versionId)))
          .limit(1)) as Record<string, unknown>[];
        const version = versionRows[0];
        if (!version) return null;

        // Snapshot is stamped with when the pre-restore head was *saved*
        // (its updatedAt), not restore time.
        await insertVersionCapped(tx, id, { ...snapshotOfHead(head), createdAt: head.updatedAt });

        return updateHead(tx, id, { ...setFromVersion(version), updatedAt: new Date() });
      });
    },

    /** The discrete single-field mutations shared by all tiers (`commonOps`). */
    ops: {
      softDelete: (id: string) => updateHead(getDb(), id, { deletedAt: new Date() }),
      restore: (id: string) => updateHead(getDb(), id, { deletedAt: null }),
      archive: (id: string) => updateHead(getDb(), id, { archived: true }),
      unarchive: (id: string) => updateHead(getDb(), id, { archived: false }),
      updateColor: (id: string, color: string | null) => updateHead(getDb(), id, { color }),
      updatePattern: (id: string, pattern: string | null) => updateHead(getDb(), id, { pattern }),
      updatePosition: (id: string, position: number) => updateHead(getDb(), id, { position }),
      updateTags: async (id: string, tagIds: string[]): Promise<TierHeadRow | null> =>
        getDb().transaction(async (tx: any) => {
          const head = await findRawById(tx, id);
          if (!head) return null;
          await replaceTags(tx, id, tagIds);
          return mapHead(head, tagIds);
        }),
      applyPatch: (id: string, update: MetaPatch) => updateHead(getDb(), id, { ...update }),
    },

    /** Internals used by cross-tier queries (tag counts, orphan checks, erase). */
    _internal: { tagsFor, mapHead },
  };
}

export type TierRepo = ReturnType<typeof makeTierRepo>;
