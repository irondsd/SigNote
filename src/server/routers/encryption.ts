import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  createProfile,
  getMaterialByUserId,
  getProfileByUserId,
  ProfileAlreadyExistsError,
  updateProfile,
} from '@/controllers/encryptionProfiles';
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
