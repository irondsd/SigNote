import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { MAX_OTP_CIPHER, MAX_OTP_RECORDS_PER_USER, OTP_PAYLOAD_VERSION } from '@/config/constants';
import {
  createOtpRecord,
  deleteOtpRecord,
  listOtpRecords,
  OtpConflictError,
  OtpLimitError,
  reorderOtpRecords,
  updateOtpRecord,
  type OtpRecordRow,
} from '@/controllers/otpRecords';
import { objectId } from '@/server/schemas/common';
import { protectedProcedure, router } from '@/server/trpc';

/**
 * Authenticator synchronisation.
 *
 * Deliberately *not* built on `encryptedPayload` from schemas/common: that caps
 * ciphertext at MAX_CIPHER, which is sized for note bodies. An OTP envelope is a
 * few hundred bytes, so a note-sized cap would turn this table into free blob
 * storage. The per-user record cap exists for the same reason.
 */
const otpPayload = z.object({
  alg: z.literal('A256GCM'),
  iv: z.string().max(64),
  ciphertext: z.string().min(1).max(MAX_OTP_CIPHER),
});

const revision = z.number().int().positive();
const position = z.number().finite();

/** Dates cross the wire as ISO strings; there is no superjson transformer here. */
const toWire = (row: OtpRecordRow) => ({
  id: row.id,
  payload: row.payload,
  payloadVersion: row.payloadVersion,
  position: row.position,
  revision: row.revision,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  deletedAt: row.deletedAt?.toISOString() ?? null,
});

export type OtpWireRecord = ReturnType<typeof toWire>;

/** Re-throws a repository conflict as a 409 carrying the current row. */
function rethrow(err: unknown): never {
  if (err instanceof OtpConflictError) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: err.message,
      cause: err,
    });
  }
  if (err instanceof OtpLimitError) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `An account can hold at most ${MAX_OTP_RECORDS_PER_USER} authenticator records`,
    });
  }
  throw err;
}

export const otpRouter = router({
  /**
   * `serverTime` rides along on every snapshot. TOTP is only as good as the
   * device clock, and a device minutes adrift produces codes every service
   * silently rejects — so the client stores the offset and generates from
   * corrected time rather than trusting `Date.now()` alone.
   */
  time: protectedProcedure.query(() => ({ serverTime: Date.now() })),

  /** The full snapshot, tombstones included. See `listOtpRecords`. */
  list: protectedProcedure.query(async ({ ctx }) => ({
    records: (await listOtpRecords(ctx.userId)).map(toWire),
    serverTime: Date.now(),
  })),

  create: protectedProcedure
    .input(
      z.object({
        id: objectId,
        payload: otpPayload,
        payloadVersion: z.number().int().positive().default(OTP_PAYLOAD_VERSION),
        position,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return toWire(await createOtpRecord(ctx.userId, input));
      } catch (err) {
        rethrow(err);
      }
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: objectId,
        expectedRevision: revision,
        payload: otpPayload.optional(),
        position: position.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return toWire(await updateOtpRecord(ctx.userId, input));
      } catch (err) {
        rethrow(err);
      }
    }),

  remove: protectedProcedure
    .input(z.object({ id: objectId, expectedRevision: revision }))
    .mutation(async ({ ctx, input }) => {
      try {
        return toWire(await deleteOtpRecord(ctx.userId, input.id, input.expectedRevision));
      } catch (err) {
        rethrow(err);
      }
    }),

  /** Whole-list reorder. Positions are the client's to choose. */
  reorder: protectedProcedure
    .input(z.object({ items: z.array(z.object({ id: objectId, position })).max(MAX_OTP_RECORDS_PER_USER) }))
    .mutation(async ({ ctx, input }) => ({
      records: (await reorderOtpRecords(ctx.userId, input.items)).map(toWire),
    })),
});
