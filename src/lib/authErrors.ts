/**
 * Copy for the sign-in error page (`/auth/error`).
 *
 * The page takes an error *code* in `?error=`, never free text: a URL that
 * could carry its own title and description would let anyone put words on a
 * SigNote-branded page. Every sentence shown comes from this table.
 *
 * Codes are NextAuth v4's own (what it appends when a sign-in fails), the
 * `VaultConflictError` codes a callback can throw, and our own redirects.
 */

export type AuthErrorCopy = {
  title: string;
  description: string;
};

const TRY_AGAIN = 'Please try signing in again.';

const COPY: Record<string, AuthErrorCopy> = {
  // Our own redirects.
  EmailTaken: {
    title: 'Email already in use',
    description:
      'That Google account uses an email address that already signs into a different SigNote account, and Google has not verified it. Sign in with a code sent to that address instead.',
  },

  // Thrown from the account's vault lock during sign-in.
  ROTATION_IN_PROGRESS: {
    title: 'Encryption keys are being rotated',
    description:
      'Your account is in the middle of a key rotation, so sign-in is paused until it finishes. Wait a moment and try again.',
  },
  GENERATION_MISMATCH: {
    title: 'Account state changed',
    description: `Your account's encryption keys changed while you were signing in. ${TRY_AGAIN}`,
  },
  INVALID_GENERATION: {
    title: 'Account state changed',
    description: `Your account's encryption keys changed while you were signing in. ${TRY_AGAIN}`,
  },

  // NextAuth.
  AccessDenied: {
    title: 'Access denied',
    description: 'Sign-in was cancelled or refused. If you did not mean to cancel, try again.',
  },
  Configuration: {
    title: 'Sign-in is unavailable',
    description: 'Sign-in is misconfigured on the server. This is not something you can fix — please contact support.',
  },
  Verification: {
    title: 'Link expired',
    description: `This sign-in link has expired or was already used. ${TRY_AGAIN}`,
  },
  OAuthSignin: {
    title: 'Could not reach the provider',
    description: `We could not start sign-in with that provider. ${TRY_AGAIN}`,
  },
  OAuthCallback: {
    title: 'Provider sign-in failed',
    description: `The provider returned an error while signing you in. ${TRY_AGAIN}`,
  },
  OAuthCreateAccount: {
    title: 'Could not create your account',
    description: `We could not create an account from that provider. ${TRY_AGAIN}`,
  },
  OAuthAccountNotLinked: {
    title: 'Account not linked',
    description:
      'That sign-in method is not linked to your account. Sign in the way you usually do, then link it from your profile.',
  },
  Callback: {
    title: 'Sign-in failed',
    description: `Something went wrong while finishing sign-in. ${TRY_AGAIN}`,
  },
  CredentialsSignin: {
    title: 'Sign-in failed',
    description: `We could not verify those credentials. ${TRY_AGAIN}`,
  },
  SessionRequired: {
    title: 'Sign-in required',
    description: 'You need to be signed in to view that page.',
  },
};

const FALLBACK: AuthErrorCopy = {
  title: 'Sign-in failed',
  description: `Something went wrong while signing you in. ${TRY_AGAIN}`,
};

/** A code is echoed back only when it looks like one, so a crafted URL can't add prose. */
const CODE_SHAPE = /^[A-Za-z_]{1,40}$/;

export function describeAuthError(raw: string | string[] | undefined): AuthErrorCopy & { code: string | null } {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const code = value && CODE_SHAPE.test(value) ? value : null;
  const copy = (code && Object.hasOwn(COPY, code) ? COPY[code] : undefined) ?? FALLBACK;
  return { ...copy, code };
}
