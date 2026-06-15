import { test, expect } from '@playwright/test';
import { NotesPage } from '../pages/NotesPage';
import { makeAccount } from '../utils/makeAccount';
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
