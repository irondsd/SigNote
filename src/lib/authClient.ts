export type SignInClient = 'web' | 'desktop';

/**
 * The NextAuth provider ids whose `authorize` runs inside the desktop app and
 * can therefore vouch for the client hint: SIWE (the unnamed credentials
 * provider) and the emailed code. Google never signs in from the webview —
 * its desktop sessions are minted by `createDesktopSession` after the browser
 * handoff, so the hint is meaningless for it. Passkeys are browser-only in
 * this phase, so their client hint is intentionally ignored too.
 */
const IN_APP_CREDENTIALS_PROVIDERS = new Set(['credentials', 'email-otp']);

/**
 * Selects display metadata for a newly issued NextAuth session. The hint is
 * informational only and must never be used as an authorization boundary.
 */
export function resolveSignInClient(provider: string | undefined, hint: unknown): SignInClient {
  return provider !== undefined && IN_APP_CREDENTIALS_PROVIDERS.has(provider) && hint === 'desktop' ? 'desktop' : 'web';
}
