const PENDING_ATTEMPT_KEY = 'signote-desktop-auth-attempt';
const PENDING_CALLBACK_KEY = 'signote-desktop-auth-callback';

export type PendingDesktopAuthAttempt = {
  attemptId: string;
  state: string;
  codeVerifier: string;
  expiresAt: string;
};

export type DesktopAuthCallbackPayload = {
  attemptId: string;
  code: string;
  state: string;
};

export class DesktopAuthError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function randomBase64url(byteLength: number): string {
  return base64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function createPkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

function readJson<T>(key: string): T | null {
  try {
    const value = sessionStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

export function getPendingDesktopAuthAttempt(): PendingDesktopAuthAttempt | null {
  return readJson<PendingDesktopAuthAttempt>(PENDING_ATTEMPT_KEY);
}

export function getPendingDesktopAuthCallback(): DesktopAuthCallbackPayload | null {
  return readJson<DesktopAuthCallbackPayload>(PENDING_CALLBACK_KEY);
}

export function saveDesktopAuthCallback(payload: DesktopAuthCallbackPayload): void {
  sessionStorage.setItem(PENDING_CALLBACK_KEY, JSON.stringify(payload));
}

export function clearDesktopAuthState(): void {
  sessionStorage.removeItem(PENDING_ATTEMPT_KEY);
  sessionStorage.removeItem(PENDING_CALLBACK_KEY);
}

export async function beginDesktopAuth(): Promise<string> {
  clearDesktopAuthState();
  const state = randomBase64url(32);
  const codeVerifier = randomBase64url(32);
  const codeChallenge = await createPkceChallenge(codeVerifier);

  const response = await fetch('/api/desktop-auth/attempts', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state, codeChallenge, codeChallengeMethod: 'S256' }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    attemptId?: string;
    loginUrl?: string;
    expiresAt?: string;
  };

  if (!response.ok || !body.attemptId || !body.loginUrl || !body.expiresAt) {
    throw new DesktopAuthError(
      response.status === 429
        ? 'Too many sign-in attempts. Wait a few minutes and try again.'
        : 'Sign-in could not start.',
      true,
    );
  }

  const pending: PendingDesktopAuthAttempt = {
    attemptId: body.attemptId,
    state,
    codeVerifier,
    expiresAt: body.expiresAt,
  };
  sessionStorage.setItem(PENDING_ATTEMPT_KEY, JSON.stringify(pending));
  return body.loginUrl;
}

export async function exchangeDesktopAuthCallback(payload: DesktopAuthCallbackPayload): Promise<void> {
  const pending = getPendingDesktopAuthAttempt();
  if (!pending || pending.attemptId !== payload.attemptId || pending.state !== payload.state) {
    clearDesktopAuthState();
    throw new DesktopAuthError('This sign-in response does not match the request from this app.', false);
  }
  if (new Date(pending.expiresAt).getTime() <= Date.now()) {
    clearDesktopAuthState();
    throw new DesktopAuthError('This sign-in request expired. Please start again.', false);
  }

  let response: Response;
  try {
    response = await fetch('/api/desktop-auth/exchange', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attemptId: payload.attemptId,
        state: payload.state,
        code: payload.code,
        codeVerifier: pending.codeVerifier,
      }),
    });
  } catch {
    throw new DesktopAuthError('SigNote could not reach the server. Check your connection and try again.', true);
  }

  if (!response.ok) {
    clearDesktopAuthState();
    throw new DesktopAuthError(
      response.status === 429
        ? 'Too many exchange attempts. Start a new sign-in request.'
        : 'This sign-in response is invalid, expired, or already used.',
      false,
    );
  }

  clearDesktopAuthState();
}
