import { test, expect, type Page } from '@playwright/test';

import { AuthenticatorPage } from '../pages/AuthenticatorPage';
import { seedOtpRecords } from '../fixtures/seedOtpRecords';
import { trpcGet, trpcMutationOf } from '../utils/trpc';

test.describe.configure({ mode: 'parallel' });

type WireRecord = { id: string; position: number; archived: boolean };

/** The order the server would hand a fresh device — highest position first. */
const serverOrder = async (page: Page): Promise<string[]> => {
  const res = await trpcGet(page.request, 'otp.list');
  const { records } = (await res.json()) as { records: WireRecord[] };
  return records.filter((r) => !r.archived).map((r) => r.id);
};

/**
 * Drags one card onto another and waits for the write.
 *
 * The pointer overshoots past the target's centre in the direction of travel.
 * dnd-kit shifts the target aside to preview the drop, so aiming at the centre
 * it had *before* the drag started leaves the pointer sitting in the gap the
 * shift opened up, and `over` resolves to nothing. Auth cards are short and
 * packed three to a row, so that margin is only a few pixels.
 */
const drag = async (page: Page, authPage: AuthenticatorPage, from: string, to: string) => {
  const source = await authPage.card(from).boundingBox();
  const target = await authPage.card(to).boundingBox();
  if (!source || !target) throw new Error('Card bounding box not found');

  const sx = source.x + source.width / 2;
  const sy = source.y + source.height / 2;
  const cx = target.x + target.width / 2;
  const cy = target.y + target.height / 2;

  const overshootX = Math.sign(cx - sx) * target.width * 0.3;
  const overshootY = Math.sign(cy - sy) * target.height * 0.3;

  await page.mouse.move(sx, sy);
  await page.mouse.down();
  // Cross the 8px PointerSensor activation threshold before travelling.
  await page.mouse.move(sx + 15, sy, { steps: 5 });
  await page.mouse.move(cx + overshootX, cy + overshootY, { steps: 20 });
  // One more move after the preview has shifted, so collision detection
  // recomputes against the settled layout rather than the mid-animation one.
  await page.waitForTimeout(150);
  await page.mouse.move(cx + overshootX, cy + overshootY + 1);

  const done = page.waitForResponse(trpcMutationOf('otp.'));
  await page.mouse.up();
  await done;
};

