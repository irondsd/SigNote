export const LAST_SIGN_IN_METHOD_KEY = 'signote-last-sign-in-method';

export type SignInMethod = 'google' | 'email' | 'siwe' | 'passkey';

const isSignInMethod = (value: string | null): value is SignInMethod =>
  value === 'google' || value === 'email' || value === 'siwe' || value === 'passkey';

export function getLastSignInMethod(): SignInMethod | null {
  if (typeof window === 'undefined') return null;

  try {
    const value = window.localStorage.getItem(LAST_SIGN_IN_METHOD_KEY);
    return isSignInMethod(value) ? value : null;
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
    return null;
  }
}

export function rememberLastSignInMethod(method: SignInMethod): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(LAST_SIGN_IN_METHOD_KEY, method);
  } catch {
    // Remembering the hint is optional; sign-in must still work without it.
  }
}
