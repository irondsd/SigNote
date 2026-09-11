import { protectedProcedure, publicProcedure, router } from '../trpc';
import { emailAuthRouter } from './emailAuth';
import { encryptionRouter } from './encryption';
import { eraseRouter } from './erase';
import { identitiesRouter } from './identities';
import { notesRouter } from './notes';
import { notificationsRouter } from './notifications';
import { otpRouter } from './otp';
import { passkeysRouter } from './passkeys';
import { profileRouter } from './profile';
import { sealsRouter } from './seals';
import { securityRouter } from './security';
import { secretsRouter } from './secrets';
import { sessionsRouter } from './sessions';
import { tagsRouter } from './tags';
import { rotationRouter } from './rotation';

export const appRouter = router({
  // Liveness probe. `health` is public; `me` proves the auth middleware works.
  health: publicProcedure.query(() => ({ ok: true as const })),
  me: protectedProcedure.query(({ ctx }) => ({ userId: ctx.userId })),
  notes: notesRouter,
  secrets: secretsRouter,
  seals: sealsRouter,
  tags: tagsRouter,
  sessions: sessionsRouter,
  profile: profileRouter,
  notifications: notificationsRouter,
  security: securityRouter,
  emailAuth: emailAuthRouter,
  identities: identitiesRouter,
  encryption: encryptionRouter,
  erase: eraseRouter,
  otp: otpRouter,
  passkeys: passkeysRouter,
  rotation: rotationRouter,
});

export type AppRouter = typeof appRouter;
