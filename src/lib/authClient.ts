export type SignInClient = 'web' | 'desktop';

/**
 * Selects display metadata for a newly issued NextAuth session. The hint is
 * informational only and must never be used as an authorization boundary.
 */
export function resolveSignInClient(provider: string | undefined, hint: unknown): SignInClient {
  return provider === 'credentials' && hint === 'desktop' ? 'desktop' : 'web';
}
