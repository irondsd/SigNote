import { test, expect } from '@playwright/test';
import { makeAccount } from '../utils/makeAccount';
import { seedNotes } from '../fixtures/seedNotes';
import { NotesPage } from '../pages/NotesPage';
import { clearSession } from '../utils/clearSession';

test.describe.configure({ mode: 'parallel' });

// ─── Group 1: Create Note ────────────────────────────────────────────────────

test.describe('create note', () => {
  test('create note with title and content', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    await page.getByTestId('new-note-btn').click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();

    const title = `Test Note ${Date.now()}`;
    await page.getByTestId('note-title-input').fill(title);
    await page.getByTestId('save-note-btn').click();

    await expect(notesPage.noteCard(title)).toBeVisible();
  });

  test('create note with title only', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    await page.getByTestId('new-note-btn').click();
    const title = `Title Only ${Date.now()}`;
    await page.getByTestId('note-title-input').fill(title);
    await page.getByTestId('save-note-btn').click();

    await expect(notesPage.noteCard(title)).toBeVisible();
  });

  test('save button disabled when both fields empty, enabled after typing title', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    await page.getByTestId('new-note-btn').click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();

    await expect(page.getByTestId('save-note-btn')).toBeDisabled();

    await page.getByTestId('note-title-input').fill('Something');
    await expect(page.getByTestId('save-note-btn')).toBeEnabled();
  });
});

// ─── Group 2: Archive / Unarchive ───────────────────────────────────────────

