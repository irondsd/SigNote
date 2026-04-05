import { type Page } from '@playwright/test';
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
   * Returns { address }.
   */
  async signInDirectly(address?: Address): Promise<{ address: Address }> {
    const resolvedAddress = address ?? makeAccount().account.address;
    const token = await createTestSession(resolvedAddress);
    await injectSession(this.page, token);
    await this.goto();
    return { address: resolvedAddress };
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