test.describe('authenticator ordering', () => {
  test.use({ viewport: { width: 1200, height: 900 } });

  /**
   * The reported regression, reproduced exactly.
   *
   * It only appears once positions have **collided** — which is the state the
   * old ascending arithmetic left behind after a few reorders. Two bugs then
   * compounded: the cache update removed the record and pushed it back on the
   * end of the array, and the comparator returned 0 for records sharing a
   * position, so a stable sort left the touched card wherever the rebuilt array
   * had put it — last.
   *
   * Seeding distinct positions does *not* reproduce it, which is why the
   * variants below pin the collided case specifically.
   */
  test('recolouring a card in a collided list does not move it', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [
      { issuer: 'Alpha', position: 1000 },
      { issuer: 'Bravo', position: 1000 },
      { issuer: 'Charlie', position: 1000 },
    ]);
    await page.reload();
    await authPage.enroll();

    await expect(authPage.cards).toHaveCount(3);
    const before = await authPage.order();

    // The middle card is the one that jumped to the bottom.
    await authPage.pickStyle(before[1], 'Teal');
    await expect.poll(() => authPage.order()).toEqual(before);

    // ...and the first card, which never appeared to move, still does not.
    await authPage.pickStyle(before[0], 'Rose');
    await expect.poll(() => authPage.order()).toEqual(before);
  });

  test('changing a pattern in a collided list does not move the card', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [
      { issuer: 'Alpha', position: 1000 },
      { issuer: 'Bravo', position: 1000 },
      { issuer: 'Charlie', position: 1000 },
    ]);
    await page.reload();
    await authPage.enroll();

    const before = await authPage.order();
    await authPage.pickStyle(before[1], 'Dots');
    await expect.poll(() => authPage.order()).toEqual(before);
  });

  test('archiving out of a collided list leaves the rest in order', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [
      { issuer: 'Alpha', position: 1000 },
      { issuer: 'Bravo', position: 1000 },
      { issuer: 'Charlie', position: 1000 },
      { issuer: 'Delta', position: 1000 },
    ]);
    await page.reload();
    await authPage.enroll();

    const before = await authPage.order();
    await authPage.setArchived(before[1], true);

    await expect.poll(() => authPage.order()).toEqual([before[0], before[2], before[3]]);
  });

  test('restyling every card of a collided list leaves the order untouched', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [
      { issuer: 'Alpha', position: 1000 },
      { issuer: 'Bravo', position: 1000 },
      { issuer: 'Charlie', position: 1000 },
      { issuer: 'Delta', position: 1000 },
    ]);
    await page.reload();
    await authPage.enroll();

    const before = await authPage.order();
    for (const issuer of before) {
      await authPage.pickStyle(issuer, 'Teal');
      await expect.poll(() => authPage.order()).toEqual(before);
    }
  });

  test('changing a colour does not move the card', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [{ issuer: 'Alpha' }, { issuer: 'Bravo' }, { issuer: 'Charlie' }]);
    await page.reload();
    await authPage.enroll();

    await expect.poll(() => authPage.order()).toEqual(['Alpha', 'Bravo', 'Charlie']);

    await authPage.pickStyle('Bravo', 'Teal');

    await expect.poll(() => authPage.order()).toEqual(['Alpha', 'Bravo', 'Charlie']);
    await expect(authPage.card('Bravo')).toHaveAttribute('data-color', 'teal');
  });

  test('changing a pattern does not move the card', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [{ issuer: 'Alpha' }, { issuer: 'Bravo' }, { issuer: 'Charlie' }]);
    await page.reload();
    await authPage.enroll();

    await authPage.pickStyle('Bravo', 'Dots');

    await expect.poll(() => authPage.order()).toEqual(['Alpha', 'Bravo', 'Charlie']);
    await expect(authPage.card('Bravo')).toHaveAttribute('data-pattern', 'dots');
  });

  test('restyling every card in turn leaves the order untouched', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [
      { issuer: 'Alpha' },
      { issuer: 'Bravo' },
      { issuer: 'Charlie' },
      { issuer: 'Delta' },
    ]);
    await page.reload();
    await authPage.enroll();

    const expected = ['Alpha', 'Bravo', 'Charlie', 'Delta'];
    for (const issuer of expected) {
      await authPage.pickStyle(issuer, 'Rose');
      await expect.poll(() => authPage.order()).toEqual(expected);
    }
  });

  /**
   * Records that already share a position — the state the old ascending
   * arithmetic could leave behind, where `above / 2` marched every position
   * toward zero until neighbours collided.
   */
  test('a list with collided positions still renders in a stable order', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [
      { issuer: 'Alpha', position: 1000 },
      { issuer: 'Bravo', position: 1000 },
      { issuer: 'Charlie', position: 1000 },
    ]);
    await page.reload();
    await authPage.enroll();

    await expect(authPage.cards).toHaveCount(3);
    const before = await authPage.order();

    // Restyling must not shuffle a tied group, and a reload must agree.
    await authPage.pickStyle(before[1], 'Teal');
    await expect.poll(() => authPage.order()).toEqual(before);

    await page.reload();
    await expect(authPage.cards).toHaveCount(3);
    await expect.poll(() => authPage.order()).toEqual(before);
  });

  /**
   * Dropping *between* two collided neighbours has no midpoint to write, so the
   * grid renumbers the whole list instead of silently doing nothing.
   *
   * Note this needs a mid-list drop specifically: a drop at either end still
   * resolves (`below + STEP` / `above / 2`) even when every position is equal,
   * so it never reaches the renumber path.
   */
  test('dragging between two collided cards repairs the positions', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [
      { issuer: 'Alpha', position: 500 },
      { issuer: 'Bravo', position: 500 },
      { issuer: 'Charlie', position: 500 },
    ]);
    await page.reload();
    await authPage.enroll();

    const before = await authPage.order();
    // Onto the middle card, so both neighbours share the dragged card's position.
    await drag(page, authPage, before[2], before[1]);

    await expect.poll(() => authPage.order()).toEqual([before[0], before[2], before[1]]);

    // Every position distinct again, so the next drag has somewhere to land.
    const res = await trpcGet(page.request, 'otp.list');
    const { records } = (await res.json()) as { records: WireRecord[] };
    const positions = records.map((r) => r.position);
    expect(new Set(positions).size).toBe(positions.length);
  });

  test('drag reorders the list and the server agrees', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    const seeded = await seedOtpRecords(address, mekBytes, [
      { issuer: 'Alpha' },
      { issuer: 'Bravo' },
      { issuer: 'Charlie' },
    ]);
    await page.reload();
    await authPage.enroll();

    await drag(page, authPage, 'Charlie', 'Alpha');
    await expect.poll(() => authPage.order()).toEqual(['Charlie', 'Alpha', 'Bravo']);

    const byIssuer = Object.fromEntries(seeded.map((r) => [r.issuer, r.id]));
    expect(await serverOrder(page)).toEqual([byIssuer.Charlie, byIssuer.Alpha, byIssuer.Bravo]);

    // And the order survives a reload, i.e. it came back from the server rather
    // than living only in the local cache.
    await page.reload();
    await expect(authPage.cards).toHaveCount(3);
    await expect.poll(() => authPage.order()).toEqual(['Charlie', 'Alpha', 'Bravo']);
  });

  test('two sequential drags compose', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [
      { issuer: 'Alpha' },
      { issuer: 'Bravo' },
      { issuer: 'Charlie' },
      { issuer: 'Delta' },
    ]);
    await page.reload();
    await authPage.enroll();

    await drag(page, authPage, 'Charlie', 'Bravo');
    await expect.poll(() => authPage.order()).toEqual(['Alpha', 'Charlie', 'Bravo', 'Delta']);

    await drag(page, authPage, 'Delta', 'Alpha');
    await expect.poll(() => authPage.order()).toEqual(['Delta', 'Alpha', 'Charlie', 'Bravo']);
  });

  /** A new credential belongs at the top, as a new note does. */
  test('a newly added credential lands first', async ({ page }) => {
    const authPage = new AuthenticatorPage(page);
    const { address, mekBytes } = await authPage.signInDirectly();
    await seedOtpRecords(address, mekBytes, [{ issuer: 'Alpha' }, { issuer: 'Bravo' }]);
    await page.reload();
    await authPage.enroll();

    await page.getByTestId('auth-new').click();
    await page.getByRole('tab', { name: 'Paste link' }).click();
    await page.getByLabel('Setup link').fill('otpauth://totp/Zulu:new@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Zulu');

    const done = page.waitForResponse(trpcMutationOf('otp.create'));
    await page.getByRole('button', { name: 'Add credential' }).click();
    await done;

    await expect(authPage.cards).toHaveCount(3);
    await expect.poll(() => authPage.order()).toEqual(['Zulu', 'Alpha', 'Bravo']);
  });
});
