import { z } from 'zod';

const base64url = /^[A-Za-z0-9_-]+$/;

export const desktopState = z.string().min(43).max(128).regex(base64url);
export const desktopAttemptId = z.string().length(32).regex(base64url);
export const desktopCodeChallenge = z.string().length(43).regex(base64url);
export const desktopAuthorizationCode = z.string().length(43).regex(base64url);
export const desktopCodeVerifier = z.string().min(43).max(128).regex(base64url);

export const createDesktopAttemptSchema = z.object({
  state: desktopState,
  codeChallenge: desktopCodeChallenge,
  codeChallengeMethod: z.literal('S256'),
});

export const authorizeDesktopAttemptSchema = z.object({
  attemptId: desktopAttemptId,
  state: desktopState,
});

export const exchangeDesktopAttemptSchema = z.object({
  attemptId: desktopAttemptId,
  state: desktopState,
  code: desktopAuthorizationCode,
  codeVerifier: desktopCodeVerifier,
});
