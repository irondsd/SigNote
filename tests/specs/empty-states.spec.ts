import { test, expect } from '@playwright/test';
import { seedNotes } from '../fixtures/seedNotes';
import { NotesPage } from '../pages/NotesPage';
import { clearSession } from '../utils/clearSession';

test.describe.configure({ mode: 'parallel' });

// ─── Empty State: Notes ─────────────────────────────────────────────────────

test.describe('empty state - notes', () => {
  test('shows empty state when no notes exist', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    await expect(page.getByRole('heading', { name: 'No notes yet' })).toBeVisible();
    await expect(page.getByText('Create your first note to get started.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create a note' })).toBeVisible();
  });

  test('create button in empty state opens new note modal', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    await page.getByRole('button', { name: 'Create a note' }).click();
    await expect(page.getByTestId('note-title-input')).toBeVisible();
  });
});

// ─── Empty Results: Search ──────────────────────────────────────────────────

test.describe('empty results - search', () => {
  test('shows empty results for no-match search', async ({ page }) => {
    const notesPage = new NotesPage(page);
    const { address } = await notesPage.signInDirectly();
    await seedNotes(address, [{ title: 'Existing Note' }]);
    await clearSession(page);
    await page.reload();
    await expect(page.getByText('Existing Note')).toBeVisible();

    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByRole('textbox', { name: 'Search notes' }).fill('nomatch_xyz_99999');

    await expect(page.getByRole('heading', { name: 'No results found' })).toBeVisible();
    await expect(page.getByText('Clear search')).toBeVisible();
  });

  test('clear search button restores notes', async ({ page }) => {
    const notesPage = new NotesPage(page);
    const { address } = await notesPage.signInDirectly();
    await seedNotes(address, [{ title: 'Visible Note' }]);
    await clearSession(page);
    await page.reload();
    await expect(page.getByText('Visible Note')).toBeVisible();

    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByRole('textbox', { name: 'Search notes' }).fill('nomatch_xyz_99999');
    await expect(page.getByRole('heading', { name: 'No results found' })).toBeVisible();

    // Click the "Clear search" button inside the empty results component (not the search bar X icon)
    await page.getByText('Clear search').click();
    await expect(page.getByText('Visible Note')).toBeVisible();
  });
});

// ─── Empty Archive ──────────────────────────────────────────────────────────

test.describe('empty archive', () => {
  test('shows empty archive state when no archived notes', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();
    await page.goto('/archive');

    await expect(page.getByRole('heading', { name: 'Your archive is empty' })).toBeVisible();
    await expect(page.getByText("You haven't archived any notes yet.")).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go back' })).toBeVisible();
  });

  test('go back link navigates to main page', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();
    await page.goto('/archive');

    await page.getByRole('link', { name: 'Go back' }).click();
    await expect(page).toHaveURL('/');
  });
});

// ─── Unauthenticated State ──────────────────────────────────────────────────

test.describe('unauthenticated state', () => {
  test('shows welcome message when not signed in', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(page.getByText('Sign in to access your notes')).toBeVisible();
  });
});
