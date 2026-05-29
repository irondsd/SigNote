import { test, expect } from '@playwright/test';
import { NotesPage } from '../pages/NotesPage';

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