test.describe('archive and unarchive', () => {
  test('archive note moves it to archive page', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Archivable ${Date.now()}`;
    await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    await notesPage.noteCard(title).click();
    await expect(page.getByTestId('note-title')).toBeVisible();

    const patchPromise = page.waitForResponse(
      (r) => r.url().includes('/api/notes/') && r.request().method() === 'PATCH',
    );
    await page.getByTestId('archive-btn').click();
    await patchPromise;

    await expect(notesPage.noteCard(title)).not.toBeVisible();

    await page.goto('/archive');
    await expect(notesPage.noteCard(title)).toBeVisible();
  });

  test('archived notes do not appear in the main list', async ({ page }) => {
    const { account } = makeAccount();
    const tag = `archmain${Date.now()}`;
    await seedNotes(account.address, [{ title: `${tag} active` }, { title: `${tag} archived`, archived: true }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    await expect(notesPage.noteCard(`${tag} active`)).toBeVisible({ timeout: 10000 });
    await expect(notesPage.noteCard(`${tag} archived`)).not.toBeVisible();
  });

  test('unarchive note moves it back to main grid', async ({ page }) => {
    const { account } = makeAccount();
    const title = `To Unarchive ${Date.now()}`;
    await seedNotes(account.address, [{ title, archived: true }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.goto('/archive');

    await notesPage.noteCard(title).click();
    await expect(page.getByTestId('note-title')).toBeVisible();

    const patchPromise = page.waitForResponse(
      (r) => r.url().includes('/api/notes/') && r.request().method() === 'PATCH',
    );
    await page.getByTestId('archive-btn').click();
    await patchPromise;

    await expect(notesPage.noteCard(title)).not.toBeVisible();

    await clearSession(page);
    await page.goto('/');
    await expect(notesPage.noteCard(title)).toBeVisible();
  });
});

// ─── Group 3: Search ─────────────────────────────────────────────────────────

test.describe('search notes', () => {
  test('search returns both archived and non-archived results', async ({ page }) => {
    const { account } = makeAccount();
    const tag = `srch${Date.now()}`;
    await seedNotes(account.address, [
      { title: `${tag} note 1` },
      { title: `${tag} note 2` },
      { title: `${tag} note 3`, archived: true },
    ]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByRole('textbox', { name: 'Search notes' }).fill(tag);

    await expect(notesPage.noteCard(`${tag} note 1`)).toBeVisible();
    await expect(notesPage.noteCard(`${tag} note 2`)).toBeVisible();
    await expect(notesPage.noteCard(`${tag} note 3`)).toBeVisible();

    // Archived card shows badge; active cards do not
    await expect(notesPage.noteCard(`${tag} note 3`).getByTestId('archived-badge')).toBeVisible();
    await expect(notesPage.noteCard(`${tag} note 1`).getByTestId('archived-badge')).not.toBeVisible();
  });

  test('search filters out non-matching notes', async ({ page }) => {
    const { account } = makeAccount();
    const catsTag = `cats${Date.now()}`;
    const dogsTag = `dogs${Date.now()}`;
    await seedNotes(account.address, [
      { title: `${catsTag} note` },
      { title: `${dogsTag} note` },
      { title: `${dogsTag} archived`, archived: true },
    ]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    await page.getByRole('button', { name: 'Search' }).click();
    const searchInput = page.getByRole('textbox', { name: 'Search notes' });

    await searchInput.fill(dogsTag);
    await expect(notesPage.noteCard(`${dogsTag} note`)).toBeVisible();
    await expect(notesPage.noteCard(`${dogsTag} archived`)).toBeVisible();
    await expect(notesPage.noteCard(`${catsTag} note`)).not.toBeVisible();

    await searchInput.fill('nomatch_xyz_99999');
    await expect(page.getByTestId('note-card')).toHaveCount(0);
  });

  test('clearing search hides archived notes', async ({ page }) => {
    const { account } = makeAccount();
    const tag = `clr${Date.now()}`;
    await seedNotes(account.address, [{ title: `${tag} active` }, { title: `${tag} archived`, archived: true }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    await page.getByRole('button', { name: 'Search' }).click();
    const searchInput = page.getByRole('textbox', { name: 'Search notes' });
    await searchInput.fill(tag);

    await expect(notesPage.noteCard(`${tag} active`)).toBeVisible();
    await expect(notesPage.noteCard(`${tag} archived`)).toBeVisible();

    await page.getByRole('button', { name: 'Clear search' }).click();

    await expect(notesPage.noteCard(`${tag} active`)).toBeVisible();
    await expect(notesPage.noteCard(`${tag} archived`)).not.toBeVisible();
  });
});

// ─── Group 4: Delete ─────────────────────────────────────────────────────────

test.describe('delete note', () => {
  test('delete note disappears from grid immediately', async ({ page }) => {
    const { account } = makeAccount();
    const title = `To Delete ${Date.now()}`;
    await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    await notesPage.noteCard(title).click();
    await expect(page.getByTestId('note-title')).toBeVisible();
    await page.getByTestId('delete-btn').click();

    await expect(notesPage.noteCard(title)).not.toBeVisible();
  });

  test('deleted note absent after page reload', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Delete Reload ${Date.now()}`;
    await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    await notesPage.noteCard(title).click();
    await page.getByTestId('delete-btn').click();
    await expect(notesPage.noteCard(title)).not.toBeVisible();

    await clearSession(page);
    await page.reload();
    await expect(page.getByTestId('display-name').first()).toBeVisible({ timeout: 10000 });
    await expect(notesPage.noteCard(title)).not.toBeVisible();
  });

  test('undo delete restores note', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Undo Delete ${Date.now()}`;
    await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    await notesPage.noteCard(title).click();
    await page.getByTestId('delete-btn').click();
    await expect(notesPage.noteCard(title)).not.toBeVisible();

    await page.getByRole('button', { name: 'Undo' }).click();

    await expect(notesPage.noteCard(title)).toBeVisible();
  });
});

// ─── Group 5: Edit Note ───────────────────────────────────────────────────────

test.describe('edit note', () => {
  test('edit note content updates content field', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Content Edit ${Date.now()}`;
    const [seededNote] = await seedNotes(account.address, [{ title, content: '<p>Old content</p>' }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    await notesPage.noteCard(title).click();
    await expect(page.getByTestId('note-title')).toBeVisible();
    await page.getByTestId('edit-btn').click();

    await page.getByTestId('tiptap-editor').click();
    await page.keyboard.press('Meta+a');
    await page.keyboard.type('New content');

    const patchPromise = page.waitForResponse(
      (r) => r.url().includes('/api/notes/') && r.request().method() === 'PATCH',
    );
    await page.getByTestId('save-btn').click();
    await patchPromise;

    const notesRes = await page.request.get('/api/notes');
    const notes = await notesRes.json();
    const updated = notes.find((n: { _id: string }) => n._id === seededNote._id.toString());
    expect(updated.content).toContain('New content');
  });

  test('edit note updates title and bumps updatedAt', async ({ page }) => {
    const { account } = makeAccount();
    const originalTitle = `Original ${Date.now()}`;
    const updatedTitle = `Updated ${Date.now() + 1}`;
    const [seededNote] = await seedNotes(account.address, [{ title: originalTitle }]);
    const originalUpdatedAt = new Date(seededNote.updatedAt).getTime();

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    await notesPage.noteCard(originalTitle).click();
    await expect(page.getByTestId('note-title')).toBeVisible();
    await page.getByTestId('edit-btn').click();

    await page.getByTestId('note-title-input').fill(updatedTitle);

    const patchPromise = page.waitForResponse(
      (r) => r.url().includes('/api/notes/') && r.request().method() === 'PATCH',
    );
    await page.getByTestId('save-btn').click();
    await patchPromise;

    // Updated title visible on card
    await expect(notesPage.noteCard(updatedTitle)).toBeVisible();

    // updatedAt must have increased
    const notesRes = await page.request.get('/api/notes');
    const notes = await notesRes.json();
    const updated = notes.find((n: { _id: string }) => n._id === seededNote._id.toString());
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(originalUpdatedAt);
  });
});

