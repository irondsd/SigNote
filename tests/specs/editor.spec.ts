import { test, expect } from '@playwright/test';
import { makeAccount } from '../utils/makeAccount';
import { seedNotes } from '../fixtures/seedNotes';
import { NotesPage } from '../pages/NotesPage';

test.describe.configure({ mode: 'parallel' });

// ─── Group 1: Keyboard Formatting ───────────────────────────────────────────

test.describe('keyboard formatting', () => {
  test('cmd+b applies bold', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Bold Test ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.openInEditMode(title);
    await page.keyboard.press('Meta+b');
    await page.keyboard.type('bold text');

    const content = await notesPage.saveAndGetContent(note._id.toString());
    expect(content).toContain('<strong>');
  });

  test('cmd+i applies italic', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Italic Test ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.openInEditMode(title);
    await page.keyboard.press('Meta+i');
    await page.keyboard.type('italic text');

    const content = await notesPage.saveAndGetContent(note._id.toString());
    expect(content).toContain('<em>');
  });

  test('cmd+u applies underline', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Underline Test ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.openInEditMode(title);
    await page.keyboard.press('Meta+u');
    await page.keyboard.type('underlined text');

    const content = await notesPage.saveAndGetContent(note._id.toString());
    expect(content).toContain('<u>');
  });

  test('cmd+shift+s applies strikethrough', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Strike Test ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.openInEditMode(title);
    await page.keyboard.press('Meta+Shift+s');
    await page.keyboard.type('struck text');

    const content = await notesPage.saveAndGetContent(note._id.toString());
    expect(content).toContain('<s>');
  });
});

// ─── Group 2: URL Auto-detection ─────────────────────────────────────────────

