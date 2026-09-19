/**
 * The authenticated account currently owning browser-local work.
 *
 * Server authorization still comes from the session cookie. This small client
 * fence exists for work that can outlive a React tree (queued writes, stable
 * render keys and draft checkpoints): after an account switch, work captured
 * under the previous revision must not run against the new session merely
 * because both accounts happen to hold the same portable record id.
 */
let userId: string | null = null;
let revision = 0;

export type AccountScope = Readonly<{ userId: string | null; revision: number }>;

export function activeAccountScope(): AccountScope {
  return { userId, revision };
}

export function setActiveAccountId(nextUserId: string | null): boolean {
  if (userId === nextUserId) return false;
  userId = nextUserId;
  revision += 1;
  return true;
}

export function accountScopeIsCurrent(scope: AccountScope): boolean {
  return scope.userId === userId && scope.revision === revision;
}
