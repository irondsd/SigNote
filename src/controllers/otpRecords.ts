import { and, count, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';

import { MAX_OTP_RECORDS_PER_USER } from '@/config/constants';
import { getDb } from '@/db/client';
import { otpRecords } from '@/db/schema';
import type { NoteColor, NotePattern } from '@/config/noteStyles';
import type { EncryptedPayload } from '@/types/crypto';

/**
 * Repository for the authenticator's encrypted rows.
 *
 * The server is a synchronisation point and nothing more: it never sees a seed,
 * an issuer or a generated code. Its whole job is to hand back a consistent
 * snapshot and to reject a write that raced another device.
 *
 * Ownership is a predicate on every statement, not a lookup followed by a
 * check — a `WHERE id = ? AND user_id = ?` that matches nothing is
 * indistinguishable from a row that does not exist, which is the response an
 * unauthorised caller should get.
 */

export type OtpRecordRow = {
  id: string;
  payload: EncryptedPayload | null;
  payloadVersion: number;
  position: number;
  revision: number;
  archived: boolean;
  color: NoteColor | null;
  pattern: NotePattern | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

/** Presentation fields, plaintext columns rather than envelope contents. */
export type OtpStyle = {
  archived?: boolean;
  color?: NoteColor | null;
  pattern?: NotePattern | null;
};

const columns = {
  id: otpRecords.id,
  payload: otpRecords.payload,
  payloadVersion: otpRecords.payloadVersion,
  position: otpRecords.position,
  revision: otpRecords.revision,
  archived: otpRecords.archived,
  color: otpRecords.color,
  pattern: otpRecords.pattern,
  createdAt: otpRecords.createdAt,
  updatedAt: otpRecords.updatedAt,
  deletedAt: otpRecords.deletedAt,
};

export class OtpConflictError extends Error {
  /** The row as it actually is, so the client can re-apply or discard its edit. */
  readonly current: OtpRecordRow | null;

  constructor(message: string, current: OtpRecordRow | null) {
    super(message);
    this.name = 'OtpConflictError';
    this.current = current;
  }

  /** Read by the tRPC error formatter; see `ConflictCause` in server/trpc.ts. */
  get conflictData(): OtpRecordRow | null {
    return this.current;
  }
}

export class OtpLimitError extends Error {
  constructor() {
    super('Authenticator record limit reached');
    this.name = 'OtpLimitError';
  }
}

/**
 * The full snapshot, tombstones included. v1 has no incremental feed: an
 * authenticator holds tens of rows of a few hundred bytes, so a snapshot costs
 * nothing and removes every reconciliation edge case. A record the client holds
 * that is absent here was purged server-side and should be dropped locally.
 */
export const listOtpRecords = async (userId: string): Promise<OtpRecordRow[]> =>
  getDb().select(columns).from(otpRecords).where(eq(otpRecords.userId, userId)).orderBy(otpRecords.position);

const getRecord = async (userId: string, id: string): Promise<OtpRecordRow | null> => {
  const rows = await getDb()
    .select(columns)
    .from(otpRecords)
    .where(and(eq(otpRecords.id, id), eq(otpRecords.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
};

export const countLiveOtpRecords = async (userId: string): Promise<number> => {
  const rows = await getDb()
    .select({ n: count() })
    .from(otpRecords)
    .where(and(eq(otpRecords.userId, userId), isNull(otpRecords.deletedAt)));
  return rows[0]?.n ?? 0;
};

type CreateInput = {
  id: string;
  payload: EncryptedPayload;
  payloadVersion: number;
  position: number;
} & OtpStyle;

/**
 * Insert-only. A create whose id already exists — live *or* tombstoned — is a
 * conflict rather than an upsert: reusing a tombstoned id would resurrect a
 * deleted credential, and reusing a live one would silently overwrite it.
 */
export const createOtpRecord = async (userId: string, input: CreateInput): Promise<OtpRecordRow> => {
  const db = getDb();

  // Anti-abuse, not a security boundary: two concurrent creates can both pass
  // this check and land one over the cap. That is fine — the point is to stop
  // the table being used as free blob storage, not to enforce an exact number.
  if ((await countLiveOtpRecords(userId)) >= MAX_OTP_RECORDS_PER_USER) throw new OtpLimitError();

  const now = new Date();
  const rows = await db
    .insert(otpRecords)
    .values({
      id: input.id,
      userId,
      payload: input.payload,
      payloadVersion: input.payloadVersion,
      position: input.position,
      archived: input.archived ?? false,
      color: input.color ?? null,
      pattern: input.pattern ?? null,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: otpRecords.id })
    .returning(columns);

  const row = rows[0];
  if (row) return row;

  // The id exists. It may belong to another user, in which case the caller
  // learns only that the id is taken — never whose it is.
  throw new OtpConflictError('A record with this id already exists', await getRecord(userId, input.id));
};

type UpdateInput = {
  id: string;
  expectedRevision: number;
  payload?: EncryptedPayload;
  position?: number;
} & OtpStyle;

/**
 * Compare-and-set on `revision`. Zero rows updated means the caller's view is
 * stale — either another device wrote first, or the record has been deleted —
 * so the current row travels back with the conflict.
 */
export const updateOtpRecord = async (userId: string, input: UpdateInput): Promise<OtpRecordRow> => {
  const patch: Record<string, unknown> = { revision: sql`${otpRecords.revision} + 1`, updatedAt: new Date() };
  if (input.payload !== undefined) patch.payload = input.payload;
  if (input.position !== undefined) patch.position = input.position;
  if (input.archived !== undefined) patch.archived = input.archived;
  if (input.color !== undefined) patch.color = input.color;
  if (input.pattern !== undefined) patch.pattern = input.pattern;

  // Only the revision bump left: the caller asked for nothing.
  if (Object.keys(patch).length === 2) throw new Error('updateOtpRecord: nothing to update');

  const rows = await getDb()
    .update(otpRecords)
    .set(patch)
    .where(
      and(
        eq(otpRecords.id, input.id),
        eq(otpRecords.userId, userId),
        eq(otpRecords.revision, input.expectedRevision),
        isNull(otpRecords.deletedAt),
      ),
    )
    .returning(columns);

  const row = rows[0];
  if (row) return row;
  throw new OtpConflictError('The record changed elsewhere', await getRecord(userId, input.id));
};

/**
 * Soft delete: the row stays as a tombstone with its payload dropped, and the
 * revision advances so the deletion wins over any edit still in flight.
 */
export const deleteOtpRecord = async (userId: string, id: string, expectedRevision: number): Promise<OtpRecordRow> => {
  const now = new Date();
  const rows = await getDb()
    .update(otpRecords)
    .set({ payload: null, deletedAt: now, updatedAt: now, revision: sql`${otpRecords.revision} + 1` })
    .where(
      and(
        eq(otpRecords.id, id),
        eq(otpRecords.userId, userId),
        eq(otpRecords.revision, expectedRevision),
        isNull(otpRecords.deletedAt),
      ),
    )
    .returning(columns);

  const row = rows[0];
  if (row) return row;
  throw new OtpConflictError('The record changed elsewhere', await getRecord(userId, id));
};

/**
 * Whole-list reorder, in one transaction: a half-applied reorder would leave the
 * list in an order neither device asked for. Unknown, foreign and tombstoned
 * ids simply match nothing — a reorder is not a way to discover them.
 */
export const reorderOtpRecords = async (
  userId: string,
  items: { id: string; position: number }[],
): Promise<OtpRecordRow[]> => {
  if (items.length === 0) return listOtpRecords(userId);

  const now = new Date();
  await getDb().transaction(async (tx) => {
    for (const item of items) {
      await tx
        .update(otpRecords)
        .set({ position: item.position, updatedAt: now, revision: sql`${otpRecords.revision} + 1` })
        .where(and(eq(otpRecords.id, item.id), eq(otpRecords.userId, userId), isNull(otpRecords.deletedAt)));
    }
  });

  return listOtpRecords(userId);
};

/** Purges tombstones older than the cutoff. Called from the cleanup sweep. */
export const purgeOtpTombstones = async (cutoff: Date): Promise<number> => {
  const rows = await getDb()
    .delete(otpRecords)
    .where(and(isNotNull(otpRecords.deletedAt), lt(otpRecords.deletedAt, cutoff)))
    .returning({ id: otpRecords.id });
  return rows.length;
};
