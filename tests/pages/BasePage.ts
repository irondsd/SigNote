import { type Page } from '@playwright/test';
import { privateKeyToAccount } from 'viem/accounts';
import { mockProvider } from '../utils/mockProvider';
import { changeAccount } from '../utils/changeAccount';
import { makeAccount } from '../utils/makeAccount';
import { signIn } from '../utils/signIn';

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

  /** Simulate tab becoming hidden (soft-lock trigger). */
  async simulateTabHidden(): Promise<void> {
    await this.page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }
}
