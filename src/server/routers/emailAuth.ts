import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { consumeSignInCode, requestSignInCode } from '@/controllers/emailSignInCodes';
import {
  claimEmailForUser,
  detachEmail,
  findUserIdByEmail,
  getUserEmail,
  normalizeEmail,
} from '@/controllers/userEmail';
import { getClientIp } from '@/lib/clientIp';
import { sendSignInCodeEmail } from '@/lib/notificationEmails';
import { protectedProcedure, publicProcedure, router } from '@/server/trpc';

const emailInput = z.object({ email: z.string().trim().toLowerCase().email().max(320) });
const codeInput = emailInput.extend({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

/** Rate limiting is the only thing standing between this and a mailbomb button. */
const RATE_LIMITED = 'Too many codes requested. Try again in a few minutes.';

export const emailAuthRouter = router({
  /**
   * Public: the sign-in flow. Deliberately returns the same thing whether or
   * not the address has an account — a code both signs in and creates one, so
   * there is no difference to leak.
   */
  requestCode: publicProcedure.input(emailInput).mutation(async ({ ctx, input }) => {
    const result = await requestSignInCode({ email: input.email, ip: getClientIp(ctx.req) });
    if (!result.ok) throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: RATE_LIMITED });

    // This one is not fire-and-forget: the user is staring at a code field.
    await sendSignInCodeEmail(input.email, result.code, result.expiresInMinutes);
    return { ok: true as const };
  }),

  /** What the sign-in methods list renders for the Email row. */
  status: protectedProcedure.query(({ ctx }) => getUserEmail(ctx.userId)),

  /**
   * Attaching an address to the account you are already signed in to. Unlike
   * the sign-in flow this *does* refuse a taken address up front — the caller
   * is a known user, so there is nothing to enumerate, and letting them burn a
   * code on an address they can never have is just cruel.
   */
  requestLinkCode: protectedProcedure.input(emailInput).mutation(async ({ ctx, input }) => {
    const current = await getUserEmail(ctx.userId);
    if (current.email) {
      throw new TRPCError({ code: 'CONFLICT', message: 'HAS_EMAIL' });
    }

    const holder = await findUserIdByEmail(input.email);
    if (holder && holder !== ctx.userId) {
      throw new TRPCError({ code: 'CONFLICT', message: 'TAKEN' });
    }

    const result = await requestSignInCode({ email: input.email, ip: getClientIp(ctx.req) });
    if (!result.ok) throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: RATE_LIMITED });

    await sendSignInCodeEmail(input.email, result.code, result.expiresInMinutes);
    return { ok: true as const };
  }),

  verifyLink: protectedProcedure.input(codeInput).mutation(async ({ ctx, input }) => {
    const outcome = await consumeSignInCode({ email: input.email, code: input.code });
    if (outcome !== 'ok') throw new TRPCError({ code: 'BAD_REQUEST', message: 'BAD_CODE' });

    // Nothing owns an address a mailbox proved, so it stays detachable.
    const claim = await claimEmailForUser({ userId: ctx.userId, email: input.email, ownerIdentityId: null });
    if (claim === 'taken-by-other-user') throw new TRPCError({ code: 'CONFLICT', message: 'TAKEN' });
    if (claim === 'user-has-email') throw new TRPCError({ code: 'CONFLICT', message: 'HAS_EMAIL' });

    return { email: normalizeEmail(input.email) };
  }),

  detach: protectedProcedure.mutation(async ({ ctx }) => {
    const outcome = await detachEmail(ctx.userId);
    if (outcome === 'owned') throw new TRPCError({ code: 'CONFLICT', message: 'OWNED_BY_IDENTITY' });
    if (outcome === 'last-credential') throw new TRPCError({ code: 'CONFLICT', message: 'LAST_CREDENTIAL' });
    return { ok: true as const };
  }),
});