test.describe('url auto-detection', () => {
  test('typed URL becomes a link with target="_blank"', async ({ page }) => {
    const { account } = makeAccount();
    const title = `URL Test ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.openInEditMode(title);
    await page.keyboard.type('https://example.com ');

    const content = await notesPage.saveAndGetContent(note._id.toString());
    expect(content).toContain('href="https://example.com"');
    expect(content).toContain('target="_blank"');
  });
});

// ─── Group 3: Checkboxes ─────────────────────────────────────────────────────

test.describe('checkboxes', () => {
  test('[ ] creates a task item checkbox', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Checkbox Create ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.openInEditMode(title);
    await page.keyboard.type('[ ] ');
    await page.keyboard.type('my task');

    const content = await notesPage.saveAndGetContent(note._id.toString());
    expect(content).toContain('data-type="taskItem"');
  });

  test('checkbox is clickable in view mode and toggles checked state', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Checkbox View ${Date.now()}`;
    const [note] = await seedNotes(account.address, [
      {
        title,
        content: '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>my task</p></li></ul>',
      },
    ]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    // Open modal in view mode (no edit-btn click)
    await notesPage.noteCard(title).click();
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
    const { account } = makeAccount();
    const title = `Divider Test ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.openInEditMode(title);
    await page.keyboard.type('---');
    await page.keyboard.press('Enter');

    const content = await notesPage.saveAndGetContent(note._id.toString());
    expect(content).toContain('<hr');
  });
});

// ─── Group 5: Code Blocks ────────────────────────────────────────────────────

test.describe('code blocks', () => {
  test('backtick wrapping creates inline code', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Inline Code ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.openInEditMode(title);
    await page.keyboard.type('`hello`');

    const content = await notesPage.saveAndGetContent(note._id.toString());
    expect(content).toContain('<code>');
    expect(content).toContain('hello');
  });

  test('triple backtick creates a code block', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Code Block ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.openInEditMode(title);
    await page.keyboard.type('```');
    await page.keyboard.press('Enter');
    await page.keyboard.type('const x = 1;');

    const content = await notesPage.saveAndGetContent(note._id.toString());
    expect(content).toContain('<pre>');
    expect(content).toContain('<code');
    expect(content).toContain('const x = 1;');
  });

  test('clicking inline code in view mode copies to clipboard', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Copy Inline ${Date.now()}`;
    await seedNotes(account.address, [{ title, content: '<p><code>hello world</code></p>' }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await notesPage.noteCard(title).click();
    await expect(page.getByTestId('tiptap-editor')).toBeVisible();

    await page.getByTestId('tiptap-editor').locator('code').first().click();

    await expect(page.getByText('Copied to clipboard')).toBeVisible();
  });

  test('clicking copy button on code block copies to clipboard', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Copy Block ${Date.now()}`;
    await seedNotes(account.address, [
      { title, content: '<pre><code class="language-undefined">const x = 1</code></pre>' },
    ]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await notesPage.noteCard(title).click();
    await expect(page.getByTestId('tiptap-editor')).toBeVisible();

    // Hover to reveal the copy button, then click it
    await page.getByTestId('tiptap-editor').locator('pre').first().hover();
    await page.getByRole('button', { name: 'Copy code' }).click();

    await expect(page.getByText('Copied to clipboard')).toBeVisible();
  });

  test('code block shows language label in view mode', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Code Block Language ${Date.now()}`;
    await seedNotes(account.address, [
      { title, content: '<pre><code class="language-typescript">echo hello</code></pre>' },
    ]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    await notesPage.noteCard(title).click();
    await expect(page.getByTestId('tiptap-editor')).toBeVisible();

    await expect(page.getByTestId('tiptap-editor').getByText('typescript')).toBeVisible();
  });
});

// ─── Group 6: Lists ───────────────────────────────────────────────────────────

test.describe('lists', () => {
  test('- creates an unordered list', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Bullet List ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.openInEditMode(title);
    await page.keyboard.type('- ');
    await page.keyboard.type('list item');

    const content = await notesPage.saveAndGetContent(note._id.toString());
    expect(content).toContain('<ul>');
    expect(content).toContain('<li>');
  });

  test('1. creates an ordered list', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Ordered List ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.openInEditMode(title);
    await page.keyboard.type('1. ');
    await page.keyboard.type('first item');

    const content = await notesPage.saveAndGetContent(note._id.toString());
    expect(content).toContain('<ol>');
    expect(content).toContain('<li>');
  });
});

// ─── Group 7: Formatting Toolbar ─────────────────────────────────────────────

test.describe('formatting toolbar', () => {
  async function openToolbar(notesPage: InstanceType<typeof NotesPage>) {
    const page = notesPage.page;
    await page.getByTitle('Formatting options').click();
    await expect(page.getByTitle('Bold')).toBeVisible();
    await page.waitForTimeout(250); // wait for CSS grid animation to finish
  }

  test('toolbar toggle shows and hides the toolbar', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Toolbar Toggle ${Date.now()}`;
    await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.openInEditMode(title);

    await expect(page.getByTitle('Bold')).not.toBeVisible();
    await page.getByTitle('Formatting options').click();
    await expect(page.getByTitle('Bold')).toBeVisible();
    await page.getByTitle('Formatting options').click();
    await expect(page.getByTitle('Bold')).not.toBeVisible();
  });

  test('H1 button applies heading 1', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Toolbar H1 ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.openInEditMode(title);
    await openToolbar(notesPage);
    await page.getByTitle('Heading 1').click();
    await page.keyboard.type('heading text');

    const content = await notesPage.saveAndGetContent(note._id.toString());
    expect(content).toContain('<h1>');
  });

  test('H2 button applies heading 2', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Toolbar H2 ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.openInEditMode(title);
    await openToolbar(notesPage);
    await page.getByTitle('Heading 2').click();
    await page.keyboard.type('heading text');

    const content = await notesPage.saveAndGetContent(note._id.toString());
    expect(content).toContain('<h2>');
  });

  test('H3 button applies heading 3', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Toolbar H3 ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.openInEditMode(title);
    await openToolbar(notesPage);
    await page.getByTitle('Heading 3').click();
    await page.keyboard.type('heading text');

    const content = await notesPage.saveAndGetContent(note._id.toString());
    expect(content).toContain('<h3>');
  });

  test('Bold button applies bold', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Toolbar Bold ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.openInEditMode(title);
    await openToolbar(notesPage);
    await page.getByTitle('Bold').click();
    await page.keyboard.type('bold text');

    const content = await notesPage.saveAndGetContent(note._id.toString());
    expect(content).toContain('<strong>');
  });

  test('Italic button applies italic', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Toolbar Italic ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.openInEditMode(title);
    await openToolbar(notesPage);
    await page.getByTitle('Italic').click();
    await page.keyboard.type('italic text');

    const content = await notesPage.saveAndGetContent(note._id.toString());
    expect(content).toContain('<em>');
  });

  test('Strikethrough button applies strikethrough', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Toolbar Strike ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.openInEditMode(title);
    await openToolbar(notesPage);
    await page.getByTitle('Strikethrough').click();
    await page.keyboard.type('struck text');

    const content = await notesPage.saveAndGetContent(note._id.toString());
    expect(content).toContain('<s>');
  });

  test('Underline button applies underline', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Toolbar Underline ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.openInEditMode(title);
    await openToolbar(notesPage);
    await page.getByTitle('Underline').click();
    await page.keyboard.type('underlined text');

    const content = await notesPage.saveAndGetContent(note._id.toString());
    expect(content).toContain('<u>');
  });

  test('Inline code button applies code', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Toolbar Code ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.openInEditMode(title);
    await openToolbar(notesPage);
    await page.getByTitle('Inline code').click();
    await page.keyboard.type('const x = 1');

    const content = await notesPage.saveAndGetContent(note._id.toString());
    expect(content).toContain('<code>');
  });

  test('Code block button creates a code block', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Toolbar CodeBlock ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.openInEditMode(title);
    await openToolbar(notesPage);
    await page.getByTitle('Code block').click();
    await page.keyboard.type('const x = 1;');

    const content = await notesPage.saveAndGetContent(note._id.toString());
    expect(content).toContain('<pre>');
    expect(content).toContain('<code');
  });

  test('Ordered list button creates an ordered list', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Toolbar OL ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.openInEditMode(title);
    await openToolbar(notesPage);
    await page.getByTitle('Ordered list').click();
    await page.keyboard.type('first item');

    const content = await notesPage.saveAndGetContent(note._id.toString());
    expect(content).toContain('<ol>');
    expect(content).toContain('<li>');
  });

  test('Bullet list button creates an unordered list', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Toolbar UL ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.openInEditMode(title);
    await openToolbar(notesPage);
    await page.getByTitle('Bullet list').click();
    await page.keyboard.type('list item');

    const content = await notesPage.saveAndGetContent(note._id.toString());
    expect(content).toContain('<ul>');
    expect(content).toContain('<li>');
  });

  test('Task list button creates a task list', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Toolbar TaskList ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.openInEditMode(title);
    await openToolbar(notesPage);
    await page.getByTitle('Task list').click();
    await page.keyboard.type('my task');

    const content = await notesPage.saveAndGetContent(note._id.toString());
    expect(content).toContain('data-type="taskItem"');
  });

  test('Divider line button inserts a horizontal rule', async ({ page }) => {
    const { account } = makeAccount();
    const title = `Toolbar HR ${Date.now()}`;
    const [note] = await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.openInEditMode(title);
    await openToolbar(notesPage);
    await page.getByTitle('Divider line').click();

    const content = await notesPage.saveAndGetContent(note._id.toString());
    expect(content).toContain('<hr');
  });
});
