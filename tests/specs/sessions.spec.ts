import { test, expect } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { SiweMessage } from 'siwe';
import { NotesPage } from '../pages/NotesPage';
import { makeAccount } from '../utils/makeAccount';
import { createTestSession } from '../utils/createTestSession';
import { injectSession } from '../utils/injectSession';
import { getOrCreateUserId } from '../fixtures/getOrCreateUserId';
import { testDb } from '../fixtures/db';
import { authIdentities, authSessions } from '../../src/db/schema';
import { trpcQuery, trpcMutate, trpcData } from '../utils/trpc';

test.describe.configure({ mode: 'parallel' });

// `trpc.me` is the lightest authed procedure: it triggers the lazy AuthSession
// upsert on first call and 401s once a session is revoked.
const AUTHED_PING = 'me';

test.describe('sessions / device management', () => {
  test('lists the current session after first authed request', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    const ping = await trpcQuery(page.request, AUTHED_PING);
    expect(ping.ok()).toBeTruthy();

    const res = await trpcQuery(page.request, 'sessions.list');
    expect(res.ok()).toBeTruthy();
    const { sessions } = await trpcData<{ sessions: Array<{ current: boolean; provider: string }> }>(res);

    expect(sessions).toHaveLength(1);
    expect(sessions[0].current).toBe(true);
    expect(sessions[0].provider).toBe('siwe');
  });

  test('revoking the other device 401s its next request', async ({ browser }) => {
    const { account } = makeAccount();

    // Context A — the device that will do the revoking.
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    const notesA = new NotesPage(pageA);
    await notesA.signInDirectly(account.address);

    // Context B — the same user, signed in on a "second device".
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    const notesB = new NotesPage(pageB);
    await notesB.signInDirectly(account.address);

    // Both contexts make one authed call so their AuthSession rows are created.
    await trpcQuery(pageA.request, AUTHED_PING);
    await trpcQuery(pageB.request, AUTHED_PING);

    // A sees two sessions, one of which is "current".
    const listRes = await trpcQuery(pageA.request, 'sessions.list');
    const { sessions } = await trpcData<{ sessions: Array<{ _id: string; current: boolean }> }>(listRes);
    expect(sessions).toHaveLength(2);
    const other = sessions.find((s) => !s.current);
    expect(other).toBeDefined();

    // A revokes B's session.
    const revokeRes = await trpcMutate(pageA.request, 'sessions.revoke', { id: other!._id });
    expect(revokeRes.ok()).toBeTruthy();
    const revokeBody = await trpcData<{ revoked: boolean; wasCurrent: boolean }>(revokeRes);
    expect(revokeBody.revoked).toBe(true);
    expect(revokeBody.wasCurrent).toBe(false);

    // B's next authed request is rejected.
    const bAfter = await trpcQuery(pageB.request, AUTHED_PING);
    expect(bAfter.status()).toBe(401);

    // A is unaffected.
    const aAfter = await trpcQuery(pageA.request, AUTHED_PING);
    expect(aAfter.ok()).toBeTruthy();

    await contextA.close();
    await contextB.close();
  });

  test('"sign out everywhere else" revokes all other sessions, keeping the requester', async ({ browser }) => {
    const { account } = makeAccount();

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const ctxC = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    const pageC = await ctxC.newPage();

    await new NotesPage(pageA).signInDirectly(account.address);
    await new NotesPage(pageB).signInDirectly(account.address);
    await new NotesPage(pageC).signInDirectly(account.address);

    await Promise.all([
      trpcQuery(pageA.request, AUTHED_PING),
      trpcQuery(pageB.request, AUTHED_PING),
      trpcQuery(pageC.request, AUTHED_PING),
    ]);

    const res = await trpcMutate(pageA.request, 'sessions.revokeOthers');
    expect(res.ok()).toBeTruthy();
    expect((await trpcData<{ revoked: number }>(res)).revoked).toBe(2);

    expect((await trpcQuery(pageB.request, AUTHED_PING)).status()).toBe(401);
    expect((await trpcQuery(pageC.request, AUTHED_PING)).status()).toBe(401);
    expect((await trpcQuery(pageA.request, AUTHED_PING)).ok()).toBeTruthy();

    await Promise.all([ctxA.close(), ctxB.close(), ctxC.close()]);
  });

  test('/sessions page renders cards and exposes revoke buttons', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();
    await trpcQuery(page.request, AUTHED_PING); // create the row

    await page.goto('/sessions');
    await expect(page.getByText('Active sessions')).toBeVisible();
    await expect(page.getByText('Current', { exact: true })).toBeVisible();
    await expect(page.locator('[data-testid^="revoke-session-"]')).toHaveCount(1);
  });
});

