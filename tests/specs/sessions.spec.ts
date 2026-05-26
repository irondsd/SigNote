import { test, expect } from '@playwright/test';
import { NotesPage } from '../pages/NotesPage';
import { makeAccount } from '../utils/makeAccount';

test.describe.configure({ mode: 'parallel' });

test.describe('sessions / device management', () => {
  test('lists the current session after first authed request', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    // /api/notes is the first authed request — triggers lazy AuthSession upsert.
    const notes = await page.request.get('/api/notes');
    expect(notes.ok()).toBeTruthy();

    const res = await page.request.get('/api/sessions');
    expect(res.ok()).toBeTruthy();
    const { sessions } = (await res.json()) as { sessions: Array<{ current: boolean; provider: string }> };

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

    // Both contexts hit /api/notes once so their AuthSession rows are created.
    await pageA.request.get('/api/notes');
    await pageB.request.get('/api/notes');

    // A sees two sessions, one of which is "current".
    const listRes = await pageA.request.get('/api/sessions');
    const { sessions } = (await listRes.json()) as {
      sessions: Array<{ _id: string; current: boolean }>;
    };
    expect(sessions).toHaveLength(2);
    const other = sessions.find((s) => !s.current);
    expect(other).toBeDefined();

    // A revokes B's session.
    const revokeRes = await pageA.request.delete(`/api/sessions/${other!._id}`);
    expect(revokeRes.ok()).toBeTruthy();
    const revokeBody = (await revokeRes.json()) as { revoked: boolean; wasCurrent: boolean };
    expect(revokeBody.revoked).toBe(true);
    expect(revokeBody.wasCurrent).toBe(false);

    // B's next authed request is rejected.
    const bAfter = await pageB.request.get('/api/notes');
    expect(bAfter.status()).toBe(401);

    // A is unaffected.
    const aAfter = await pageA.request.get('/api/notes');
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
      pageA.request.get('/api/notes'),
      pageB.request.get('/api/notes'),
      pageC.request.get('/api/notes'),
    ]);

    const res = await pageA.request.delete('/api/sessions');
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).revoked).toBe(2);

    expect((await pageB.request.get('/api/notes')).status()).toBe(401);
    expect((await pageC.request.get('/api/notes')).status()).toBe(401);
    expect((await pageA.request.get('/api/notes')).ok()).toBeTruthy();

    await Promise.all([ctxA.close(), ctxB.close(), ctxC.close()]);
  });

  test('/sessions page renders cards and exposes revoke buttons', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();
    await page.request.get('/api/notes'); // create the row

    await page.goto('/sessions');
    await expect(page.getByText('Active sessions')).toBeVisible();
    await expect(page.getByText('Current', { exact: true })).toBeVisible();
    await expect(page.locator('[data-testid^="revoke-session-"]')).toHaveCount(1);
  });
});
