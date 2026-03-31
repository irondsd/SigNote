import { expect, type Locator, type Page } from '@playwright/test';
import { BasePage } from './BasePage';
import { makeAccount } from '../utils/makeAccount';
import { mockProvider } from '../utils/mockProvider';
import { changeAccount } from '../utils/changeAccount';
import { signIn } from '../utils/signIn';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';

export class SealsPage extends BasePage {
  protected defaultUrl = '/seals';
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
    const { mekBytes } = await seedEncryptionProfile(account.address, SealsPage.PASSPHRASE);

    await mockProvider(this.page);
    await this.goto();
    await changeAccount(this.page, key);
    await signIn(this.page);

    return { privateKey: key, account, mekBytes };
  }

  async unlock(passphrase = SealsPage.PASSPHRASE): Promise<void> {
    await this.page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(this.page.getByPlaceholder('Your passphrase')).toBeVisible();
    await this.page.getByPlaceholder('Your passphrase').fill(passphrase);
    await this.page.getByRole('button', { name: 'Unlock' }).last().click();
    // PBKDF2 at 600k iterations can be slow; allow enough time
    await expect(this.page.getByRole('button', { name: 'Lock', exact: true })).toBeVisible({ timeout: 20000 });
  }

  async lock(): Promise<void> {
    await this.page.getByRole('button', { name: 'Lock', exact: true }).click();
  }

  // NOTE: EncryptedNoteCard renders data-testid="secret-card" for both secrets and seals
  sealCard(title: string): Locator {
    return this.page.getByTestId('secret-card').filter({ hasText: title });
  }
}
