import { test, expect } from '@playwright/test';
import { NotesPage } from '../pages/NotesPage';
import { SecretsPage } from '../pages/SecretsPage';
import { SealsPage } from '../pages/SealsPage';
import { makeAccount } from '../utils/makeAccount';
import { seedTags } from '../fixtures/seedTags';

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

  test('search palette: clicking a tag tokenises it and filters results in place', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    // Seed a tag and a note carrying it, directly via the API (shares the session).
    const tagName = `flt${Date.now()}`;
    const tagRes = await page.request.post('/api/tags', { data: { name: tagName } });
    const tagId = (await tagRes.json())._id as string;
    const noteTitle = `Filterable ${Date.now()}`;
    const noteRes = await page.request.post('/api/notes', { data: { title: noteTitle, content: '<p>body</p>' } });
    const noteId = (await noteRes.json())._id as string;
    await page.request.patch(`/api/notes/${noteId}`, { data: { tags: [tagId] } });

    // Reload so the notes/tags caches are fresh, then open the search palette.
    await page.goto('/');
    await page.getByRole('button', { name: 'Search' }).first().click();

    // The tag shows under "Filter by tag"; clicking it filters in place (no nav).
    const dialog = page.getByRole('dialog', { name: 'Search' });
    await dialog.getByText(tagName, { exact: true }).click();

    // It becomes a token in the input and the tagged note appears in results.
    await expect(dialog.getByRole('textbox')).toHaveValue('');
    await expect(dialog.getByText(noteTitle, { exact: true })).toBeVisible();
    await expect(page).toHaveURL('/'); // stayed on the page, filtered in place
  });
});

// ─── Route-level API contract ─────────────────────────────────────────────────
// Same page.request pattern as api-patch-contract.spec.ts: a real session
// against the real route handlers, covering validation, ownership and limits.

test.describe('tag API routes', () => {
  test('POST normalizes the name and is idempotent on duplicates', async ({ page }) => {
    await new NotesPage(page).signInDirectly();

    const name = `MiXeD${Date.now()}`;
    const first = await page.request.post('/api/tags', { data: { name: `  ${name}  ` } });
    expect(first.status()).toBe(201);
    const created = await first.json();
    expect(created.name).toBe(name.toLowerCase());

    const again = await page.request.post('/api/tags', { data: { name: name.toLowerCase() } });
    expect((await again.json())._id).toBe(created._id);
  });

  test('PATCH: 409 on taken name, 400 on bad color, name+color applied together', async ({ page }) => {
    await new NotesPage(page).signInDirectly();

    const base = Date.now();
    const a = await (await page.request.post('/api/tags', { data: { name: `a${base}` } })).json();
    const b = await (await page.request.post('/api/tags', { data: { name: `b${base}` } })).json();

    const conflict = await page.request.patch(`/api/tags/${b._id}`, { data: { name: a.name } });
    expect(conflict.status()).toBe(409);

    const badColor = await page.request.patch(`/api/tags/${b._id}`, { data: { color: 'magenta' } });
    expect(badColor.status()).toBe(400);

    const both = await page.request.patch(`/api/tags/${b._id}`, {
      data: { name: `c${base}`, color: 'green' },
    });
    expect(both.ok()).toBe(true);
    const updated = await both.json();
    expect(updated.name).toBe(`c${base}`);
    expect(updated.color).toBe('green');

    const empty = await page.request.patch(`/api/tags/${b._id}`, { data: {} });
    expect(empty.status()).toBe(400);
  });

  test('foreign tags cannot be renamed or deleted; malformed ids are 404', async ({ page }) => {
    await new NotesPage(page).signInDirectly();

    const { account: stranger } = makeAccount();
    const [foreign] = await seedTags(stranger.address, [{ name: `foreign${Date.now()}` }]);
    const foreignId = foreign._id.toString();

    expect((await page.request.patch(`/api/tags/${foreignId}`, { data: { name: 'mine-now' } })).status()).toBe(403);
    expect((await page.request.delete(`/api/tags/${foreignId}`)).status()).toBe(403);
    expect((await page.request.patch('/api/tags/not-an-id', { data: { name: 'x' } })).status()).toBe(404);
  });

  test('DELETE removes the tag and detaches it from notes', async ({ page }) => {
    await new NotesPage(page).signInDirectly();

    const tag = await (await page.request.post('/api/tags', { data: { name: `gone${Date.now()}` } })).json();
    const note = await (
      await page.request.post('/api/notes', {
        data: { title: `Detach ${Date.now()}`, content: '<p>x</p>', tags: [tag._id] },
      })
    ).json();
    expect(note.tags).toEqual([tag._id]);

    expect((await page.request.delete(`/api/tags/${tag._id}`)).ok()).toBe(true);

    const list = await (await page.request.get('/api/notes')).json();
    const fresh = list.find((n: { _id: string }) => n._id === note._id);
    expect(fresh.tags).toEqual([]);
  });

  test('per-note cap: more than 10 tags rejected on create and update', async ({ page }) => {
    await new NotesPage(page).signInDirectly();

    // The cap applies to the raw incoming list, so synthetic ids suffice.
    const eleven = Array.from({ length: 11 }, (_, i) => String(i).padStart(24, '0'));

    const create = await page.request.post('/api/notes', {
      data: { title: 'too many', content: '<p>x</p>', tags: eleven },
    });
    expect(create.status()).toBe(400);

    const note = await (
      await page.request.post('/api/notes', { data: { title: `cap ${Date.now()}`, content: '<p>x</p>' } })
    ).json();
    const patch = await page.request.patch(`/api/notes/${note._id}`, { data: { tags: eleven } });
    expect(patch.status()).toBe(400);
  });

  test('foreign and malformed tag ids are silently dropped on create', async ({ page }) => {
    await new NotesPage(page).signInDirectly();

    const owned = await (await page.request.post('/api/tags', { data: { name: `own${Date.now()}` } })).json();
    const { account: stranger } = makeAccount();
    const [foreign] = await seedTags(stranger.address, [{ name: `their${Date.now()}` }]);

    const note = await (
      await page.request.post('/api/notes', {
        data: {
          title: `Sanitize ${Date.now()}`,
          content: '<p>x</p>',
          tags: [owned._id, foreign._id.toString(), 'not-an-objectid'],
        },
      })
    ).json();
    expect(note.tags).toEqual([owned._id]);
  });
});

