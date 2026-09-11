import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  createProfile,
  getMaterialByUserId,
  getProfileByUserId,
  ProfileAlreadyExistsError,
  updateProfile,
} from '@/controllers/encryptionProfiles';
import { getEncryptionState } from '@/db/encryptionState';
import { rotationStartEnabled } from '@/server/rotation/enablement';
import { protectedProcedure, router } from '@/server/trpc';

const BASE64_32 = /^[A-Za-z0-9+/]{43}=$/; // 32 bytes → 44-char base64
const BASE64_12 = /^[A-Za-z0-9+/]{16}$/; // 12 bytes → 16-char base64, no padding
const BASE64 = /^[A-Za-z0-9+/]+=*$/; // any non-empty base64

const base64_32 = z.string().regex(BASE64_32);
const keyCheck = z.object({
  alg: z.literal('A256GCM'),
  iv: z.string().regex(BASE64_12),
  ciphertext: z.string().regex(BASE64),
});
const kdf = z.object({
  name: z.literal('PBKDF2'),
  // The client only ever derives with SHA-256 (lib/crypto.ts) and the stored
  // KdfParams type assumes it. The old REST route's SHA-512 allowance was
  // defensive dead code that bypassed the type via a cast — intentionally
  // tightened here so create input matches what the system actually supports.
  hash: z.literal('SHA-256'),
  iterations: z.number().int().min(100_000, 'kdf.iterations must be an integer ≥ 100000'),
  length: z.number().positive(),
});

export const encryptionRouter = router({
  /**
   * The one encryption read that is *not* generation-gated, and the only way a
   * device with no marker can learn which generation to claim. Every other
   * procedure refuses a request whose header disagrees with the account state,
   * so bootstrapping through one of them would be a deadlock: you cannot learn
   * the number without already knowing it.
   *
   * It discloses nothing an authenticated owner cannot already read — a counter
   * and whether their own vault is frozen — and deliberately no pending
   * rotation material, so the app's boot path never carries the next
   * generation's `serverShare`.
   */
  generation: protectedProcedure.query(async ({ ctx }) => {
    const state = await getEncryptionState(ctx.userId);
    return {
      generation: state.generation,
      rotationInProgress: state.activeRotationId !== null,
      // Whether a *new* rotation may be started. Disabling the feature never
      // hides an operation already under way: status, resume and cancel keep
      // working, so this only decides whether the entry point is offered.
      rotationAvailable: rotationStartEnabled(),
    };
  }),

  // GET /api/encryption/material — server share + KDF params for unlock.
  material: protectedProcedure.query(async ({ ctx }) => {
    const material = await getMaterialByUserId(ctx.userId);
    if (!material) throw new TRPCError({ code: 'NOT_FOUND', message: 'Encryption profile not found' });
    return {
      version: material.version,
      serverShare: material.serverShare,
      salt: material.salt,
      kdf: material.kdf,
      keyCheck: material.keyCheck,
    };
  }),

  // GET /api/encryption/profile — public-ish profile shape (no serverShare).
  profile: protectedProcedure.query(async ({ ctx }) => {
    const profile = await getProfileByUserId(ctx.userId);
    if (!profile) return { exists: false as const };
    return {
      exists: true as const,
      // The profile *generation*, and the only remote kill switch the
      // authenticator has. A passphrase change and a recovery restore update
      // this row in place; only an encryption reset creates a new one, so a
      // changed id is exactly the signal an enrolled device must wipe on. The
      // id is an opaque uuid and not secret.
      profileId: profile._id,
      // The *generation* is the second kill switch, and the one a rotation
      // moves. A rotation deliberately keeps `profileId` stable — the account
      // was not reset, only re-keyed — so a device comparing the id alone would
      // accept new-generation ciphertext it cannot read. Read under the same
      // lock as the snapshot, so it always describes this response.
      generation: profile.generation,
      version: profile.version,
      salt: profile.salt,
      kdf: profile.kdf,
      keyCheck: profile.keyCheck,
    };
  }),

  create: protectedProcedure
    .input(z.object({ version: z.number(), serverShare: base64_32, salt: base64_32, kdf, keyCheck }))
    .mutation(async ({ ctx, input }) => {
      try {
        const profile = await createProfile(ctx.userId, input);
        return { success: true as const, version: profile.version };
      } catch (err) {
        if (err instanceof ProfileAlreadyExistsError) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Encryption profile already exists' });
        }
        throw err;
      }
    }),

  update: protectedProcedure
    .input(z.object({ serverShare: base64_32, salt: base64_32, keyCheck }))
    .mutation(async ({ ctx, input }) => {
      await updateProfile(ctx.userId, input);
      return { success: true as const };
    }),
});
