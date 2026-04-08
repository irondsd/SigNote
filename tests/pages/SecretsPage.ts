import { expect, type Locator, type Page } from '@playwright/test';
import type { Address } from 'viem';
import { BasePage } from './BasePage';
import { makeAccount } from '../utils/makeAccount';
import { mockProvider } from '../utils/mockProvider';
import { changeAccount } from '../utils/changeAccount';
import { signIn } from '../utils/signIn';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';
import { createTestSession } from '../utils/createTestSession';
import { injectSession } from '../utils/injectSession';

export class SecretsPage extends BasePage {
  protected defaultUrl = '/secrets';
  static readonly PASSPHRASE = 'correct-horse-battery-staple-42';

  constructor(page: Page) {
    super(page);
  }

  /**
   * No-arg: creates fresh account + seeds encryption profile + signs in.
   * Returns { privateKey, account, mekBytes }.
   */
  async signInWithWallet(): Promise<{
    privateKey: `0x${string}`;
    account: ReturnType<typeof makeAccount>['account'];
    mekBytes: Uint8Array;
  }>;

  /**
   * With privateKey: assumes profile already seeded externally, just does UI sign-in.
   * Returns { privateKey }.
   */
  async signInWithWallet(privateKey: `0x${string}`): Promise<{
    privateKey: `0x${string}`;
  }>;

  async signInWithWallet(privateKey?: `0x${string}`): Promise<unknown> {
    if (privateKey) {
      await mockProvider(this.page);
      await this.goto();
      await changeAccount(this.page, privateKey);
      await signIn(this.page);
      return { privateKey };
    }

    const { privateKey: key, account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SecretsPage.PASSPHRASE);

    await mockProvider(this.page);
    await this.goto();
    await changeAccount(this.page, key);
    await signIn(this.page);

    return { privateKey: key, account, mekBytes };
  }

  /**
   * Fast sign-in via cookie injection.
   * - No arg: creates fresh account + seeds encryption profile.
   * - With address: assumes profile already seeded externally.
   */
  async signInDirectly(): Promise<{ address: Address; mekBytes: Uint8Array }>;
  async signInDirectly(address: Address): Promise<{ address: Address }>;
  async signInDirectly(address?: Address): Promise<unknown> {
    if (address) {
      const token = await createTestSession(address);
      await injectSession(this.page, token);
      await this.goto();
      return { address };
    }
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, SecretsPage.PASSPHRASE);
    const token = await createTestSession(account.address);
    await injectSession(this.page, token);
    await this.goto();
    return { address: account.address, mekBytes };
  }

  async unlock(passphrase = SecretsPage.PASSPHRASE): Promise<void> {
    const unlockButton = this.page.getByTestId('unlock-button');

    await unlockButton.click();
    await expect(this.page.getByPlaceholder('Your passphrase')).toBeVisible();
    await this.page.getByPlaceholder('Your passphrase').fill(passphrase);
    await this.page.getByRole('button', { name: 'Unlock' }).last().click();
    // PBKDF2 at 600k iterations can be slow; allow enough time
    await expect(unlockButton).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 });
  }

  async lock(): Promise<void> {
    const lockButton = this.page.getByTestId('lock-button');
    await lockButton.click();
  }

  secretCard(title: string): Locator {
    return this.page.getByTestId('secret-card').filter({ hasText: title });
  }
}
