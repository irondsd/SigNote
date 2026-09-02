import { describe, expect, test } from 'bun:test';
import { AuthCallbackQueue, focusDesktopWindow } from '../src/authCallbackQueue';
import { createDesktopBridge, type DesktopIpc } from '../src/bridge';
import { isAllowedAppNavigation, isAllowedBrowserLoginUrl, isSafeExternalUrl, resolveAppOrigin } from '../src/security';
import { findDesktopAuthCallback, parseDesktopAuthCallback } from '../src/deepLinks';
import { AUTH_CALLBACK_CHANNEL, AUTH_CALLBACK_READY_CHANNEL, START_BROWSER_LOGIN_CHANNEL } from '../src/ipc';

describe('resolveAppOrigin', () => {
  test('uses localhost for an unpackaged development build', () => {
    expect(resolveAppOrigin(false, undefined).href).toBe('http://localhost:5000/');
  });

  test('uses the production origin for a packaged build', () => {
    expect(resolveAppOrigin(true, undefined).href).toBe('https://signote.tech/');
  });

  test('allows an HTTPS override', () => {
    expect(resolveAppOrigin(true, 'https://staging.signote.tech').origin).toBe('https://staging.signote.tech');
  });

  test('allows HTTP only for local development', () => {
    expect(resolveAppOrigin(false, 'http://127.0.0.1:5000').origin).toBe('http://127.0.0.1:5000');
    expect(() => resolveAppOrigin(true, 'http://localhost:5000')).toThrow('requires HTTPS');
    expect(() => resolveAppOrigin(false, 'http://staging.signote.tech')).toThrow('requires HTTPS');
  });

  test('rejects values that are not bare origins', () => {
    expect(() => resolveAppOrigin(false, 'https://signote.tech/notes')).toThrow('must be an origin');
    expect(() => resolveAppOrigin(false, 'https://user:pass@signote.tech')).toThrow('must be an origin');
  });
});

describe('desktop auth deep links', () => {
  const attempt = 'a'.repeat(32);
  const code = 'b'.repeat(43);
  const state = 'c'.repeat(43);
  const valid = `signote://auth/callback?attempt=${attempt}&code=${code}&state=${state}`;

  test('parses the exact callback shape', () => {
    expect(parseDesktopAuthCallback(valid)).toEqual({ attemptId: attempt, code, state });
    expect(findDesktopAuthCallback(['SigNote', valid])).toEqual({ attemptId: attempt, code, state });
  });

  test('rejects wrong routes, duplicate fields, fragments, and malformed secrets', () => {
    expect(
      parseDesktopAuthCallback(`signote://evil/callback?attempt=${attempt}&code=${code}&state=${state}`),
    ).toBeNull();
    expect(parseDesktopAuthCallback(`${valid}&code=${code}`)).toBeNull();
    expect(parseDesktopAuthCallback(`${valid}#token`)).toBeNull();
    expect(parseDesktopAuthCallback(`signote://auth/callback?attempt=short&code=${code}&state=${state}`)).toBeNull();
    expect(
      parseDesktopAuthCallback(`https://signote.tech/callback?attempt=${attempt}&code=${code}&state=${state}`),
    ).toBeNull();
  });
});

describe('desktop auth callback lifecycle', () => {
  const callback = { attemptId: 'a'.repeat(32), code: 'b'.repeat(43), state: 'c'.repeat(43) };

  test('queues a cold-start callback until the renderer is ready and delivers it once', () => {
    const queue = new AuthCallbackQueue();
    const delivered: (typeof callback)[] = [];

    queue.receive(callback);
    expect(queue.flush((payload) => delivered.push(payload))).toBe(false);
    queue.markRendererReady();
    expect(queue.flush((payload) => delivered.push(payload))).toBe(true);
    expect(queue.flush((payload) => delivered.push(payload))).toBe(false);
    expect(delivered).toEqual([callback]);
  });

  test('pauses callback delivery during a renderer reload', () => {
    const queue = new AuthCallbackQueue();
    const delivered: (typeof callback)[] = [];

    queue.markRendererReady();
    queue.markRendererLoading();
    queue.receive(callback);
    expect(queue.flush((payload) => delivered.push(payload))).toBe(false);
    queue.markRendererReady();
    expect(queue.flush((payload) => delivered.push(payload))).toBe(true);
    expect(delivered).toEqual([callback]);
  });

  test('restores and focuses an already-running minimized window', () => {
    const calls: string[] = [];
    focusDesktopWindow({
      isMinimized: () => true,
      restore: () => calls.push('restore'),
      show: () => calls.push('show'),
      focus: () => calls.push('focus'),
    });
    expect(calls).toEqual(['restore', 'show', 'focus']);
  });
});

