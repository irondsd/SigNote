import { protectedProcedure, publicProcedure, router } from '../trpc';
import { encryptionRouter } from './encryption';
import { eraseRouter } from './erase';
import { identitiesRouter } from './identities';
import { notesRouter } from './notes';
import { profileRouter } from './profile';
import { sealsRouter } from './seals';
import { secretsRouter } from './secrets';
import { sessionsRouter } from './sessions';
import { tagsRouter } from './tags';

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
  identities: identitiesRouter,
  encryption: encryptionRouter,
  erase: eraseRouter,
});

export type AppRouter = typeof appRouter;
