import { test, expect } from '@playwright/test';
import { NotesPage } from '../pages/NotesPage';

test.describe.configure({ mode: 'parallel' });

// ─── Desktop Sidebar Navigation ─────────────────────────────────────────────

test.describe('desktop sidebar navigation', () => {
  test('clicking Notes link navigates to /', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();
    await page.goto('/secrets');

    await page.getByRole('link', { name: 'Notes' }).click();
    await expect(page).toHaveURL('/');
  });

  test('clicking Secrets link navigates to /secrets', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    await page.getByRole('link', { name: 'Secrets' }).click();
    await expect(page).toHaveURL('/secrets');
  });

  test('clicking Seals link navigates to /seals', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    await page.getByRole('link', { name: 'Seals' }).click();
    await expect(page).toHaveURL('/seals');
  });

  test('active link is visually highlighted', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    // On the notes page, the Notes link should have the active class
    const notesLink = page.getByRole('link', { name: 'Notes' });
    await expect(notesLink).toHaveClass(/active/);

    // Navigate to secrets
    await page.getByRole('link', { name: 'Secrets' }).click();
    await expect(page).toHaveURL('/secrets');

    const secretsLink = page.getByRole('link', { name: 'Secrets' });
    await expect(secretsLink).toHaveClass(/active/);
    await expect(notesLink).not.toHaveClass(/active/);
  });
});

// ─── Mobile Drawer Navigation ───────────────────────────────────────────────

test.describe('mobile drawer navigation', () => {
  test.use({ viewport: { width: 400, height: 812 } });

  test('drawer navigation works', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();
    await page.getByTestId('mobile-menu-btn').click();

    const drawer = page.getByTestId('mobile-drawer');
    await drawer.getByRole('link', { name: 'Secrets' }).click();
    await expect(page).toHaveURL('/secrets');
  });

  test('drawer closes after navigation click', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();
    await page.getByTestId('mobile-menu-btn').click();

    const drawer = page.getByTestId('mobile-drawer');
    await drawer.getByRole('link', { name: 'Seals' }).click();

    await expect(page).toHaveURL('/seals');
    await expect(page.getByTestId('mobile-menu-btn')).toBeVisible();
  });
});
