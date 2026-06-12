import { test, expect, type Page } from '@playwright/test';
import { makeAccount } from '../utils/makeAccount';
import { seedNotes } from '../fixtures/seedNotes';
import { NotesPage } from '../pages/NotesPage';

test.describe.configure({ mode: 'parallel' });

/** Wait for the modal's open-from-card animation to settle. */
async function waitForModalStable(page: Page) {
  await page.getByTestId('note-modal').evaluate(async (el) => {
    let prev = -1;
    let stable = 0;
    for (let i = 0; i < 180; i++) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const animating = el.getAnimations({ subtree: true }).some((a) => a.playState === 'running');
      const h = el.getBoundingClientRect().height;
      if (!animating && Math.abs(h - prev) < 0.5) stable++;
      else stable = 0;
      prev = h;
      if (stable >= 6) return;
    }
  });
}

const HOUR = 3600_000;

/** A head note with two historical versions (oldest → newest). */
function seededHistory(tag: string) {
  return {
    title: `${tag} head`,
    content: `<p>${tag} head body</p>`,
    versions: [
      { title: `${tag} v1`, content: `<p>${tag} v1 body</p>`, createdAt: new Date(Date.now() - 2 * HOUR) },
      { title: `${tag} v2`, content: `<p>${tag} v2 body</p>`, createdAt: new Date(Date.now() - 1 * HOUR) },
    ],
  };
}

async function openHistory(notesPage: NotesPage, title: string) {
  const page = notesPage.page;
  await notesPage.noteCard(title).click();
  await expect(page.getByTestId('note-title')).toBeVisible();
  await waitForModalStable(page);
  await page.getByTestId('more-actions-btn').click();
  await page.getByTestId('version-history-item').click();
  await expect(page.getByTestId('version-sidebar')).toBeVisible();
}

test.describe('version history', () => {
  test('menu opens the timeline with the version count', async ({ page }) => {
    const { account } = makeAccount();
    const tag = `vh-open-${Date.now()}`;
    await seedNotes(account.address, [seededHistory(tag)]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    await notesPage.noteCard(`${tag} head`).click();
    await expect(page.getByTestId('note-title')).toBeVisible();
    await waitForModalStable(page);
    await page.getByTestId('more-actions-btn').click();

    await page.getByTestId('version-history-item').click();

    await expect(page.getByTestId('version-sidebar')).toBeVisible();
    // 2 seeded versions + the current head.
    await expect(page.getByTestId('version-count')).toHaveText('3');
    await expect(page.getByTestId('version-row')).toHaveCount(3);
    await expect(page.getByTestId('version-row').first()).toContainText('Current');
    // Current head is shown by default.
    await expect(page.getByTestId('version-content')).toContainText(`${tag} head body`);
  });

  test('selecting a past version previews it; restore swaps the head and is undoable', async ({ page }) => {
    const { account } = makeAccount();
    const tag = `vh-restore-${Date.now()}`;
    await seedNotes(account.address, [seededHistory(tag)]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await openHistory(notesPage, `${tag} head`);

    // Oldest row = v1.
    await page.getByTestId('version-row').last().click();
    await expect(page.getByTestId('version-content')).toContainText(`${tag} v1 body`);
    await expect(page.getByTestId('version-title')).toContainText(`${tag} v1`);

    const restorePromise = page.waitForResponse(
      (r) => r.url().includes('/versions/') && r.url().endsWith('/restore') && r.request().method() === 'POST',
    );
    await page.getByTestId('version-restore-btn').click();
    await restorePromise;

    // Back on the (new) head; the pre-restore head was snapshotted → 4 entries.
    await expect(page.getByText(/You.re on the latest version/)).toBeVisible();
    await expect(page.getByTestId('version-content')).toContainText(`${tag} v1 body`);
    await expect(page.getByTestId('version-row')).toHaveCount(4);

    // Undo from the toast brings the old head back.
    const undoPromise = page.waitForResponse(
      (r) => r.url().includes('/versions/') && r.url().endsWith('/restore') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Undo' }).click();
    await undoPromise;
    await expect(page.getByTestId('version-content')).toContainText(`${tag} head body`);

    // Closing history returns to the regular note modal with the head intact.
    await page.getByTestId('version-history-close').click();
    await expect(page.getByTestId('note-title')).toContainText(`${tag} head`);
  });

  test('deleting a version removes its row', async ({ page }) => {
    const { account } = makeAccount();
    const tag = `vh-delete-${Date.now()}`;
    await seedNotes(account.address, [seededHistory(tag)]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await openHistory(notesPage, `${tag} head`);

    await expect(page.getByTestId('version-row')).toHaveCount(3);
    await page.getByTestId('version-row').last().click();

    const deletePromise = page.waitForResponse(
      (r) => r.url().includes('/versions/') && r.request().method() === 'DELETE',
    );
    await page.getByTestId('version-delete-btn').click();
    await deletePromise;

    await expect(page.getByTestId('version-row')).toHaveCount(2);
    // Selection falls back to the current head.
    await expect(page.getByText(/You.re on the latest version/)).toBeVisible();
  });

  test('an edit records a version organically', async ({ page }) => {
    const { account } = makeAccount();
    const tag = `vh-edit-${Date.now()}`;
    await seedNotes(account.address, [{ title: `${tag} note`, content: `<p>${tag} original</p>` }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    await notesPage.noteCard(`${tag} note`).click();
    await waitForModalStable(page);
    await page.getByTestId('edit-btn').click();
    await page.getByTestId('note-title-input').fill(`${tag} edited`);

    const patchPromise = page.waitForResponse(
      (r) => r.url().includes('/api/notes/') && r.request().method() === 'PATCH',
    );
    await page.getByTestId('save-btn').click();
    await patchPromise;

    await page.getByTestId('more-actions-btn').click();
    await page.getByTestId('version-history-item').click();

    await expect(page.getByTestId('version-count')).toHaveText('2');
    await expect(page.getByTestId('version-row')).toHaveCount(2);
    await page.getByTestId('version-row').last().click();
    await expect(page.getByTestId('version-title')).toContainText(`${tag} note`);
    await expect(page.getByTestId('version-content')).toContainText(`${tag} original`);
  });

  test('timeline refreshes after an edit instead of serving the stale cache', async ({ page }) => {
    const { account } = makeAccount();
    const tag = `vh-stale-${Date.now()}`;
    await seedNotes(account.address, [seededHistory(tag)]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    // Open history once so the versions query is cached, then go back.
    await openHistory(notesPage, `${tag} head`);
    await expect(page.getByTestId('version-row')).toHaveCount(3);
    await page.getByTestId('version-history-close').click();

    // Edit the note. The seeded versions are hours old (outside the
    // compression window), so this edit records a fresh snapshot.
    await page.getByTestId('edit-btn').click();
    await page.getByTestId('note-title-input').fill(`${tag} edited`);
    const patchPromise = page.waitForResponse(
      (r) => r.url().includes('/api/notes/') && r.request().method() === 'PATCH',
    );
    await page.getByTestId('save-btn').click();
    await patchPromise;

    // Reopening history must show the new snapshot, not the cached list.
    await page.getByTestId('more-actions-btn').click();
    await page.getByTestId('version-history-item').click();
    await expect(page.getByTestId('version-count')).toHaveText('4');
    await expect(page.getByTestId('version-row')).toHaveCount(4);
    await expect(page.getByTestId('version-row').nth(1)).toContainText(`Version 3`);
  });
});