describe('preload bridge boundary', () => {
  test('exposes only the documented immutable API and cleans up its callback listener', async () => {
    const calls: Array<{ channel: string; payload?: string }> = [];
    const callback = { attemptId: 'a'.repeat(32), code: 'b'.repeat(43), state: 'c'.repeat(43) };
    const listeners = new Map<string, (payload: typeof callback) => void>();
    const ipc: DesktopIpc = {
      invoke: async (channel, payload) => {
        calls.push({ channel, payload });
      },
      on: (channel, listener) => listeners.set(channel, listener),
      send: (channel) => calls.push({ channel }),
      removeListener: (channel, listener) => {
        if (listeners.get(channel) === listener) listeners.delete(channel);
      },
    };

    const bridge = createDesktopBridge(ipc, 'macos', '0.1.0');
    expect(Object.isFrozen(bridge)).toBe(true);
    expect(Object.keys(bridge).sort()).toEqual(
      ['appVersion', 'isDesktop', 'onAuthCallback', 'platform', 'startBrowserLogin'].sort(),
    );

    await bridge.startBrowserLogin('https://signote.tech/desktop/login?attempt=test');
    expect(calls).toContainEqual({
      channel: START_BROWSER_LOGIN_CHANNEL,
      payload: 'https://signote.tech/desktop/login?attempt=test',
    });

    const delivered: (typeof callback)[] = [];
    const unsubscribe = bridge.onAuthCallback((payload) => delivered.push(payload));
    expect(calls).toContainEqual({ channel: AUTH_CALLBACK_READY_CHANNEL });
    listeners.get(AUTH_CALLBACK_CHANNEL)?.(callback);
    expect(delivered).toEqual([callback]);
    unsubscribe();
    expect(listeners.has(AUTH_CALLBACK_CHANNEL)).toBe(false);
  });
});

describe('navigation policy', () => {
  const appOrigin = new URL('https://signote.tech');

  test('allows paths on the configured application origin', () => {
    expect(isAllowedAppNavigation('https://signote.tech/notes?id=123', appOrigin)).toBe(true);
  });

  test('allows only the desktop login path on the configured origin', () => {
    expect(isAllowedBrowserLoginUrl('https://signote.tech/desktop/login?attempt=abc', appOrigin)).toBe(true);
    expect(isAllowedBrowserLoginUrl('https://signote.tech/desktop/login#token', appOrigin)).toBe(false);
    expect(isAllowedBrowserLoginUrl('https://signote.tech/api/auth/session', appOrigin)).toBe(false);
    expect(isAllowedBrowserLoginUrl('https://attacker.example/desktop/login', appOrigin)).toBe(false);
  });

  test('rejects sibling domains, insecure URLs, and deceptive hostnames', () => {
    expect(isAllowedAppNavigation('https://accounts.google.com', appOrigin)).toBe(false);
    expect(isAllowedAppNavigation('http://signote.tech', appOrigin)).toBe(false);
    expect(isAllowedAppNavigation('https://signote.tech.attacker.example', appOrigin)).toBe(false);
  });

  test('opens only credential-free HTTPS URLs externally', () => {
    expect(isSafeExternalUrl('https://example.com/docs')).toBe(true);
    expect(isSafeExternalUrl('http://example.com')).toBe(false);
    expect(isSafeExternalUrl('mailto:user@example.com')).toBe(false);
    expect(isSafeExternalUrl('https://user:password@example.com')).toBe(false);
    expect(isSafeExternalUrl('signote://auth/callback')).toBe(false);
  });
});
