import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createGoogleTestSession } from '../utils/createGoogleTestSession';
import { createTestSession } from '../utils/createTestSession';
import { injectSession } from '../utils/injectSession';
import { makeAccount } from '../utils/makeAccount';
import { trpcData, trpcMutate, trpcQuery } from '../utils/trpc';

test.describe('desktop browser sign-in', () => {
  test('does not let a SIWE browser session authorize the desktop app', async ({ page }) => {
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(verifier, 'utf8').digest('base64url');
    const attemptResponse = await page.request.post('/api/desktop-auth/attempts', {
      data: { state, codeChallenge, codeChallengeMethod: 'S256' },
    });
    const { attemptId } = (await attemptResponse.json()) as { attemptId: string };

    const walletToken = await createTestSession(makeAccount().account.address);
    await injectSession(page, walletToken);
    const response = await page.request.post('/api/desktop-auth/authorize', { data: { attemptId, state } });

    expect(response.status()).toBe(403);
  });

  test('exchanges a browser-authorized PKCE code for a distinct desktop session', async ({ browser }) => {
    const browserContext = await browser.newContext();
    const desktopContext = await browser.newContext({ userAgent: 'SigNoteDesktop/e2e' });
    const browserPage = await browserContext.newPage();
    let desktopPage = await desktopContext.newPage();

    const state = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier, 'utf8').digest('base64url');

    const attemptResponse = await desktopPage.request.post('/api/desktop-auth/attempts', {
      data: { state, codeChallenge, codeChallengeMethod: 'S256' },
    });
    expect(attemptResponse.status()).toBe(201);
    const attempt = (await attemptResponse.json()) as { attemptId: string; loginUrl: string };
    expect(attempt.attemptId).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(attempt.loginUrl).toContain('/desktop/login?');

    const email = `desktop-${randomBytes(6).toString('hex')}@example.com`;
    const browserToken = await createGoogleTestSession(`google-${randomBytes(8).toString('hex')}`, email);
    await injectSession(browserPage, browserToken);

    await browserPage.goto(attempt.loginUrl);
    await expect(browserPage.getByRole('button', { name: 'Authorize desktop app' })).toBeVisible();

    const authorizeResponse = await browserPage.request.post('/api/desktop-auth/authorize', {
      data: { attemptId: attempt.attemptId, state },
    });
    expect(authorizeResponse.ok()).toBeTruthy();
    const { deepLink } = (await authorizeResponse.json()) as { deepLink: string };
    const callback = new URL(deepLink);
    expect(callback.protocol).toBe('signote:');
    expect(callback.hostname).toBe('auth');
    expect(callback.pathname).toBe('/callback');

    const exchangeBody = {
      attemptId: callback.searchParams.get('attempt'),
      code: callback.searchParams.get('code'),
      state: callback.searchParams.get('state'),
      codeVerifier,
    };
    const exchangeResponse = await desktopPage.request.post('/api/desktop-auth/exchange', { data: exchangeBody });
    expect(exchangeResponse.ok()).toBeTruthy();
    expect(await exchangeResponse.json()).toEqual({ ok: true });

    const sessionResponse = await desktopPage.request.get('/api/auth/session');
    expect(sessionResponse.ok()).toBeTruthy();
    const session = (await sessionResponse.json()) as { user?: { name?: string } };
    expect(session.user?.name).toBe(email);

    const listResponse = await trpcQuery(desktopPage.request, 'sessions.list');
    expect(listResponse.ok()).toBeTruthy();
    const { sessions } = await trpcData<{
      sessions: Array<{ provider: string; client: string; current: boolean }>;
    }>(listResponse);
    expect(sessions).toEqual(
      expect.arrayContaining([expect.objectContaining({ provider: 'google', client: 'desktop', current: true })]),
    );

    await desktopPage.close();
    desktopPage = await desktopContext.newPage();
    expect((await desktopPage.request.get('/api/auth/session')).ok()).toBeTruthy();

    const replayResponse = await desktopPage.request.post('/api/desktop-auth/exchange', { data: exchangeBody });
    expect(replayResponse.status()).toBe(409);

    const browserSessionsResponse = await trpcQuery(browserPage.request, 'sessions.list');
    const browserSessions = await trpcData<{ sessions: Array<{ _id: string; client: string }> }>(
      browserSessionsResponse,
    );
    const desktopSession = browserSessions.sessions.find((candidate) => candidate.client === 'desktop');
    expect(desktopSession).toBeDefined();
    expect((await trpcMutate(browserPage.request, 'sessions.revoke', { id: desktopSession!._id })).ok()).toBeTruthy();
    expect((await trpcQuery(desktopPage.request, 'me')).status()).toBe(401);

    await browserContext.close();
    await desktopContext.close();
  });
});