// ─── Group 6: Color ───────────────────────────────────────────────────────────

test.describe('note color', () => {
  test('change color applies to card and does not bump updatedAt', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Color Test ${Date.now()}`;
    const [seededNote] = await seedNotes(account.address, [{ title }]);
    const originalUpdatedAt = new Date(seededNote.updatedAt).getTime();

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    await notesPage.noteCard(title).click();
    await expect(page.getByTestId('note-title')).toBeVisible();

    const patchPromise = page.waitForResponse(
      (r) => r.url().includes('/api/notes/') && r.request().method() === 'PATCH',
    );
    await page.getByTestId('color-palette-btn').click();
    await page.getByTitle('Yellow').click();
    await patchPromise;

    // Card should have a non-default background color
    const card = notesPage.noteCard(title);
    const bgColor = await card.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(bgColor).not.toBe('transparent');

    // updatedAt must NOT have changed
    const notesRes = await page.request.get('/api/notes');
    const notes = await notesRes.json();
    const updated = notes.find((n: { _id: string }) => n._id === seededNote._id.toString());
    expect(new Date(updated.updatedAt).getTime()).toBe(originalUpdatedAt);
  });

  test('reset color to default clears color field', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Reset Color ${Date.now()}`;
    const [seededNote] = await seedNotes(account.address, [{ title, color: 'blue' }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    await notesPage.noteCard(title).click();
    await expect(page.getByTestId('note-title')).toBeVisible();

    const patchPromise = page.waitForResponse(
      (r) => r.url().includes('/api/notes/') && r.request().method() === 'PATCH',
    );
    await page.getByTestId('color-palette-btn').click();
    await page.getByTitle('Default').click();
    await patchPromise;

    const notesRes = await page.request.get('/api/notes');
    const notes = await notesRes.json();
    const updated = notes.find((n: { _id: string }) => n._id === seededNote._id.toString());
    expect(updated.color).toBeNull();
  });
});

// ─── Group 7: Modal Max Height ────────────────────────────────────────────────

test.describe('modal max height', () => {
  const bigContent = Array.from({ length: 200 }, (_, i) => `<p>Line ${i + 1}</p>`).join('');

  test('new note modal height is capped at 90% of window height', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    await page.getByTestId('new-note-btn').click();
    await expect(page.getByTestId('note-modal')).toBeVisible();

    await page.getByTestId('tiptap-editor').click();
    await page.keyboard.press('Enter');
    for (let i = 0; i < 200; i++) {
      await page.keyboard.press('Enter');
    }

    const modalBox = await page.getByTestId('note-modal').boundingBox();
    const windowHeight = await page.evaluate(() => window.innerHeight);

    expect(modalBox!.height).toBeLessThanOrEqual(windowHeight * 0.9 + 2);
  });

  test('note modal in view mode height is capped at 90% of window height', async ({ page }) => {
    const { account } = makeAccount();
    const title = `View Height ${Date.now()}`;
    await seedNotes(account.address, [{ title, content: bigContent }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    await notesPage.noteCard(title).click();
    await expect(page.getByTestId('note-modal')).toBeVisible();

    const modalBox = await page.getByTestId('note-modal').boundingBox();
    const windowHeight = await page.evaluate(() => window.innerHeight);

    expect(modalBox!.height).toBeLessThanOrEqual(windowHeight * 0.9 + 2);
  });

  test('note modal in edit mode height is capped at 90% of window height', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Edit Height ${Date.now()}`;
    await seedNotes(account.address, [{ title, content: bigContent }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    await notesPage.noteCard(title).click();
    await expect(page.getByTestId('note-modal')).toBeVisible();
    await page.getByTestId('edit-btn').click();

    const modalBox = await page.getByTestId('note-modal').boundingBox();
    const windowHeight = await page.evaluate(() => window.innerHeight);

    expect(modalBox!.height).toBeLessThanOrEqual(windowHeight * 0.9 + 2);
  });
});
