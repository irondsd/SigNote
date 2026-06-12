import { test, expect, type Page, type Locator } from '@playwright/test';
import { makeAccount } from '../utils/makeAccount';
import { seedNotes } from '../fixtures/seedNotes';
import { seedSecrets } from '../fixtures/seedSecrets';
import { seedSeals } from '../fixtures/seedSeals';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';
import { NotesPage } from '../pages/NotesPage';
import { SecretsPage } from '../pages/SecretsPage';
import { SealsPage } from '../pages/SealsPage';

test.describe.configure({ mode: 'parallel' });

// ─── Helpers ──────────────────────────────────────────────────────────────────
//
// Search is a frosted overlay (role="dialog", aria-label="Search") that floats
// over the current page. The page's own grid stays mounted behind it, so result
// assertions MUST be scoped to the dialog to avoid matching background cards.

const dialogOf = (page: Page): Locator => page.getByRole('dialog', { name: 'Search' });

async function openSearch(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Search' }).click();
  const dialog = dialogOf(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

const searchInput = (dialog: Locator): Locator => dialog.getByRole('textbox', { name: 'Search' });
const noteCardIn = (scope: Locator | Page, title: string): Locator =>
  scope.getByTestId('note-card').filter({ hasText: title });
const secretCardIn = (scope: Locator | Page, title: string): Locator =>
  scope.getByTestId('secret-card').filter({ hasText: title });
const tierSegment = (scope: Locator | Page, label: RegExp): Locator =>
  scope.getByRole('group', { name: 'Filter by tier' }).getByRole('button', { name: label });

// ─── Group 1: Overlay open / close ─────────────────────────────────────────────

test.describe('search overlay - open & close', () => {
  test('clicking the search button opens the overlay with the recents empty state', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    const dialog = await openSearch(page);
    await expect(dialog.getByRole('heading', { name: 'Search' })).toBeVisible();
    await expect(dialog.getByText('Browse a tier')).toBeVisible();
  });

  test('Escape closes the overlay', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    const dialog = await openSearch(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('clear button empties the input and returns to the recents state', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    const dialog = await openSearch(page);
    const input = searchInput(dialog);
    await input.fill('something');
    await expect(input).toHaveValue('something');

    // The X inside the input is the first "Clear search" control (above results in the DOM).
    await dialog.getByRole('button', { name: 'Clear search' }).first().click();
    await expect(input).toHaveValue('');
    await expect(dialog.getByText('Browse a tier')).toBeVisible();
  });
});

// ─── Group 2: Overlay results (notes) ───────────────────────────────────────────

test.describe('search overlay - note results', () => {
  test('returns both archived and non-archived matches, with a badge on the archived one', async ({ page }) => {
    const { account } = makeAccount();
    const tag = `srch${Date.now()}`;
    await seedNotes(account.address, [
      { title: `${tag} note 1` },
      { title: `${tag} note 2` },
      { title: `${tag} note 3`, archived: true },
    ]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    const dialog = await openSearch(page);
    await searchInput(dialog).fill(tag);

    await expect(noteCardIn(dialog, `${tag} note 1`)).toBeVisible();
    await expect(noteCardIn(dialog, `${tag} note 2`)).toBeVisible();
    await expect(noteCardIn(dialog, `${tag} note 3`)).toBeVisible();

    await expect(noteCardIn(dialog, `${tag} note 3`).getByTestId('archived-badge')).toBeVisible();
    await expect(noteCardIn(dialog, `${tag} note 1`).getByTestId('archived-badge')).toHaveCount(0);
  });

  test('filters out non-matching notes', async ({ page }) => {
    const { account } = makeAccount();
    const catsTag = `cats${Date.now()}`;
    const dogsTag = `dogs${Date.now()}`;
    await seedNotes(account.address, [{ title: `${catsTag} note` }, { title: `${dogsTag} note` }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    const dialog = await openSearch(page);
    await searchInput(dialog).fill(dogsTag);

    await expect(noteCardIn(dialog, `${dogsTag} note`)).toBeVisible();
    await expect(noteCardIn(dialog, `${catsTag} note`)).toHaveCount(0);
  });

  test('no matches shows the empty results state', async ({ page }) => {
    const { account } = makeAccount();
    await seedNotes(account.address, [{ title: `keep-${Date.now()}` }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    const dialog = await openSearch(page);
    await searchInput(dialog).fill('nomatch_xyz_99999');

    await expect(dialog.getByRole('heading', { name: 'No results found' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Clear search' }).last()).toBeVisible();
  });

  test('caps the overlay strip at 5 results and shows a "See all" link', async ({ page }) => {
    const { account } = makeAccount();
    const tag = `cap${Date.now()}`;
    await seedNotes(
      account.address,
      Array.from({ length: 6 }, (_, i) => ({ title: `${tag} note ${i}` })),
    );

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    const dialog = await openSearch(page);
    await searchInput(dialog).fill(tag);

    // 6 match but the overlay strip caps at 5, with a "See all" link to the full page.
    await expect(dialog.getByTestId('note-card').first()).toBeVisible();
    await expect(dialog.getByTestId('note-card')).toHaveCount(5);
    await expect(dialog.getByRole('link', { name: /See all/ })).toBeVisible();
  });
});

// ─── Group 3: Overlay results (secrets & seals) ─────────────────────────────────

test.describe('search overlay - encrypted tiers', () => {
  test('finds secrets by title (archived badge shown, body stays encrypted)', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SecretsPage.PASSPHRASE);
    const tag = `srch${Date.now()}`;
    await seedSecrets(account.address, mekBytes, [
      { title: `${tag} secret 1` },
      { title: `${tag} secret 2`, archived: true },
    ]);

    const secretsPage = new SecretsPage(page);
    await secretsPage.signInDirectly(account.address);

    const dialog = await openSearch(page);
    await searchInput(dialog).fill(tag);

    await expect(secretCardIn(dialog, `${tag} secret 1`)).toBeVisible();
    await expect(secretCardIn(dialog, `${tag} secret 2`)).toBeVisible();
    await expect(secretCardIn(dialog, `${tag} secret 2`).getByTestId('archived-badge')).toBeVisible();
  });

  test('finds seals by title', async ({ page }) => {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);
    const tag = `srch${Date.now()}`;
    await seedSeals(account.address, mekBytes, [{ title: `${tag} seal 1` }, { title: `${tag} seal 2` }]);

    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly(account.address);

    const dialog = await openSearch(page);
    await searchInput(dialog).fill(tag);

    await expect(secretCardIn(dialog, `${tag} seal 1`)).toBeVisible();
    await expect(secretCardIn(dialog, `${tag} seal 2`)).toBeVisible();
  });
});

// ─── Group 4: Tier filter ───────────────────────────────────────────────────────

test.describe('search overlay - tier filter', () => {
  test('deselecting a tier hides its results', async ({ page }) => {
    const { account } = makeAccount();
    const tag = `tier${Date.now()}`;
    await seedNotes(account.address, [{ title: `${tag} note` }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    const dialog = await openSearch(page);
    await searchInput(dialog).fill(tag);
    await expect(noteCardIn(dialog, `${tag} note`)).toBeVisible();

    // Turn the Notes tier off → its strip disappears.
    await tierSegment(dialog, /Notes/).click();
    await expect(noteCardIn(dialog, `${tag} note`)).toHaveCount(0);
  });

  test('a deselected tier shows no count badge', async ({ page }) => {
    const { account } = makeAccount();
    const tag = `cntbadge${Date.now()}`;
    await seedNotes(account.address, [{ title: `${tag} note` }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    const dialog = await openSearch(page);
    await searchInput(dialog).fill(tag);

    // Active Notes tier shows its match count…
    await expect(tierSegment(dialog, /Notes/)).toContainText('1');

    // …but once deselected it must not display a "0" (or any) count badge.
    await tierSegment(dialog, /Notes/).click();
    await expect(tierSegment(dialog, /Notes/)).not.toContainText(/\d/);
  });
});

// ─── Group 5: Browse a tier ─────────────────────────────────────────────────────

test.describe('search overlay - browse a tier', () => {
  test('clicking a different tier navigates to that tier page', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    const dialog = await openSearch(page);
    await dialog.getByRole('link', { name: 'Secrets' }).click();
    await expect(page).toHaveURL('/secrets');
  });

  test('clicking the tier you are already on just closes the overlay', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(); // lands on "/" (Notes)

    const dialog = await openSearch(page);
    // Notes links to "/", which is the current route — navigation is a no-op,
    // so the overlay must close itself.
    await dialog.getByRole('link', { name: 'Notes' }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL('/');
  });
});

// ─── Group 6: Submitting to the /search results page ────────────────────────────

test.describe('search results page', () => {
  test('pressing Enter navigates to the results page and closes the overlay', async ({ page }) => {
    const { account } = makeAccount();
    const tag = `go${Date.now()}`;
    await seedNotes(account.address, [{ title: `${tag} note` }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    const dialog = await openSearch(page);
    await searchInput(dialog).fill(tag);
    await searchInput(dialog).press('Enter');

    await page.waitForURL(/\/search\?q=/);
    await expect(dialog).toBeHidden();
    await expect(noteCardIn(page, `${tag} note`)).toBeVisible();
  });

  test('opening /search directly shows results without a "See all" link', async ({ page }) => {
    const { account } = makeAccount();
    const tag = `direct${Date.now()}`;
    await seedNotes(account.address, [{ title: `${tag} note a` }, { title: `${tag} note b` }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await page.goto(`/search?q=${tag}`);

    await expect(noteCardIn(page, `${tag} note a`)).toBeVisible();
    await expect(noteCardIn(page, `${tag} note b`)).toBeVisible();
    // "See all" is overlay-only.
    await expect(page.getByRole('link', { name: /See all/ })).toHaveCount(0);
  });

  test('the tiers query param restricts which tiers are searched', async ({ page }) => {
    const { account } = makeAccount();
    const tag = `param${Date.now()}`;
    await seedNotes(account.address, [{ title: `${tag} note` }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    // Restrict to secrets only — the seeded note must NOT appear.
    await page.goto(`/search?q=${tag}&tiers=secrets`);

    await expect(page.getByRole('heading', { name: 'No results found' })).toBeVisible();
    await expect(noteCardIn(page, `${tag} note`)).toHaveCount(0);
  });

  test('the tier filter shows result counts', async ({ page }) => {
    const { account } = makeAccount();
    const tag = `cnt${Date.now()}`;
    await seedNotes(account.address, [{ title: `${tag} a` }, { title: `${tag} b` }, { title: `${tag} c` }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await page.goto(`/search?q=${tag}`);

    await expect(noteCardIn(page, `${tag} a`)).toBeVisible();
    await expect(tierSegment(page, /Notes/)).toContainText('3');
  });
});

// ─── Group 7: Recent searches ───────────────────────────────────────────────────

test.describe('recent searches', () => {
  test('a submitted query is remembered and can be re-run from the recents list', async ({ page }) => {
    const { account } = makeAccount();
    const tag = `recent${Date.now()}`;
    await seedNotes(account.address, [{ title: `${tag} note` }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    // Submit a search (saves it to localStorage), then return to the notes page.
    let dialog = await openSearch(page);
    await searchInput(dialog).fill(tag);
    await searchInput(dialog).press('Enter');
    await page.waitForURL(/\/search\?q=/);

    await page.goto('/');
    dialog = await openSearch(page);

    const recentPill = dialog.getByRole('button', { name: tag });
    await expect(recentPill).toBeVisible();

    // Clicking it refills the input and runs the search again.
    await recentPill.click();
    await expect(searchInput(dialog)).toHaveValue(tag);
    await expect(noteCardIn(dialog, `${tag} note`)).toBeVisible();
  });
});
