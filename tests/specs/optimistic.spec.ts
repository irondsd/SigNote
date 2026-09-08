import { test, expect, type Page } from '@playwright/test';
import { NotesPage } from '../pages/NotesPage';
import { SecretsPage } from '../pages/SecretsPage';
import { SealsPage } from '../pages/SealsPage';
import { seedNotes } from '../fixtures/seedNotes';
import { seedSecrets } from '../fixtures/seedSecrets';
import { seedSeals } from '../fixtures/seedSeals';
import { clearSession } from '../utils/clearSession';
import { settleModal } from '../utils/settleModal';

const drafts = (page: Page) =>
  page.evaluate(() =>
    Object.keys(localStorage)
      .filter((key) => key === 'sn_draft' || key.startsWith('sn_draft:'))
      .map((key) => JSON.parse(localStorage.getItem(key)!)),
  );

async function holdWrite(page: Page, procedure: string, fail: boolean) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/trpc/${procedure}*`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await gate;
    if (fail) await route.abort('failed');
    else await route.continue();
  });
  return release;
}

for (const tier of ['note', 'secret', 'seal'] as const) {
  test(`${tier} create closes before response, retains recovery on failure and reload`, async ({ page }) => {
    const app = tier === 'note' ? new NotesPage(page) : tier === 'secret' ? new SecretsPage(page) : new SealsPage(page);
    await app.signInDirectly();
    if (app instanceof SecretsPage || app instanceof SealsPage) await app.unlock();
    await page.getByRole('button', { name: `New ${tier[0].toUpperCase()}${tier.slice(1)}`, exact: true }).click();
    await page.getByTestId('note-title-input').fill('Optimistic creation');
    await page.getByTestId('tiptap-editor').locator('[contenteditable=true]').fill('Keep this body');
    const release = await holdWrite(page, `${tier}s.create`, true);
    try {
      await page.getByTestId(`save-${tier}-btn`).click();
      await expect(page.getByTestId('note-modal')).toHaveCount(0);
      await expect(
        page.getByTestId(tier === 'note' ? 'note-card' : 'secret-card').filter({ hasText: 'Optimistic creation' }),
      ).toBeVisible();
      // The Secret and Seal tiers keep their checkpoint encrypted, so the body
      // is present as ciphertext rather than as text — the recovery below is
      // what proves it is still the right body.
      expect(await drafts(page)).toEqual([
        expect.objectContaining(
          tier === 'note'
            ? { title: 'Optimistic creation', content: expect.stringContaining('Keep this body') }
            : { title: 'Optimistic creation', enc: expect.objectContaining({ ciphertext: expect.any(String) }) },
        ),
      ]);
      if (tier !== 'note') {
        await expect(page.evaluate(() => JSON.stringify(localStorage))).resolves.not.toContain('Keep this body');
      }
    } finally {
      release();
    }
    await expect(page.getByText(`You have an unsaved ${tier} draft`)).toBeVisible();
    await expect(
      page.getByTestId(tier === 'note' ? 'note-card' : 'secret-card').filter({ hasText: 'Optimistic creation' }),
    ).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(`You have an unsaved ${tier} draft`)).toBeVisible();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByTestId('note-title-input')).toHaveValue('Optimistic creation');
    await expect(page.getByTestId('tiptap-editor')).toContainText('Keep this body');
  });

  test(`${tier} edit leaves edit mode before response and survives closing and a failed save`, async ({ page }) => {
    const title = 'Original';
    if (tier === 'note') {
      const app = new NotesPage(page);
      const { address } = await app.signInDirectly();
      await seedNotes(address, [{ title, content: '<p>Original body</p>' }]);
    } else {
      const app = tier === 'secret' ? new SecretsPage(page) : new SealsPage(page);
      const { address, mekBytes } = await app.signInDirectly();
      await (tier === 'secret' ? seedSecrets : seedSeals)(address, mekBytes, [
        { title, content: '<p>Original body</p>' },
      ]);
    }
    await clearSession(page);
    await page.reload();
    if (tier === 'secret') await new SecretsPage(page).unlock();
    if (tier === 'seal') await new SealsPage(page).unlock();
    await page
      .getByTestId(tier === 'note' ? 'note-card' : 'secret-card')
      .filter({ hasText: title })
      .click();
    await settleModal(page);
    if (tier === 'seal') await page.getByTestId('decrypt-btn').click();
    await page.getByTestId('edit-btn').click();
    await page.getByTestId('note-title-input').fill('Recovered edit');
    await page.getByTestId('tiptap-editor').locator('[contenteditable=true]').fill('Unsaved edited body');
    const release = await holdWrite(page, `${tier}s.update`, true);
    try {
      await page.getByTestId('save-btn').click();
      await expect(page.getByTestId('save-btn')).toHaveCount(0);
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(page.getByTestId('note-modal')).toHaveCount(0);
      expect(await drafts(page)).toEqual([
        expect.objectContaining({ title: 'Recovered edit', sourceId: expect.any(String) }),
      ]);
    } finally {
      release();
    }
    await expect(page.getByText(`You have unsaved changes to a ${tier}`, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(`You have unsaved changes to a ${tier}`, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByTestId('note-title-input')).toHaveValue('Recovered edit');
    await expect(page.getByTestId('tiptap-editor')).toContainText('Unsaved edited body');
  });
}

test('a successful create clears its recovery after unmount without clearing a newer draft', async ({ page }) => {
  await new NotesPage(page).signInDirectly();
  await page.getByTestId('new-note-btn').click();
  await page.getByTestId('note-title-input').fill('First save');
  const release = await holdWrite(page, 'notes.create', false);
  try {
    await page.getByTestId('save-note-btn').click();
    await expect(page.getByTestId('note-modal')).toHaveCount(0);
    await page.getByTestId('new-note-btn').click();
    await page.getByTestId('note-title-input').fill('Newer draft');
    await expect.poll(() => drafts(page)).toHaveLength(2);
  } finally {
    release();
  }
  await expect.poll(() => drafts(page)).toEqual([expect.objectContaining({ title: 'Newer draft' })]);
});

for (const tier of ['secret', 'seal'] as const) {
  test(`${tier} successful create clears recovery only after the complete encrypted write`, async ({ page }) => {
    const app = tier === 'secret' ? new SecretsPage(page) : new SealsPage(page);
    await app.signInDirectly();
    await app.unlock();
    await page.getByRole('button', { name: tier === 'secret' ? 'New Secret' : 'New Seal', exact: true }).click();
    await page.getByTestId('note-title-input').fill('Encrypted save');
    await page.getByTestId('tiptap-editor').locator('[contenteditable=true]').fill('Keep encrypted body');
    // Seals create the row first, then encrypt with its real id and write the body.
    const release = await holdWrite(page, tier === 'seal' ? 'seals.update' : 'secrets.create', false);
    try {
      await page.getByTestId(`save-${tier}-btn`).click();
      await expect(page.getByTestId('note-modal')).toHaveCount(0);
      expect(await drafts(page)).toEqual([expect.objectContaining({ title: 'Encrypted save' })]);
    } finally {
      release();
    }
    await expect.poll(() => drafts(page)).toEqual([]);
    await page.getByTestId('secret-card').filter({ hasText: 'Encrypted save' }).click();
    if (tier === 'seal') await page.getByTestId('decrypt-btn').click();
    await expect(page.getByTestId('tiptap-editor')).toContainText('Keep encrypted body');
  });
}
