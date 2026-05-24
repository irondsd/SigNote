import { test, expect, type Page } from '@playwright/test';
import { makeAccount } from '../utils/makeAccount';
import { seedNotes } from '../fixtures/seedNotes';
import { seedSecrets } from '../fixtures/seedSecrets';
import { NotesPage } from '../pages/NotesPage';
import { SecretsPage } from '../pages/SecretsPage';

test.describe.configure({ mode: 'parallel' });

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Wait for the modal's open-from-card transform animation (≈350ms) to finish
 * AND its size to stabilize. Without this, buttons inside the modal are flaky
 * targets because they're mid-transform.
 */
async function waitForModalStable(page: Page) {
  await page.getByTestId('note-modal').evaluate(async (el) => {
    let prev = -1;
    let stable = 0;
    for (let i = 0; i < 180; i++) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const animating = el.getAnimations({ subtree: true }).some((a) => a.playState === 'running');
      const h = el.getBoundingClientRect().height;
      if (!animating && Math.abs(h - prev) < 0.5) stable++;
      else stable = 0;
      prev = h;
      if (stable >= 6) return;
    }
  });
}

/** Open the more-actions popover and navigate into the Self-destruct picker. */
async function openSelfDestructPicker(page: Page) {
  await waitForModalStable(page);
  await page.getByTestId('more-actions-btn').click();
  await page.getByRole('button', { name: /^self-destruct timer/i }).click();
  await expect(page.getByRole('button', { name: /set timer|update timer/i })).toBeVisible();
}

/** Click Close on the note modal once layout has settled. */
async function closeModal(page: Page) {
  await waitForModalStable(page);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('note-title')).toHaveCount(0);
}

/** From inside the picker, choose a preset and commit. */
async function setPreset(page: Page, label: '1 hour' | '24 hours' | '7 days' | '30 days') {
  await page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).click();
  const patch = page.waitForResponse((r) => /\/api\/(notes|secrets|seals)\//.test(r.url()) && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: /set timer|update timer/i }).click();
  await patch;
}

