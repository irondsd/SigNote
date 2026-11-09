import { test, expect, type Page } from '@playwright/test';
import { makeAccount } from '../utils/makeAccount';
import { seedNotes } from '../fixtures/seedNotes';
import { NotesPage } from '../pages/NotesPage';
import { trpcData, trpcMutationOf, trpcQuery } from '../utils/trpc';
import { settleModal } from '../utils/settleModal';

test.describe.configure({ mode: 'parallel' });

// Snoozing archives a note until a date. Once the date has passed the note
// lists among the active ones again — still `archived` in storage — and the
// first open makes it an ordinary note. Nothing runs on a timer: these specs
// seed the "date has passed" state directly.

const DAY = 86_400_000;

type ListedNote = { _id: string; archived: boolean; snoozedUntil: string | null };

async function fetchNote(page: Page, id: string): Promise<ListedNote | null> {
  const notes = await trpcData<ListedNote[]>(await trpcQuery(page.request, 'notes.list', {}));
  return notes.find((n) => n._id === id) ?? null;
}

async function openSnoozePicker(page: Page) {
  await settleModal(page);
  await page.getByTestId('more-actions-btn').click();
  await page.getByTestId('snooze-item').click();
  await expect(page.getByTestId('snooze-picker')).toBeVisible();
}

async function closeModal(page: Page) {
  await settleModal(page);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('note-title')).toHaveCount(0);
}

test('snoozing a note moves it to the archive with its return date', async ({ page }) => {
  const { account } = makeAccount();
  const title = `Snooze me ${Date.now()}`;
  // A second note keeps the grid — which hosts the open modal — mounted once
  // this one leaves the list; an emptied list swaps the grid for the empty state.
  const [note] = await seedNotes(account.address, [{ title }, { title: `Stays ${Date.now()}` }]);

  const notesPage = new NotesPage(page);
  await notesPage.signInDirectly(account.address);
  await notesPage.noteCard(title).click();

  await openSnoozePicker(page);
  await page.getByTestId('snooze-preset-week').click();
  const saved = page.waitForResponse(trpcMutationOf('notes.setSnooze'));
  await page.getByTestId('snooze-commit-btn').click();
  await saved;

  await expect(page.getByTestId('snooze-banner')).toContainText(/snoozed until/i);
  await closeModal(page);
  await expect(notesPage.noteCard(title)).toHaveCount(0);

  const stored = await fetchNote(page, note._id);
  expect(stored?.archived).toBe(true);
  // A snooze ends at the start of a local day, a week out.
  const until = new Date(stored!.snoozedUntil!).getTime();
  expect(until).toBeGreaterThan(Date.now() + 5 * DAY);
  expect(until).toBeLessThan(Date.now() + 8 * DAY);

  await notesPage.goto('/archive');
  await expect(notesPage.noteCard(title).getByTestId('snoozed-badge')).toBeVisible();
});

test('a note whose date has passed is back in the notes list, marked until opened', async ({ page }) => {
  const { account } = makeAccount();
  const tag = `back-${Date.now()}`;
  const [, back] = await seedNotes(account.address, [
    { title: `${tag} newer` },
    { title: `${tag} returned`, archived: true, snoozedUntil: new Date(Date.now() - DAY) },
  ]);

  const notesPage = new NotesPage(page);
  await notesPage.signInDirectly(account.address);

  const card = notesPage.noteCard(`${tag} returned`);
  await expect(card.getByTestId('snooze-flag')).toBeVisible();
  // Nothing has been written yet: it is listed as active while still archived.
  expect((await fetchNote(page, back._id))?.archived).toBe(true);

  const woke = page.waitForResponse(trpcMutationOf('notes.setSnooze'));
  await card.click();
  await woke;
  await expect(page.getByTestId('snooze-banner')).toContainText(/back from snooze/i);

  await closeModal(page);
  await expect(card).toBeVisible();
  await expect(card.getByTestId('snooze-flag')).toHaveCount(0);

  const stored = await fetchNote(page, back._id);
  expect(stored?.archived).toBe(false);
  expect(stored?.snoozedUntil).toBeNull();

  await notesPage.goto('/archive');
  await expect(notesPage.noteCard(`${tag} returned`)).toHaveCount(0);
});

test('a snoozed note can be woken early from the archive', async ({ page }) => {
  const { account } = makeAccount();
  const title = `Wake early ${Date.now()}`;
  const [note] = await seedNotes(account.address, [
    { title, archived: true, snoozedUntil: new Date(Date.now() + 30 * DAY) },
  ]);

  const notesPage = new NotesPage(page);
  await notesPage.signInDirectly(account.address);
  await expect(notesPage.noteCard(title)).toHaveCount(0);

  await notesPage.goto('/archive');
  await notesPage.noteCard(title).click();
  await openSnoozePicker(page);
  const woke = page.waitForResponse(trpcMutationOf('notes.setSnooze'));
  await page.getByTestId('snooze-wake-btn').click();
  await woke;

  const stored = await fetchNote(page, note._id);
  expect(stored?.archived).toBe(false);
  expect(stored?.snoozedUntil).toBeNull();

  await notesPage.goto('/');
  await expect(notesPage.noteCard(title)).toBeVisible();
});