// ─── Revocation must hold everywhere, not just on tRPC ───────────────────────

/**
 * `getToken`/`getServerSession` only decode the JWT — they know nothing about
 * `auth_sessions`. Anything that resolves a session that way keeps working
 * after the device has been signed out, so each of these covers one endpoint
 * that used to.
 */
test.describe('revoked sessions', () => {
  test('POST session update still works for an active session', async ({ page }) => {
    const { account } = makeAccount();
    const userId = await getOrCreateUserId(account.address);
    await injectSession(page, await createTestSession(account.address));
    expect((await trpcQuery(page.request, AUTHED_PING)).status()).toBe(200);

    const { csrfToken } = await (await page.request.get('/api/auth/csrf')).json();
    const updated = await page.request.post('/api/auth/session', { data: { csrfToken, data: {} } });

    expect(updated.status()).toBe(200);
    expect((await updated.json()).user.id).toBe(userId);
    expect(updated.headers()['set-cookie']).toContain('next-auth.session-token');
    expect((await trpcQuery(page.request, AUTHED_PING)).status()).toBe(200);
  });

  test('POST session update cannot renew a revoked session', async ({ page }) => {
    await signInThenRevoke(page);

    // A revoked cookie holder can obtain their own CSRF token. Do not call
    // GET /session here: that already clears the cookie and hides this bypass.
    const { csrfToken } = await (await page.request.get('/api/auth/csrf')).json();
    const updated = await page.request.post('/api/auth/session', { data: { csrfToken, data: {} } });

    expect(updated.status()).toBe(200);
    expect.soft(await updated.json(), 'revoked POST must return the signed-out session shape').toEqual({});
    const cookies = await page.context().cookies();
    expect
      .soft(
        cookies.filter(
          (cookie) => /^(?:__Secure-)?next-auth\.session-token(?:\.\d+)?$/.test(cookie.name) && cookie.value !== '',
        ),
        'revoked POST must not leave a renewed session cookie',
      )
      .toEqual([]);
    expect((await trpcQuery(page.request, AUTHED_PING)).status()).toBe(401);
  });

  /** Signs a page in, forces its first authed request, then revokes every row. */
  async function signInThenRevoke(page: import('@playwright/test').Page) {
    const { account } = makeAccount();
    const userId = await getOrCreateUserId(account.address);
    await injectSession(page, await createTestSession(account.address));

    expect((await trpcQuery(page.request, AUTHED_PING)).ok()).toBeTruthy();
    await testDb().update(authSessions).set({ revokedAt: new Date() }).where(eq(authSessions.userId, userId));
    expect((await trpcQuery(page.request, AUTHED_PING)).status()).toBe(401);

    return { account, userId };
  }

  test('cannot link a new wallet', async ({ page }) => {
    await signInThenRevoke(page);

    const addedWallet = makeAccount().account;
    const { nonce } = await (await page.request.get('/api/auth/nonce')).json();
    const message = new SiweMessage({
      domain: 'localhost:5005',
      address: addedWallet.address,
      statement: 'Sign in to SigNote',
      uri: 'http://localhost:5005',
      version: '1',
      chainId: 1,
      nonce,
    }).prepareMessage();
    const signature = await addedWallet.signMessage({ message });

    const linked = await page.request.post('/api/auth/link/siwe', { data: { message, signature } });
    expect(linked.status()).toBe(401);

    const rows = await testDb()
      .select()
      .from(authIdentities)
      .where(eq(authIdentities.providerSubject, addedWallet.address.toLowerCase()));
    expect(rows).toHaveLength(0);
  });

  test('cannot start a Google link', async ({ page }) => {
    await signInThenRevoke(page);

    const initiated = await page.request.get('/api/auth/link/google/initiate', { maxRedirects: 0 });
    expect(initiated.status()).toBe(401);
  });

  test('/api/auth/session reports signed out and clears the cookie', async ({ page }) => {
    await signInThenRevoke(page);

    const refreshed = await page.request.get('/api/auth/session');
    expect(refreshed.status()).toBe(200);
    // NextAuth's signed-out shape: no `user`, so the client treats it as a
    // sign-out instead of rolling the JWT forward for another week.
    expect(await refreshed.json()).toEqual({});

    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === 'next-auth.session-token')?.value ?? '').toBe('');
  });
});