/** From inside the picker, click Turn off self-destruct. */
async function turnOffFromPicker(page: Page) {
  const patch = page.waitForResponse((r) => /\/api\/(notes|secrets|seals)\//.test(r.url()) && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: /turn off self-destruct/i }).click();
  await patch;
}

/** Toggle the Burn-after-reading switch inside the picker (does not commit). */
async function toggleBurnSwitch(page: Page) {
  await page.getByRole('switch', { name: /burn after reading/i }).click();
}

/** Save with "Set timer" / "Update timer", waiting for the PATCH. */
async function commitFromPicker(page: Page) {
  const patch = page.waitForResponse((r) => /\/api\/(notes|secrets|seals)\//.test(r.url()) && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: /set timer|update timer/i }).click();
  await patch;
}

async function fetchNote(page: Page, id: string) {
  const res = await page.request.get('/api/notes');
  const notes = await res.json();
  return notes.find((n: { _id: string }) => n._id === id) ?? null;
}

// ─── Notes tier — card state ─────────────────────────────────────────────────

test.describe('cards reflect self-destruct state', () => {
  test('burn-after-reading hides the preview behind an EncryptedPlaceholder', async ({ page }) => {
    const { account } = makeAccount();
    const tag = `burn-card-${Date.now()}`;
    await seedNotes(account.address, [
      { title: `${tag} normal`, content: '<p>visible content</p>' },
      { title: `${tag} burn`, content: '<p>should be hidden</p>', burnAfterReading: true },
    ]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await expect(notesPage.noteCard(`${tag} normal`)).toBeVisible();

    // The burn card replaces preview with the encrypted placeholder.
    const burnCard = notesPage.noteCard(`${tag} burn`);
    await expect(burnCard.getByTestId('encrypted-placeholder')).toBeVisible();
    await expect(burnCard).not.toContainText('should be hidden');

    // The normal card still shows its content.
    await expect(notesPage.noteCard(`${tag} normal`)).toContainText('visible content');
  });

  test('expiresAt-set note shows the expiry flag on the card', async ({ page }) => {
    const { account } = makeAccount();
    const tag = `expiry-flag-${Date.now()}`;
    await seedNotes(account.address, [
      { title: `${tag} plain` },
      { title: `${tag} armed`, expiresAt: new Date(Date.now() + 60 * 60_000) },
    ]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    await expect(notesPage.noteCard(`${tag} armed`).getByTestId('expiry-flag')).toBeVisible();
    await expect(notesPage.noteCard(`${tag} plain`).getByTestId('expiry-flag')).toHaveCount(0);
  });

  test('note whose expiresAt is in the past is filtered out of the list', async ({ page }) => {
    const { account } = makeAccount();
    const tag = `past-${Date.now()}`;
    await seedNotes(account.address, [
      { title: `${tag} alive` },
      { title: `${tag} expired`, expiresAt: new Date(Date.now() - 60_000) },
    ]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    await expect(notesPage.noteCard(`${tag} alive`)).toBeVisible();
    await expect(notesPage.noteCard(`${tag} expired`)).toHaveCount(0);
  });
});

// ─── Notes tier — modal banner ───────────────────────────────────────────────

test.describe('self-destruct banner', () => {
  test('shows in the modal when expiresAt is initially set', async ({ page }) => {
    const { account } = makeAccount();
    const title = `banner-expiry-${Date.now()}`;
    await seedNotes(account.address, [{ title, expiresAt: new Date(Date.now() + 60 * 60_000) }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.noteCard(title).click();

    await expect(page.getByTestId('self-destruct-banner')).toBeVisible();
    await expect(page.getByTestId('self-destruct-banner')).toContainText(/self-destructs in/i);
  });

  test('shows "after closing" copy when burn-after-reading is initially set', async ({ page }) => {
    const { account } = makeAccount();
    const title = `banner-burn-${Date.now()}`;
    await seedNotes(account.address, [{ title, burnAfterReading: true }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.noteCard(title).click();

    await expect(page.getByTestId('self-destruct-banner')).toBeVisible();
    await expect(page.getByTestId('self-destruct-banner')).toContainText(/after closing/i);
  });

  test('does NOT show when burn-after-reading is toggled on in this session', async ({ page }) => {
    const { account } = makeAccount();
    const title = `banner-just-set-${Date.now()}`;
    await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.noteCard(title).click();
    await expect(page.getByTestId('self-destruct-banner')).toHaveCount(0);

    await openSelfDestructPicker(page);
    await toggleBurnSwitch(page);
    await commitFromPicker(page);

    // After saving, modal stays open but banner must remain hidden because
    // the gating is "initialBurnRef.current && burnAfterReading".
    await expect(page.getByTestId('self-destruct-banner')).toHaveCount(0);
  });
});

// ─── Notes tier — picker actions: set / disable timer ────────────────────────

test.describe('timer set & disable via picker', () => {
  test('Set timer with a 1-hour preset writes a near-future expiresAt', async ({ page }) => {
    const { account } = makeAccount();
    const title = `set-1h-${Date.now()}`;
    const [seeded] = await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.noteCard(title).click();
    await openSelfDestructPicker(page);
    await setPreset(page, '1 hour');

    const updated = await fetchNote(page, seeded._id.toString());
    expect(updated).not.toBeNull();
    expect(updated.burnAfterReading).toBe(false);
    const expiry = new Date(updated.expiresAt).getTime();
    const now = Date.now();
    // Should land within ±5s of now + 1h.
    expect(expiry).toBeGreaterThan(now + 60 * 60_000 - 5_000);
    expect(expiry).toBeLessThan(now + 60 * 60_000 + 5_000);
  });

  test('Turn off self-destruct clears both fields for a timer-armed note', async ({ page }) => {
    const { account } = makeAccount();
    const title = `disable-timer-${Date.now()}`;
    const [seeded] = await seedNotes(account.address, [
      { title, expiresAt: new Date(Date.now() + 60 * 60_000) },
    ]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.noteCard(title).click();
    await openSelfDestructPicker(page);
    await turnOffFromPicker(page);

    const updated = await fetchNote(page, seeded._id.toString());
    expect(updated.expiresAt).toBeNull();
    expect(updated.burnAfterReading).toBe(false);
  });

  test('Saving the picker with no change keeps the Save button disabled', async ({ page }) => {
    const { account } = makeAccount();
    const title = `no-change-${Date.now()}`;
    await seedNotes(account.address, [{ title }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.noteCard(title).click();
    await openSelfDestructPicker(page);

    await expect(page.getByRole('button', { name: /^set timer$/i })).toBeDisabled();
  });
});

// ─── Notes tier — burn-after-reading arming ──────────────────────────────────

test.describe('burn-after-reading arming', () => {
  test('opening a burn-after-reading note arms expiresAt → note is gone after reload', async ({ page }) => {
    const { account } = makeAccount();
    const title = `burn-arm-${Date.now()}`;
    const [seeded] = await seedNotes(account.address, [{ title, burnAfterReading: true }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    // The arm PATCH happens on modal mount.
    const armPatch = page.waitForResponse(
      (r) => r.url().includes(`/api/notes/${seeded._id.toString()}`) && r.request().method() === 'PATCH',
    );
    await notesPage.noteCard(title).click();
    await armPatch;

    // The arm PATCH has completed and the banner is up.
    await expect(page.getByTestId('self-destruct-banner')).toBeVisible();

    // Source of truth: the list endpoint filters out notes whose expiresAt
    // <= now. After arming, the note should not be returned. Poll to give
    // the server a moment to commit, then also confirm the UI matches.
    await expect
      .poll(async () => {
        const res = await page.request.get('/api/notes');
        const notes = (await res.json()) as { _id: string }[];
        return notes.some((n) => n._id === seeded._id.toString());
      })
      .toBe(false);

    await page.reload();
    await expect(page.getByTestId('display-name').first()).toBeVisible({ timeout: 10000 });
    await expect(notesPage.noteCard(title)).toHaveCount(0);
  });

  test('user can spare a burn-after-reading note by disabling it before closing', async ({ page }) => {
    const { account } = makeAccount();
    const title = `burn-spare-${Date.now()}`;
    const [seeded] = await seedNotes(account.address, [{ title, burnAfterReading: true }]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);

    // Arm fires on open.
    const armPatch = page.waitForResponse(
      (r) => r.url().includes(`/api/notes/${seeded._id.toString()}`) && r.request().method() === 'PATCH',
    );
    await notesPage.noteCard(title).click();
    await armPatch;
    await expect(page.getByTestId('self-destruct-banner')).toBeVisible();

    // Clear via the API. (Picker UI clearing is exercised by the timer-spare
    // test below; here we just need to verify the post-arm lifecycle: clear
    // before reload → note survives, fields cleared.)
    const clearRes = await page.request.patch(`/api/notes/${seeded._id.toString()}`, {
      data: { expiresAt: null, burnAfterReading: false },
    });
    expect(clearRes.ok()).toBe(true);

    await page.reload();
    await expect(page.getByTestId('display-name').first()).toBeVisible({ timeout: 10000 });

    // Note is still here.
    await expect(notesPage.noteCard(title)).toBeVisible();

    // And the DB reflects the cleared state.
    const updated = await fetchNote(page, seeded._id.toString());
    expect(updated.burnAfterReading).toBe(false);
    expect(updated.expiresAt).toBeNull();
  });

  test('user can spare a timer-armed note before its expiry by disabling it', async ({ page }) => {
    const { account } = makeAccount();
    const title = `timer-spare-${Date.now()}`;
    const [seeded] = await seedNotes(account.address, [
      { title, expiresAt: new Date(Date.now() + 60 * 60_000) },
    ]);

    const notesPage = new NotesPage(page);
    await notesPage.signInDirectly(account.address);
    await notesPage.noteCard(title).click();
    await openSelfDestructPicker(page);
    await turnOffFromPicker(page);

    await closeModal(page);
    await page.reload();
    await expect(notesPage.noteCard(title)).toBeVisible();

    const updated = await fetchNote(page, seeded._id.toString());
    expect(updated.expiresAt).toBeNull();
    expect(updated.burnAfterReading).toBe(false);
  });
});

// ─── Secrets tier — preview hiding & arming ──────────────────────────────────

test.describe('secrets tier — burn-after-reading', () => {
  test('burn-after-reading secret shows the encrypted placeholder, not its preview', async ({ page }) => {
    const secretsPage = new SecretsPage(page);
    const { address, mekBytes } = await secretsPage.signInDirectly();
    const tag = `secret-burn-${Date.now()}`;
    await seedSecrets(address, mekBytes, [
      { title: `${tag} plain`, content: 'plaintext body' },
      { title: `${tag} burn`, content: 'should not show', burnAfterReading: true },
    ]);

    await secretsPage.goto();
    await secretsPage.unlock();
    await expect(secretsPage.secretCard(`${tag} plain`)).toBeVisible();

    const burnCard = secretsPage.secretCard(`${tag} burn`);
    await expect(burnCard.getByTestId('encrypted-placeholder')).toBeVisible();
    await expect(burnCard).not.toContainText('should not show');
  });

  test('opening a burn-after-reading secret arms expiresAt → gone after reload', async ({ page }) => {
    const secretsPage = new SecretsPage(page);
    const { address, mekBytes } = await secretsPage.signInDirectly();
    const title = `secret-arm-${Date.now()}`;
    const [seeded] = await seedSecrets(address, mekBytes, [
      { title, content: 'secret body', burnAfterReading: true },
    ]);

    await secretsPage.goto();
    await secretsPage.unlock();

    const armPatch = page.waitForResponse(
      (r) => r.url().includes(`/api/secrets/${seeded._id.toString()}`) && r.request().method() === 'PATCH',
    );
    await secretsPage.secretCard(title).click();
    await armPatch;

    // Banner appears after arming — confirm it, then reload directly.
    await expect(page.getByTestId('self-destruct-banner')).toBeVisible();
    // Title is plaintext on secrets — no unlock needed to verify it's gone.
    await page.reload();
    await expect(secretsPage.secretCard(title)).toHaveCount(0);
  });
});
