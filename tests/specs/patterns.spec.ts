import { test, expect } from '@playwright/test';
import { makeAccount } from '../utils/makeAccount';
import { seedNotes } from '../fixtures/seedNotes';
import { NotesPage } from '../pages/NotesPage';
import { clearSession } from '../utils/clearSession';
import type { NotePattern } from '../../src/config/noteStyles';

test.describe.configure({ mode: 'parallel' });

// ─── Note Patterns ──────────────────────────────────────────────────────────

const NON_PLAIN_PATTERNS: NotePattern[] = ['grid', 'dots', 'stars', 'hatch', 'blobs'];

test.describe('note patterns', () => {
  test('seeded patterns render correct data-pattern on cards', async ({ page }) => {
    const { account } = makeAccount();
    const ts = Date.now();

    const seeds = [
      ...NON_PLAIN_PATTERNS.map((p) => ({ title: `${p} ${ts}`, pattern: p as NotePattern })),
      { title: `plain ${ts}` },
    ];
    await seedNotes(account.address, seeds);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    for (const p of NON_PLAIN_PATTERNS) {
      const card = notesPage.noteCard(`${p} ${ts}`);
      await expect(card).toBeVisible();
      expect(await card.getAttribute('data-pattern')).toBe(p);
    }

    const plainCard = notesPage.noteCard(`plain ${ts}`);
    await expect(plainCard).toBeVisible();
    expect(await plainCard.getAttribute('data-pattern')).toBeNull();
  });

  test('patterned note shows data-pattern on modal body', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Modal Pattern ${Date.now()}`;
    await seedNotes(account.address, [{ title, pattern: 'dots' }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    await notesPage.noteCard(title).click();
    await expect(page.getByTestId('note-modal')).toBeVisible();

    const patternEl = page.getByTestId('note-modal').locator('[data-pattern]');
    await expect(patternEl).toHaveAttribute('data-pattern', 'dots');
  });

  test('reset pattern to plain removes data-pattern', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Reset Pattern ${Date.now()}`;
    const [seededNote] = await seedNotes(account.address, [{ title, pattern: 'grid' }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    const card = notesPage.noteCard(title);
    expect(await card.getAttribute('data-pattern')).toBe('grid');

    await card.click();
    await expect(page.getByTestId('note-modal')).toBeVisible();

    const patchPromise = page.waitForResponse(
      (r) => r.url().includes('/api/notes/') && r.request().method() === 'PATCH',
    );
    await page.getByTestId('style-picker-btn').click();
    await page.getByTitle('Plain').click();
    await patchPromise;

    const res = await page.request.get('/api/notes');
    const notes = await res.json();
    const updated = notes.find((n: { _id: string }) => n._id === seededNote._id.toString());
    expect(updated.pattern).toBeNull();
  });

  test('create note with pattern applies data-pattern to card', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    const title = `New Pattern Note ${Date.now()}`;
    await page.getByTestId('new-note-btn').click();
    await page.getByTestId('note-title-input').fill(title);

    await page.getByTitle('Note style').click();
    await page.getByTitle('Stars').click();

    const postPromise = page.waitForResponse((r) => r.url().includes('/api/notes') && r.request().method() === 'POST');
    await page.getByTestId('save-note-btn').click();
    await postPromise;

    const card = notesPage.noteCard(title);
    await expect(card).toBeVisible();
    expect(await card.getAttribute('data-pattern')).toBe('stars');

    const res = await page.request.get('/api/notes');
    const notes = await res.json();
    const created = notes.find((n: { title: string }) => n.title === title);
    expect(created.pattern).toBe('stars');
  });

  test('pattern persists after page reload', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Persist Pattern ${Date.now()}`;
    await seedNotes(account.address, [{ title, pattern: 'hatch' }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    const card = notesPage.noteCard(title);
    await expect(card).toBeVisible();
    expect(await card.getAttribute('data-pattern')).toBe('hatch');

    await clearSession(page);
    await page.reload();
    await expect(notesPage.noteCard(title)).toBeVisible();
    expect(await notesPage.noteCard(title).getAttribute('data-pattern')).toBe('hatch');
  });

  test('changing pattern does not bump updatedAt', async ({ page }) => {
    const { account } = makeAccount();
    const title = `No Bump ${Date.now()}`;
    const [seededNote] = await seedNotes(account.address, [{ title }]);
    const originalUpdatedAt = new Date(seededNote.updatedAt).getTime();

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    await notesPage.noteCard(title).click();
    await expect(page.getByTestId('note-modal')).toBeVisible();

    const patchPromise = page.waitForResponse(
      (r) => r.url().includes('/api/notes/') && r.request().method() === 'PATCH',
    );
    await page.getByTestId('style-picker-btn').click();
    await page.getByTitle('Blobs').click();
    await patchPromise;

    const res = await page.request.get('/api/notes');
    const notes = await res.json();
    const updated = notes.find((n: { _id: string }) => n._id === seededNote._id.toString());
    expect(new Date(updated.updatedAt).getTime()).toBe(originalUpdatedAt);
  });
});