// ─── Tag manager + note card propagation ──────────────────────────────────────

test.describe('tag management UI', () => {
  test('rename persists and propagates to the note card', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    const name = `old${Date.now()}`;
    const tag = await (await page.request.post('/api/tags', { data: { name } })).json();
    const title = `Rename prop ${Date.now()}`;
    await page.request.post('/api/notes', { data: { title, content: '<p>b</p>', tags: [tag._id] } });

    await page.goto('/tags');
    await expect(page.getByRole('heading', { name: 'Tags' })).toBeVisible();

    // Don't filter the row by the tag's text: entering rename mode swaps the
    // chip for an input, so a text-filtered locator stops matching mid-click.
    await page.getByRole('button', { name: `Rename ${name}` }).click();

    const newName = `new${Date.now()}`;
    const patched = page.waitForResponse(
      (r) => r.url().includes(`/api/tags/${tag._id}`) && r.request().method() === 'PATCH' && r.ok(),
    );
    const renameInput = page.getByTestId('tag-row').locator('input'); // the only row this account has
    await renameInput.fill(newName);
    await renameInput.press('Enter');
    await patched;

    // The note card resolves tag ids through the tags cache, so it must show
    // the new name without the note itself being touched.
    await page.goto('/');
    await expect(notesPage.noteCard(title)).toBeVisible({ timeout: 15000 });
    await expect(notesPage.noteCard(title).getByTestId('card-tags')).toContainText(newName, { timeout: 15000 });
  });

  test('recolor persists across reload', async ({ page }) => {
    await new NotesPage(page).signInDirectly();

    const name = `paint${Date.now()}`;
    const tagRes = await page.request.post('/api/tags', { data: { name, color: 'red' } });
    expect(tagRes.status()).toBe(201);
    const tag = await tagRes.json();

    await page.goto('/tags');
    await expect(page.getByRole('heading', { name: 'Tags' })).toBeVisible();
    const row = page.getByTestId('tag-row').filter({ hasText: name });
    await row.getByRole('button', { name: 'Red' }).click();

    const patched = page.waitForResponse(
      (r) => r.url().includes(`/api/tags/${tag._id}`) && r.request().method() === 'PATCH' && r.ok(),
    );
    await page.getByRole('button', { name: 'blue', exact: true }).click();
    await patched;

    await page.reload();
    await expect(
      page.getByTestId('tag-row').filter({ hasText: name }).getByRole('button', { name: 'Blue' }),
    ).toBeVisible({ timeout: 15000 });
  });

  test('removing a tag chip in the modal removes it from the card', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    const name = `strip${Date.now()}`;
    const tag = await (await page.request.post('/api/tags', { data: { name } })).json();
    const title = `Unstrip ${Date.now()}`;
    await page.request.post('/api/notes', { data: { title, content: '<p>b</p>', tags: [tag._id] } });

    await page.goto('/');
    await notesPage.noteCard(title).click();

    // The strip defaults open when the note already has tags.
    const patched = page.waitForResponse(
      (r) => /\/api\/notes\/[^/]+$/.test(r.url()) && r.request().method() === 'PATCH' && r.ok(),
    );
    await page.getByTestId('tag-strip').getByRole('button', { name: `Remove ${name}` }).click();
    await patched;

    await page.getByRole('button', { name: 'Close' }).click();
    await expect(notesPage.noteCard(title).getByTestId('card-tags')).toBeHidden();
  });

  test('creating a note with a tag pre-selected persists the tag', async ({ page }) => {
    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly();

    const name = `pre${Date.now()}`;
    const tag = await (await page.request.post('/api/tags', { data: { name } })).json();
    await page.goto('/'); // full reload so the tags cache includes the seeded tag

    const title = `Preselected ${Date.now()}`;
    await page.getByTestId('new-note-btn').click();
    await page.getByTestId('note-title-input').fill(title);
    await page.getByTestId('tag-toggle-btn').click();
    await page.getByTestId('add-tag-btn').click();

    const input = page.getByPlaceholder('Search or create a tag…');
    await input.fill(name);
    await input.press('Enter'); // exact match → adds the existing tag
    await expect(page.getByTestId('tag-strip').getByText(name, { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    const created = page.waitForResponse(
      (r) => r.url().endsWith('/api/notes') && r.request().method() === 'POST' && r.ok(),
    );
    await page.getByTestId('save-note-btn').click();
    const body = await (await created).json();
    expect(body.tags).toEqual([tag._id]);

    await expect(notesPage.noteCard(title).getByTestId('card-tags')).toContainText(name);
  });

  test('deep link /search?tag= shows only notes carrying that tag', async ({ page }) => {
    await new NotesPage(page).signInDirectly();

    const tag = await (await page.request.post('/api/tags', { data: { name: `deep${Date.now()}` } })).json();
    const taggedTitle = `Tagged deep ${Date.now()}`;
    const plainTitle = `Plain deep ${Date.now()}`;
    await page.request.post('/api/notes', { data: { title: taggedTitle, content: '<p>x</p>', tags: [tag._id] } });
    await page.request.post('/api/notes', { data: { title: plainTitle, content: '<p>x</p>' } });

    await page.goto(`/search?tag=${tag._id}`);
    await expect(page.getByText(taggedTitle, { exact: true })).toBeVisible();
    await expect(page.getByText(plainTitle, { exact: true })).toBeHidden();
  });
});

// ─── Encrypted tiers ──────────────────────────────────────────────────────────
// Tags share one code path across tiers, but the strip lives inside different
// modals — make sure secrets and seals actually persist and render them.

test.describe('tags on encrypted tiers', () => {
  test('add a tag while creating a secret → chip shows on the card', async ({ page }) => {
    const secretsPage = new SecretsPage(page);
    await secretsPage.signInDirectly();
    await secretsPage.unlock();

    const title = `Tagged Secret ${Date.now()}`;
    const tagName = `sec${Date.now()}`;
    await page.getByRole('button', { name: 'New Secret' }).click();
    await page.getByTestId('note-title-input').fill(title);
    await page.getByTestId('tag-toggle-btn').click();
    await page.getByTestId('add-tag-btn').click();

    const input = page.getByPlaceholder('Search or create a tag…');
    await input.fill(tagName);
    await input.press('Enter'); // creates the tag and adds it
    await expect(page.getByTestId('tag-strip').getByText(tagName, { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    const created = page.waitForResponse(
      (r) => r.url().includes('/api/secrets') && r.request().method() === 'POST' && r.ok(),
    );
    await page.getByTestId('save-secret-btn').click();
    const body = await (await created).json();
    expect(body.tags).toHaveLength(1);

    await expect(secretsPage.secretCard(title).getByTestId('card-tags')).toContainText(tagName);
  });

  test('add a tag while creating a seal → chip shows on the card', async ({ page }) => {
    const sealsPage = new SealsPage(page);
    await sealsPage.signInDirectly();
    await sealsPage.unlock();

    const title = `Tagged Seal ${Date.now()}`;
    const tagName = `seal${Date.now()}`;
    await page.getByRole('button', { name: 'New Seal' }).click();
    await page.getByTestId('note-title-input').fill(title);
    await page.getByTestId('tag-toggle-btn').click();
    await page.getByTestId('add-tag-btn').click();

    const input = page.getByPlaceholder('Search or create a tag…');
    await input.fill(tagName);
    await input.press('Enter');
    await expect(page.getByTestId('tag-strip').getByText(tagName, { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    const created = page.waitForResponse(
      (r) => r.url().includes('/api/seals') && r.request().method() === 'POST' && r.ok(),
    );
    await page.getByTestId('save-seal-btn').click();
    const body = await (await created).json();
    expect(body.tags).toHaveLength(1);

    await expect(sealsPage.sealCard(title).getByTestId('card-tags')).toContainText(tagName);
  });
});
