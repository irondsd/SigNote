import { TRPCError } from '@trpc/server';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';

import { createChallenge, checkChallengeRateLimit, consumeChallenge } from '@/controllers/passkeyChallenges';
import { deletePasskey, getPasskeyUserLabel, insertPasskey, listPasskeys, renamePasskey } from '@/controllers/passkeys';
import { LastIdentityError } from '@/controllers/identities';
import { getClientIp } from '@/lib/clientIp';
import {
  makeAuthenticationOptions,
  makeRegistrationOptions,
  readWebAuthnChallenge,
  verifyPasskeyRegistration,
} from '@/lib/passkeys';
import { protectedProcedure, publicProcedure, router } from '@/server/trpc';

const registrationResponse = z.custom<RegistrationResponseJSON>(
  (value) => typeof value === 'object' && value !== null && 'id' in value && 'response' in value,
  'Invalid passkey response',
);

const idInput = z.object({ id: z.string().min(1).max(128) });
const RATE_LIMITED = 'Too many passkey requests. Try again in a few minutes.';

async function enforceRateLimit(ip: string) {
  if (!(await checkChallengeRateLimit(ip))) {
    throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: RATE_LIMITED });
  }
}

export const passkeysRouter = router({
  signInOptions: publicProcedure.mutation(async ({ ctx }) => {
    const ip = getClientIp(ctx.req);
    await enforceRateLimit(ip);
    const options = await makeAuthenticationOptions();
    await createChallenge({ challenge: options.challenge, kind: 'authenticate', userId: null, ip });
    return options;
  }),

  signUpOptions: publicProcedure.mutation(async ({ ctx }) => {
    const ip = getClientIp(ctx.req);
    await enforceRateLimit(ip);
    const provisionalUserId = uuidv7();
    const options = await makeRegistrationOptions({
      userId: provisionalUserId,
      userName: 'SigNote user',
      userDisplayName: 'SigNote user',
    });
    await createChallenge({
      challenge: options.challenge,
      kind: 'signup',
      userId: provisionalUserId,
      ip,
    });
    return options;
  }),

  registrationOptions: protectedProcedure.mutation(async ({ ctx }) => {
    const ip = getClientIp(ctx.req);
    await enforceRateLimit(ip);
    const [displayName, existing] = await Promise.all([getPasskeyUserLabel(ctx.userId), listPasskeys(ctx.userId)]);
    if (!displayName) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });

    const options = await makeRegistrationOptions({
      userId: ctx.userId,
      userName: displayName,
      userDisplayName: displayName,
      excludeCredentialIds: existing.map((passkey) => passkey.credentialId),
    });
    await createChallenge({ challenge: options.challenge, kind: 'register', userId: ctx.userId, ip });
    return options;
  }),

  finishRegistration: protectedProcedure
    .input(
      z.object({
        response: registrationResponse,
        nickname: z.string().trim().min(1).max(50).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const challenge = readWebAuthnChallenge(input.response);
        if (!challenge) throw new Error('Missing challenge');
        const record = await consumeChallenge({ challenge, kind: 'register', userId: ctx.userId });
        if (!record) throw new Error('Invalid challenge');

        const verified = await verifyPasskeyRegistration(input.response, record.challenge);
        if (!verified) throw new Error('Invalid registration');
        const nickname = input.nickname?.trim() || (verified.backedUp ? 'Synced passkey' : 'Passkey');
        const passkey = await insertPasskey({ userId: ctx.userId, ...verified, nickname });
        return { passkey };
      } catch (error) {
        // Keep one public error to avoid credential/account enumeration, but
        // retain the real failure server-side for operations and debugging.
        console.error('[passkeys] registration failed:', error);
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'PASSKEY_REGISTRATION_FAILED' });
      }
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const passkeys = await listPasskeys(ctx.userId);
    return passkeys.map((passkey) => ({
      id: passkey.id,
      nickname: passkey.nickname,
      deviceType: passkey.deviceType,
      backedUp: passkey.backedUp,
      createdAt: passkey.createdAt,
      updatedAt: passkey.updatedAt,
      lastUsedAt: passkey.lastUsedAt,
    }));
  }),

  rename: protectedProcedure
    .input(idInput.extend({ nickname: z.string().trim().min(1).max(50) }))
    .mutation(async ({ ctx, input }) => {
      const renamed = await renamePasskey(ctx.userId, input.id, input.nickname);
      if (!renamed) throw new TRPCError({ code: 'NOT_FOUND', message: 'Passkey not found' });
      return { ok: true as const };
    }),

  remove: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      const deleted = await deletePasskey(ctx.userId, input.id);
      if (!deleted) throw new TRPCError({ code: 'NOT_FOUND', message: 'Passkey not found' });
      return { ok: true as const };
    } catch (error) {
      if (error instanceof LastIdentityError) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'LAST_IDENTITY' });
      }
      throw error;
    }
  }),
});
