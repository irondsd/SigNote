import { test, expect } from '@playwright/test';
import { NotesPage } from '../pages/NotesPage';

test.describe.configure({ mode: 'parallel' });

test.describe('tags', () => {
  test('add a tag to a note from the modal → chip shows on the card', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    // Create a note. Wait for the create POST *and* the follow-up list refetch so
    // the card carries the note's real _id, not its optimistic `temp-…` id —
    // editing a still-optimistic note would PATCH /api/notes/temp-… → 404.
    const title = `Tagged Note ${Date.now()}`;
    const createPost = page.waitForResponse(
      (r) => r.url().endsWith('/api/notes') && r.request().method() === 'POST' && r.ok(),
    );
    await page.getByTestId('new-note-btn').click();
    await page.getByTestId('note-title-input').fill(title);
    await page.getByTestId('save-note-btn').click();
    await createPost;
    await page.waitForResponse((r) => /\/api\/notes\?/.test(r.url()) && r.request().method() === 'GET');
    await expect(notesPage.noteCard(title)).toBeVisible();

    // Open it, reveal the tags strip, and create a brand-new tag from the palette.
    await notesPage.noteCard(title).click();
    await page.getByTestId('tag-toggle-btn').click(); // show the "Tags" strip
    await page.getByTestId('add-tag-btn').click(); // open the command palette

    const tagName = `urgent${Date.now()}`;
    const input = page.getByPlaceholder('Search or create a tag…');

    // Creating + adding the tag fires a fire-and-forget PATCH that persists it
    // on the note; wait for that response so the card reflects it deterministically.
    const tagsPatch = page.waitForResponse(
      (r) => /\/api\/notes\/[^/]+$/.test(r.url()) && r.request().method() === 'PATCH' && r.ok(),
    );
    await input.fill(tagName);
    await input.press('Enter');

    // The created tag appears as a removable chip in the strip.
    await expect(page.getByTestId('tag-strip').getByText(tagName, { exact: true })).toBeVisible();
    await tagsPatch;

    // Close the palette + modal; the chip should render on the card.
    await page.keyboard.press('Escape'); // close popover
    await page.getByRole('button', { name: 'Close' }).click();

    const card = notesPage.noteCard(title);
    await expect(card.getByTestId('card-tags')).toContainText(tagName);
  });

  test('tag manager creates a tag and exposes rename', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    await page.goto('/tags');
    await expect(page.getByRole('heading', { name: 'Tags' })).toBeVisible();

    const tagName = `manage${Date.now()}`;
    const createPost = page.waitForResponse(
      (r) => r.url().endsWith('/api/tags') && r.request().method() === 'POST' && r.ok(),
    );
    await page.getByPlaceholder('New tag name…').fill(tagName);
    await page.getByRole('button', { name: 'Add tag' }).click();
    await createPost;

    const row = page.getByTestId('tag-row').filter({ hasText: tagName });
    await expect(row).toBeVisible();
    // The manager exposes a per-row rename affordance.
    await expect(row.getByRole('button', { name: `Rename ${tagName}` })).toBeVisible();
  });
});
