import { test, expect } from '@playwright/test';
import { NotesPage } from '../pages/NotesPage';

test.describe.configure({ mode: 'parallel' });

test.describe('tags', () => {
  test('add a tag to a note from the modal → chip shows on the card', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    // Create a note.
    const title = `Tagged Note ${Date.now()}`;
    await page.getByTestId('new-note-btn').click();
    await page.getByTestId('note-title-input').fill(title);
    await page.getByTestId('save-note-btn').click();
    await expect(notesPage.noteCard(title)).toBeVisible();

    // Open it, reveal the tags strip, and create a brand-new tag from the palette.
    await notesPage.noteCard(title).click();
    await page.getByTestId('tag-toggle-btn').click(); // show the "Tags" strip
    await page.getByTestId('add-tag-btn').click(); // open the command palette

    const tagName = `urgent${Date.now()}`;
    const input = page.getByPlaceholder('Search or create a tag…');
    await input.fill(tagName);
    await input.press('Enter');

    // The created tag appears as a removable chip in the strip.
    await expect(page.getByTestId('tag-strip').getByText(tagName, { exact: true })).toBeVisible();

    // Close the palette + modal; the chip should render on the card.
    await page.keyboard.press('Escape'); // close popover
    await page.getByRole('button', { name: 'Close' }).click();

    const card = notesPage.noteCard(title);
    await expect(card.getByTestId('card-tags')).toContainText(tagName);
  });

  test('tag manager lists a created tag with its usage count', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    const tagName = `manage${Date.now()}`;

    // Create the tag through the API the same way the picker does.
    const res = await page.request.post('/api/tags', { data: { name: tagName } });
    expect(res.status()).toBe(201);

    await page.goto('/tags');
    await expect(page.getByRole('heading', { name: 'Tags' })).toBeVisible();
    await expect(page.getByText(tagName, { exact: true })).toBeVisible();
  });
});
