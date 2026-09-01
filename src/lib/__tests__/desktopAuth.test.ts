/** @jest-environment jsdom */

import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import {
  beginDesktopAuth,
  clearDesktopAuthState,
  exchangeDesktopAuthCallback,
  getPendingDesktopAuthAttempt,
} from '../desktopAuth';

const callbackCode = 'c'.repeat(43);

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('desktop renderer authentication', () => {
  const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>();

  beforeAll(() => {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
    Object.defineProperty(globalThis, 'TextEncoder', { configurable: true, value: TextEncoder });
  });

  beforeEach(() => {
    clearDesktopAuthState();
    fetchMock.mockReset();
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchMock });
  });

  async function startAttempt() {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          attemptId: 'a'.repeat(32),
          loginUrl: 'https://signote.app/desktop/login?attempt=test',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
        201,
      ),
    );
    await beginDesktopAuth();
    return getPendingDesktopAuthAttempt()!;
  }

  it('keeps the verifier local and sends only its S256 challenge when creating an attempt', async () => {
    const pending = await startAttempt();
    const request = fetchMock.mock.calls[0];
    const body = JSON.parse((request[1]?.body as string) ?? '{}') as Record<string, string>;

    expect(request[0]).toBe('/api/desktop-auth/attempts');
    expect(body.codeChallengeMethod).toBe('S256');
    expect(body.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.state).toBe(pending.state);
    expect(JSON.stringify(body)).not.toContain(pending.codeVerifier);
  });

  it('rejects a callback whose state does not match without contacting the exchange endpoint', async () => {
    const pending = await startAttempt();
    fetchMock.mockClear();

    await expect(
      exchangeDesktopAuthCallback({
        attemptId: pending.attemptId,
        state: 'x'.repeat(43),
        code: callbackCode,
      }),
    ).rejects.toThrow('does not match');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getPendingDesktopAuthAttempt()).toBeNull();
  });

  it('rejects an expired callback locally and clears its secrets', async () => {
    const pending = await startAttempt();
    sessionStorage.setItem(
      'signote-desktop-auth-attempt',
      JSON.stringify({ ...pending, expiresAt: new Date(Date.now() - 1_000).toISOString() }),
    );
    fetchMock.mockClear();

    await expect(
      exchangeDesktopAuthCallback({ attemptId: pending.attemptId, state: pending.state, code: callbackCode }),
    ).rejects.toThrow('expired');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getPendingDesktopAuthAttempt()).toBeNull();
  });

  it('retains pending secrets after a retryable network failure', async () => {
    const pending = await startAttempt();
    fetchMock.mockRejectedValueOnce(new Error('offline'));

    await expect(
      exchangeDesktopAuthCallback({ attemptId: pending.attemptId, state: pending.state, code: callbackCode }),
    ).rejects.toMatchObject({ retryable: true });
    expect(getPendingDesktopAuthAttempt()).toEqual(pending);
  });

  it('clears pending secrets after a server rejection or successful exchange', async () => {
    let pending = await startAttempt();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid' }, 409));
    await expect(
      exchangeDesktopAuthCallback({ attemptId: pending.attemptId, state: pending.state, code: callbackCode }),
    ).rejects.toMatchObject({ retryable: false });
    expect(getPendingDesktopAuthAttempt()).toBeNull();

    pending = await startAttempt();
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await expect(
      exchangeDesktopAuthCallback({ attemptId: pending.attemptId, state: pending.state, code: callbackCode }),
    ).resolves.toBeUndefined();
    expect(getPendingDesktopAuthAttempt()).toBeNull();
  });
});
