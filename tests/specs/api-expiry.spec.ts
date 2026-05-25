import { test, expect } from '@playwright/test';
import { makeAccount } from '../utils/makeAccount';
import { seedNotes } from '../fixtures/seedNotes';
import { seedSecrets } from '../fixtures/seedSecrets';
import { seedSeals } from '../fixtures/seedSeals';
import { NotesPage } from '../pages/NotesPage';
import { SecretsPage } from '../pages/SecretsPage';
import { SealsPage } from '../pages/SealsPage';

test.describe.configure({ mode: 'parallel' });

// `getById` gates PATCH/DELETE via assertOwner. The lenient grace window
// matches the TTL `expireAfterSeconds: 3600`: while the doc is still
// physically in Mongo, an in-modal user can PATCH expiresAt=null to revive.
// Outside the grace, PATCH must return 404 even if the TTL sweep hasn't fired.

test.describe('expired note access — getById is grace-aware', () => {
  test('Notes: PATCH succeeds within grace, returns 404 outside grace', async ({ page }) => {
    const { account } = makeAccount();
    const [withinGrace, outsideGrace] = await seedNotes(account.address, [
      { title: `within-grace-${Date.now()}`, expiresAt: new Date(Date.now() - 30 * 60_000) },
      { title: `outside-grace-${Date.now()}`, expiresAt: new Date(Date.now() - 3700 * 1000) },
    ]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    const within = await page.request.patch(`/api/notes/${withinGrace._id.toString()}`, {
      data: { expiresAt: null, burnAfterReading: false },
    });
    expect(within.status()).toBe(200);

    const outside = await page.request.patch(`/api/notes/${outsideGrace._id.toString()}`, {
      data: { expiresAt: null, burnAfterReading: false },
    });
    expect(outside.status()).toBe(404);
  });

  test('Secrets: PATCH succeeds within grace, returns 404 outside grace', async ({ page }) => {
    const secretsPage = new SecretsPage(page);
    const { address, mekBytes } = await secretsPage.signInDirectly();
    const [withinGrace, outsideGrace] = await seedSecrets(address, mekBytes, [
      { title: `within-${Date.now()}`, content: 'x', expiresAt: new Date(Date.now() - 30 * 60_000) },
      { title: `outside-${Date.now()}`, content: 'x', expiresAt: new Date(Date.now() - 3700 * 1000) },
    ]);

    const within = await page.request.patch(`/api/secrets/${withinGrace._id.toString()}`, {
      data: { expiresAt: null, burnAfterReading: false },
    });
    expect(within.status()).toBe(200);

    const outside = await page.request.patch(`/api/secrets/${outsideGrace._id.toString()}`, {
      data: { expiresAt: null, burnAfterReading: false },
    });
    expect(outside.status()).toBe(404);
  });

  test('Seals: PATCH succeeds within grace, returns 404 outside grace', async ({ page }) => {
    const sealsPage = new SealsPage(page);
    const { address, mekBytes } = await sealsPage.signInDirectly();
    const [withinGrace, outsideGrace] = await seedSeals(address, mekBytes, [
      { title: `within-${Date.now()}`, content: 'x', expiresAt: new Date(Date.now() - 30 * 60_000) },
      { title: `outside-${Date.now()}`, content: 'x', expiresAt: new Date(Date.now() - 3700 * 1000) },
    ]);

    const within = await page.request.patch(`/api/seals/${withinGrace._id.toString()}`, {
      data: { expiresAt: null, burnAfterReading: false },
    });
    expect(within.status()).toBe(200);

    const outside = await page.request.patch(`/api/seals/${outsideGrace._id.toString()}`, {
      data: { expiresAt: null, burnAfterReading: false },
    });
    expect(outside.status()).toBe(404);
  });

  test('within-grace note revived by PATCH reappears in the list', async ({ page }) => {
    const { account } = makeAccount();
    const [seeded] = await seedNotes(account.address, [
      { title: `revive-${Date.now()}`, expiresAt: new Date(Date.now() - 30 * 60_000) },
    ]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    const revive = await page.request.patch(`/api/notes/${seeded._id.toString()}`, {
      data: { expiresAt: null, burnAfterReading: false },
    });
    expect(revive.ok()).toBe(true);

    const list = await page.request.get('/api/notes');
    const notes = (await list.json()) as { _id: string }[];
    expect(notes.some((n) => n._id === seeded._id.toString())).toBe(true);
  });
});
