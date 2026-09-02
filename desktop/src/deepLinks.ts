import type { DesktopAuthCallback } from './ipc.js';

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function isBoundedBase64url(value: string, min: number, max: number): boolean {
  return value.length >= min && value.length <= max && BASE64URL.test(value);
}

export function parseDesktopAuthCallback(rawUrl: string): DesktopAuthCallback | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== 'signote:' || url.hostname !== 'auth' || url.pathname !== '/callback' || url.hash) return null;

  const allowedKeys = new Set(['attempt', 'code', 'state']);
  for (const key of url.searchParams.keys()) {
    if (!allowedKeys.has(key) || url.searchParams.getAll(key).length !== 1) return null;
  }

  const attemptId = url.searchParams.get('attempt') ?? '';
  const code = url.searchParams.get('code') ?? '';
  const state = url.searchParams.get('state') ?? '';

  if (!isBoundedBase64url(attemptId, 32, 32)) return null;
  if (!isBoundedBase64url(code, 43, 43)) return null;
  if (!isBoundedBase64url(state, 43, 128)) return null;

  return { attemptId, code, state };
}

export function findDesktopAuthCallback(args: readonly string[]): DesktopAuthCallback | null {
  for (const argument of args) {
    const callback = parseDesktopAuthCallback(argument);
    if (callback) return callback;
  }
  return null;
}
