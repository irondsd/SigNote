import { test, expect } from '@playwright/test';
import { makeAccount } from '../utils/makeAccount';
import { seedNotes } from '../fixtures/seedNotes';
import { NotesPage } from '../pages/NotesPage';

test.describe.configure({ mode: 'parallel' });

// API contract checks for PATCH /api/notes/[id] covering the pin + expiry +
// burn-after-reading semantics. Same shape as secrets/seals; one suite is
// enough since handleCommonPatch is shared across all three routes.

test.describe('PATCH /api/notes/[id] — pin/expiry contract', () => {
  test('burnAfterReading=true clears any existing expiresAt', async ({ page }) => {
    const { account } = makeAccount();
    const [seeded] = await seedNotes(account.address, [
      { title: `mutex-1-${Date.now()}`, expiresAt: new Date(Date.now() + 60 * 60_000) },
    ]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    const res = await page.request.patch(`/api/notes/${seeded._id.toString()}`, {
      data: { burnAfterReading: true },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.burnAfterReading).toBe(true);
    expect(body.expiresAt).toBeNull();
  });

  test('setting expiresAt clears burnAfterReading', async ({ page }) => {
    const { account } = makeAccount();
    const [seeded] = await seedNotes(account.address, [
      { title: `mutex-2-${Date.now()}`, burnAfterReading: true },
    ]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    const res = await page.request.patch(`/api/notes/${seeded._id.toString()}`, {
      data: { expiresAt: future },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.burnAfterReading).toBe(false);
    expect(new Date(body.expiresAt).toISOString()).toBe(future);
  });

  test('a single PATCH can update pinned and expiresAt together', async ({ page }) => {
    const { account } = makeAccount();
    const [seeded] = await seedNotes(account.address, [{ title: `combo-${Date.now()}` }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    const res = await page.request.patch(`/api/notes/${seeded._id.toString()}`, {
      data: { pinned: true, expiresAt: future },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.pinned).toBe(true);
    expect(new Date(body.expiresAt).toISOString()).toBe(future);
  });

  test('non-boolean pinned returns 400', async ({ page }) => {
    const { account } = makeAccount();
    const [seeded] = await seedNotes(account.address, [{ title: `bad-pin-${Date.now()}` }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    const res = await page.request.patch(`/api/notes/${seeded._id.toString()}`, {
      data: { pinned: 'yes' },
    });
    expect(res.status()).toBe(400);
  });

  test('non-boolean burnAfterReading returns 400', async ({ page }) => {
    const { account } = makeAccount();
    const [seeded] = await seedNotes(account.address, [{ title: `bad-burn-${Date.now()}` }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    const res = await page.request.patch(`/api/notes/${seeded._id.toString()}`, {
      data: { burnAfterReading: 'true' },
    });
    expect(res.status()).toBe(400);
  });

  test('invalid expiresAt returns 400', async ({ page }) => {
    const { account } = makeAccount();
    const [seeded] = await seedNotes(account.address, [{ title: `bad-date-${Date.now()}` }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    const res = await page.request.patch(`/api/notes/${seeded._id.toString()}`, {
      data: { expiresAt: 'not-a-date' },
    });
    expect(res.status()).toBe(400);
  });
});
