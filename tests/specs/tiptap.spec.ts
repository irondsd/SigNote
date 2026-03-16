import { test, expect, type Page } from '@playwright/test';
import { changeAccount } from '../utils/changeAccount';
import { makeAccount } from '../utils/makeAccount';
import { mockProvider } from '../utils/mockProvider';
import { signIn } from '../utils/signIn';
import { seedNotes } from '../fixtures/seedNotes';

test.describe.configure({ mode: 'parallel' });

const noteCard = (page: Page, title: string) => page.getByTestId('note-card').filter({ hasText: title });

const openInEditMode = async (page: Page, title: string) => {
  await noteCard(page, title).click();
  await page.getByTestId('edit-btn').click();
  await page.getByTestId('tiptap-editor').click();
};

const saveAndGetContent = async (page: Page, noteId: string): Promise<string> => {
  const patchPromise = page.waitForResponse((r) => r.url().includes('/api/notes/') && r.request().method() === 'PATCH');
  await page.getByTestId('save-btn').click();
  await patchPromise;
  const res = await page.request.get('/api/notes');
  const notes = await res.json();
  return notes.find((n: { _id: string }) => n._id === noteId).content as string;
};

// ─── Group 1: Keyboard Formatting ───────────────────────────────────────────

test.describe('keyboard formatting', () => {
  test('cmd+b applies bold', async ({ page }) => {
    const { account, privateKey } = makeAccount();
    const title = `Bold Test ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    await mockProvider(page);
    await page.goto('/');
    await changeAccount(page, privateKey);
    await signIn(page);

    await openInEditMode(page, title);
    await page.keyboard.press('Meta+b');
    await page.keyboard.type('bold text');

    const content = await saveAndGetContent(page, note._id.toString());
    expect(content).toContain('<strong>');
  });

  test('cmd+i applies italic', async ({ page }) => {
    const { account, privateKey } = makeAccount();
    const title = `Italic Test ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    await mockProvider(page);
    await page.goto('/');
    await changeAccount(page, privateKey);
    await signIn(page);

    await openInEditMode(page, title);
    await page.keyboard.press('Meta+i');
    await page.keyboard.type('italic text');

    const content = await saveAndGetContent(page, note._id.toString());
    expect(content).toContain('<em>');
  });

  test('cmd+u applies underline', async ({ page }) => {
    const { account, privateKey } = makeAccount();
    const title = `Underline Test ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    await mockProvider(page);
    await page.goto('/');
    await changeAccount(page, privateKey);
    await signIn(page);

    await openInEditMode(page, title);
    await page.keyboard.press('Meta+u');
    await page.keyboard.type('underlined text');

    const content = await saveAndGetContent(page, note._id.toString());
    expect(content).toContain('<u>');
  });

  test('cmd+shift+s applies strikethrough', async ({ page }) => {
    const { account, privateKey } = makeAccount();
    const title = `Strike Test ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    await mockProvider(page);
    await page.goto('/');
    await changeAccount(page, privateKey);
    await signIn(page);

    await openInEditMode(page, title);
    await page.keyboard.press('Meta+Shift+s');
    await page.keyboard.type('struck text');

    const content = await saveAndGetContent(page, note._id.toString());
    expect(content).toContain('<s>');
  });
});

// ─── Group 2: URL Auto-detection ─────────────────────────────────────────────

test.describe('url auto-detection', () => {
  test('typed URL becomes a link with target="_blank"', async ({ page }) => {
    const { account, privateKey } = makeAccount();
    const title = `URL Test ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    await mockProvider(page);
    await page.goto('/');
    await changeAccount(page, privateKey);
    await signIn(page);

    await openInEditMode(page, title);
    await page.keyboard.type('https://example.com ');

    const content = await saveAndGetContent(page, note._id.toString());
    expect(content).toContain('href="https://example.com"');
    expect(content).toContain('target="_blank"');
  });
});

// ─── Group 3: Checkboxes ─────────────────────────────────────────────────────

test.describe('checkboxes', () => {
  test('[ ] creates a task item checkbox', async ({ page }) => {
    const { account, privateKey } = makeAccount();
    const title = `Checkbox Create ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    await mockProvider(page);
    await page.goto('/');
    await changeAccount(page, privateKey);
    await signIn(page);

    await openInEditMode(page, title);
    await page.keyboard.type('[ ] ');
    await page.keyboard.type('my task');

    const content = await saveAndGetContent(page, note._id.toString());
    expect(content).toContain('data-type="taskItem"');
  });

  test('checkbox is clickable in view mode and toggles checked state', async ({ page }) => {
    const { account, privateKey } = makeAccount();
    const title = `Checkbox View ${Date.now()}`;
    const [note] = await seedNotes(account.address, [
      {
        title,
        content: '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>my task</p></li></ul>',
      },
    ]);

    await mockProvider(page);
    await page.goto('/');
    await changeAccount(page, privateKey);
    await signIn(page);

    // Open modal in view mode (no edit-btn click)
    await noteCard(page, title).click();
    await expect(page.getByTestId('tiptap-editor')).toBeVisible();

    const patchPromise = page.waitForResponse(
      (r) => r.url().includes('/api/notes/') && r.request().method() === 'PATCH',
    );
    await page.getByTestId('tiptap-editor').locator('input[type="checkbox"]').click();
    await patchPromise;

    const res = await page.request.get('/api/notes');
    const notes = await res.json();
    const updated = notes.find((n: { _id: string }) => n._id === note._id.toString());
    expect(updated.content).toContain('data-checked="true"');
  });
});

