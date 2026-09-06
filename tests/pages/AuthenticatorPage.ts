import { expect, type Locator, type Page } from '@playwright/test';
import type { Address } from 'viem';

import { BasePage } from './BasePage';
import { makeAccount } from '../utils/makeAccount';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';
import { createTestSession } from '../utils/createTestSession';
import { injectSession } from '../utils/injectSession';
import { trpcMutationOf } from '../utils/trpc';

export class AuthenticatorPage extends BasePage {
  protected defaultUrl = '/auth';
  static readonly PASSPHRASE = 'correct-horse-battery-staple-42';

  constructor(page: Page) {
    super(page);
  }

  /** Fresh account with an encryption profile, signed in via cookie injection. */
  async signInDirectly(): Promise<{ address: Address; mekBytes: Uint8Array }>;
  async signInDirectly(address: Address): Promise<{ address: Address }>;
  async signInDirectly(address?: Address): Promise<unknown> {
    if (address) {
      await injectSession(this.page, await createTestSession(address));
      await this.goto();
      return { address };
    }
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, AuthenticatorPage.PASSPHRASE);
    await injectSession(this.page, await createTestSession(account.address));
    await this.goto();
    return { address: account.address, mekBytes };
  }

  /**
   * Runs the trusted-device enrollment: click through the prompt, then satisfy
   * the passphrase guard. PBKDF2 at 600k iterations is slow, hence the timeout.
   */
  async enroll(trust = true, passphrase = AuthenticatorPage.PASSPHRASE): Promise<void> {
    const button = trust
      ? this.page.getByTestId('auth-trust-device')
      : this.page.getByRole('button', { name: /don't trust/i });
    await expect(button).toBeEnabled({ timeout: 15000 });
    await button.click();

    const field = this.page.getByPlaceholder('Your passphrase');
    if (await field.isVisible().catch(() => false)) {
      await field.fill(passphrase);
      await this.page.getByRole('button', { name: 'Unlock' }).last().click();
    }

    await expect(this.cards.first()).toBeVisible({ timeout: 25000 });
  }

  /** Signs in, enrolls, and lands on a ready list. */
  async ready(address: Address, trust = true): Promise<void> {
    await this.signInDirectly(address);
    await this.enroll(trust);
  }

  get cards(): Locator {
    return this.page.getByTestId('auth-card');
  }

  card(issuer: string): Locator {
    return this.cards.filter({ hasText: issuer });
  }

  /** Issuers in rendered order — the assertion most of these specs make. */
  async order(): Promise<string[]> {
    return this.cards.evaluateAll((cards) =>
      cards.map((c) => c.querySelector('[class*="issuer"]')?.textContent?.trim() ?? ''),
    );
  }

  /** Opens a card's ⋯ menu. */
  async openMenu(issuer: string): Promise<void> {
    await this.card(issuer).getByTestId('auth-actions-btn').click();
    await expect(this.styleMenuItem).toBeVisible();
  }

  private get styleMenuItem(): Locator {
    return this.page.getByRole('button', { name: /Card style/ });
  }

  /** Opens the menu and steps into the style pane. */
  async openStylePane(issuer: string): Promise<void> {
    await this.openMenu(issuer);
    await this.styleMenuItem.click();
    await expect(this.page.getByRole('button', { name: 'Default', exact: true })).toBeVisible();
  }

  /**
   * Picks a colour or pattern and waits for the write to land. Both are plain
   * buttons labelled by their capitalised name ("Teal", "Dots").
   */
  async pickStyle(issuer: string, name: string): Promise<void> {
    await this.openStylePane(issuer);
    const done = this.page.waitForResponse(trpcMutationOf('otp.update'));
    await this.page.getByRole('button', { name, exact: true }).click();
    await done;
    await this.closeMenu();
  }

  /**
   * Clicks an item in an open card menu, matched on its hint text.
   *
   * The labels alone are ambiguous — the page header has its own "Archive"
   * button, and the delete dialog its own "Delete" — so each item is addressed
   * by the description only the menu row carries.
   */
  private async menuItem(hint: RegExp): Promise<void> {
    await this.page.getByRole('button', { name: hint }).click();
  }

  /**
   * Archives (or restores) the named card and waits for the list to settle.
   *
   * The mutation response is not the finish line: the context decrypts the
   * updated snapshot before re-rendering, so the card is still on screen for a
   * tick after the HTTP call returns.
   */
  async setArchived(issuer: string, archived: boolean): Promise<void> {
    const countBefore = await this.cards.count();
    await this.openMenu(issuer);
    const done = this.page.waitForResponse(trpcMutationOf('otp.update'));
    await this.menuItem(archived ? /Moves it to the archive/ : /Move back to the main list/);
    await done;
    await expect(this.cards).toHaveCount(countBefore - 1);
  }

  /** Deletes the named card, confirming the dialog. */
  async deleteCard(issuer: string): Promise<void> {
    await this.openMenu(issuer);
    await this.menuItem(/The seed is unrecoverable/);
    await expect(this.page.getByRole('alertdialog')).toBeVisible();
    const countBefore = await this.cards.count();
    const done = this.page.waitForResponse(trpcMutationOf('otp.remove'));
    await this.page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await done;
    await expect(this.cards).toHaveCount(countBefore - 1);
  }

  /** Opens the export dialog for the named card. */
  async openExport(issuer: string): Promise<void> {
    await this.openMenu(issuer);
    await this.menuItem(/Reveals the seed/);
  }

  async closeMenu(): Promise<void> {
    await this.page.keyboard.press('Escape');
    // Wait for the popover to actually unmount — opening the next card's menu
    // while this one is still closing lands the click on the dismiss layer.
    await expect(this.styleMenuItem).toBeHidden();
  }
}
