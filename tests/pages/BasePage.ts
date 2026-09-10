import { expect, type Page } from '@playwright/test';
import type { Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mockProvider } from '../utils/mockProvider';
import { changeAccount } from '../utils/changeAccount';
import { makeAccount } from '../utils/makeAccount';
import { signIn } from '../utils/signIn';
import { createTestSession } from '../utils/createTestSession';
import { injectSession } from '../utils/injectSession';

export class BasePage {
  readonly page: Page;
  protected defaultUrl: string = '/';

  constructor(page: Page) {
    this.page = page;
  }

  async goto(url?: string): Promise<void> {
    await this.page.goto(url ?? this.defaultUrl);
  }

  /**
   * Full sign-in flow via wallet.
   * - No arg: creates a fresh account, runs mockProvider + goto + changeAccount + signIn.
   * - With privateKey: uses the provided key (assumes any DB fixtures already exist).
   * Returns { privateKey, account }.
   */
  async signInWithWallet(privateKey?: `0x${string}`): Promise<{
    privateKey: `0x${string}`;
    account: ReturnType<typeof makeAccount>['account'];
  }> {
    let key: `0x${string}`;
    let account: ReturnType<typeof makeAccount>['account'];

    if (privateKey) {
      key = privateKey;
      account = privateKeyToAccount(key);
    } else {
      const made = makeAccount();
      key = made.privateKey;
      account = made.account;
    }

    await mockProvider(this.page);
    await this.goto();
    await changeAccount(this.page, key);
    await signIn(this.page);

    return { privateKey: key, account };
  }

  /**
   * Fast sign-in by injecting a NextAuth session cookie directly — no UI flow.
   * - No arg: creates a fresh account.
   * - With address: uses the provided address (assumes DB fixtures already exist).
   * `navigate: false` leaves the browser on about:blank, with the cookie in place
   * for `page.request`. Use it when a spec builds data over the API first: the
   * query cache is persisted to IndexedDB, so a page loaded beforehand snapshots
   * an empty list and keeps serving it for the whole staleTime.
   * Returns { address }.
   */
  async signInDirectly(
    address?: Address,
    { navigate = true }: { navigate?: boolean } = {},
  ): Promise<{
    address: Address;
  }> {
    const resolvedAddress = address ?? makeAccount().account.address;
    const token = await createTestSession(resolvedAddress);
    await injectSession(this.page, token);
    if (navigate) await this.goto();
    return { address: resolvedAddress };
  }

  /**
   * Open the passphrase modal and unlock the vault.
   *
   * `page.goto()` waits for the document, not for React, so under parallel-worker
   * load a submit click occasionally never reaches the handler — the same hazard
   * NotesPage.openInEditMode guards against. Re-press the modal's Unlock while it
   * sits idle (visible and not deriving) instead of assuming one click landed.
   */
  async unlockVault(passphrase: string): Promise<void> {
    const unlockButton = this.page.getByTestId('unlock-button');
    const field = this.page.getByPlaceholder('Your passphrase');
    const submit = this.page.getByRole('button', { name: 'Unlock' }).last();

    await unlockButton.click();
    await expect(field).toBeVisible();
    await field.fill(passphrase);

    await expect(async () => {
      // The submit button is disabled while PBKDF2 runs, so an enabled one next
      // to a filled field means the previous click was dropped, not slow.
      const idle = (await field.isVisible().catch(() => false)) && (await submit.isEnabled().catch(() => false));
      if (idle) await submit.click({ timeout: 1000 });
      // PBKDF2 at 600k iterations can be slow; allow enough time
      await expect(unlockButton).toHaveAttribute('aria-pressed', 'true', { timeout: 5000 });
    }).toPass({ timeout: 30000, intervals: [250, 500] });
  }

  /** Simulate tab becoming hidden (soft-lock trigger). */
  async simulateTabHidden(): Promise<void> {
    await this.page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }

  /**
   * Simulate the 5-minute inactivity hard lock without waiting 5 minutes.
   * Patches window.setTimeout so any long delay (≥1 min) becomes 50 ms, then
   * dispatches a mousemove so useAutoLock's resetTimer() re-arms with the fast
   * timeout.  After ~200 ms the inactivity timer fires and lock() runs.
   * No production code is modified — mirrors the setInterval override used in seals.spec.ts.
   */
  async simulateHardLock(): Promise<void> {
    await this.page.evaluate(() => {
      const orig = window.setTimeout.bind(window);
      // @ts-expect-error override for testing
      window.setTimeout = (fn: TimerHandler, ms?: number, ...args: unknown[]) =>
        orig(fn, ms !== undefined && ms >= 60_000 ? 50 : ms, ...args);
      // Reset the inactivity timer so it re-arms using the patched setTimeout.
      document.dispatchEvent(new MouseEvent('mousemove'));
    });
    // Give the 50 ms timer time to fire.
    await this.page.waitForTimeout(200);
  }
}