// ─── Group 4: Horizontal Rule ─────────────────────────────────────────────────

test.describe('horizontal rule', () => {
  test('--- creates a horizontal rule divider', async ({ page }) => {
    const { account, privateKey } = makeAccount();
    const title = `Divider Test ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    await mockProvider(page);
    await page.goto('/');
    await changeAccount(page, privateKey);
    await signIn(page);

    await openInEditMode(page, title);
    await page.keyboard.type('---');
    await page.keyboard.press('Enter');

    const content = await saveAndGetContent(page, note._id.toString());
    expect(content).toContain('<hr');
  });
});

// ─── Group 5: Code Blocks ────────────────────────────────────────────────────

test.describe('code blocks', () => {
  test('backtick wrapping creates inline code', async ({ page }) => {
    const { account, privateKey } = makeAccount();
    const title = `Inline Code ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    await mockProvider(page);
    await page.goto('/');
    await changeAccount(page, privateKey);
    await signIn(page);

    await openInEditMode(page, title);
    await page.keyboard.type('`hello`');

    const content = await saveAndGetContent(page, note._id.toString());
    expect(content).toContain('<code>');
    expect(content).toContain('hello');
  });

  test('triple backtick creates a code block', async ({ page }) => {
    const { account, privateKey } = makeAccount();
    const title = `Code Block ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    await mockProvider(page);
    await page.goto('/');
    await changeAccount(page, privateKey);
    await signIn(page);

    await openInEditMode(page, title);
    await page.keyboard.type('```');
    await page.keyboard.press('Enter');
    await page.keyboard.type('const x = 1;');

    const content = await saveAndGetContent(page, note._id.toString());
    expect(content).toContain('<pre>');
    expect(content).toContain('<code');
    expect(content).toContain('const x = 1;');
  });

  test('clicking inline code in view mode copies to clipboard', async ({ page }) => {
    const { account, privateKey } = makeAccount();
    const title = `Copy Inline ${Date.now()}`;
    await seedNotes(account.address, [{ title, content: '<p><code>hello world</code></p>' }]);

    await mockProvider(page);
    await page.goto('/');
    await changeAccount(page, privateKey);
    await signIn(page);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await noteCard(page, title).click();
    await expect(page.getByTestId('tiptap-editor')).toBeVisible();

    await page.getByTestId('tiptap-editor').locator('code').first().click();

    await expect(page.getByText('Copied to clipboard')).toBeVisible();
  });

  test('clicking code block in view mode copies to clipboard', async ({ page }) => {
    const { account, privateKey } = makeAccount();
    const title = `Copy Block ${Date.now()}`;
    await seedNotes(account.address, [
      { title, content: '<pre><code class="language-undefined">const x = 1</code></pre>' },
    ]);

    await mockProvider(page);
    await page.goto('/');
    await changeAccount(page, privateKey);
    await signIn(page);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await noteCard(page, title).click();
    await expect(page.getByTestId('tiptap-editor')).toBeVisible();

    await page.getByTestId('tiptap-editor').locator('pre code').first().click();

    await expect(page.getByText('Copied to clipboard')).toBeVisible();
  });
});

// ─── Group 6: Lists ───────────────────────────────────────────────────────────

test.describe('lists', () => {
  test('- creates an unordered list', async ({ page }) => {
    const { account, privateKey } = makeAccount();
    const title = `Bullet List ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    await mockProvider(page);
    await page.goto('/');
    await changeAccount(page, privateKey);
    await signIn(page);

    await openInEditMode(page, title);
    await page.keyboard.type('- ');
    await page.keyboard.type('list item');

    const content = await saveAndGetContent(page, note._id.toString());
    expect(content).toContain('<ul>');
    expect(content).toContain('<li>');
  });

  test('1. creates an ordered list', async ({ page }) => {
    const { account, privateKey } = makeAccount();
    const title = `Ordered List ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    await mockProvider(page);
    await page.goto('/');
    await changeAccount(page, privateKey);
    await signIn(page);

    await openInEditMode(page, title);
    await page.keyboard.type('1. ');
    await page.keyboard.type('first item');

    const content = await saveAndGetContent(page, note._id.toString());
    expect(content).toContain('<ol>');
    expect(content).toContain('<li>');
  });
});
