import { expect, type Page } from '@playwright/test';
import type { Address } from 'viem';

import { BasePage } from './BasePage';
import { makeAccount } from '../utils/makeAccount';
import { seedEncryptionProfile } from '../fixtures/seedEncryptionProfile';
import { createTestSession } from '../utils/createTestSession';
import { injectSession } from '../utils/injectSession';

/**
 * The key-rotation wizard.
 *
 * Two things about driving it are worth knowing before reading the specs.
 *
 * The recovery step is a genuine round trip through the filesystem: the wizard
 * hands the browser a download and will not accept a confirmation that did not
 * come back through a file input. The page object captures the download and
 * feeds the same bytes back, because a helper that skipped that would be
 * testing a code path no user takes.
 *
 * And the whole run is PBKDF2-bound. The current passphrase is verified and the
 * new material derived at production iteration counts — twice — so the timeouts
 * here are generous by necessity, not by superstition.
 */
export class RotationPage extends BasePage {
  protected defaultUrl = '/rotate-keys';
  /** The same passphrase the rest of the suite seeds profiles with. */
  static readonly PASSPHRASE = 'correct-horse-battery-staple-42';
  static readonly NEW_PASSPHRASE = 'a-completely-different-passphrase-99';

  constructor(page: Page) {
    super(page);
  }

  /**
   * A fresh account with an encryption profile, signed in by cookie injection.
   *
   * `navigate: false` leaves the browser on about:blank so a spec can seed rows
   * and upload attachments through `page.request` before the wizard's first
   * status call freezes an inventory that would otherwise miss them.
   */
  async signInWithProfile({ navigate = true }: { navigate?: boolean } = {}): Promise<{
    address: Address;
    mekBytes: Uint8Array;
  }> {
    const { account } = makeAccount();
    const { mekBytes } = await seedEncryptionProfile(account.address, RotationPage.PASSPHRASE);
    await injectSession(this.page, await createTestSession(account.address));
    if (navigate) await this.goto();
    return { address: account.address, mekBytes };
  }

  /** The wizard's current step, read from the container rather than inferred. */
  async step(): Promise<string> {
    return (await this.page.getByTestId('rotation-wizard').getAttribute('data-step')) ?? '';
  }

  async expectStep(step: string, timeout = 20_000): Promise<void> {
    await expect(this.page.getByTestId('rotation-wizard')).toHaveAttribute('data-step', step, { timeout });
  }

  async startFromIntro(): Promise<void> {
    await this.page.getByTestId('rotation-start').click();
    await this.expectStep('sessions');
  }

  /** Revokes every other session, then waits for the server to confirm it. */
  async revokeOtherSessions(): Promise<void> {
    await this.page.getByTestId('rotation-revoke-others').click();
    await expect(this.page.getByTestId('rotation-session-count')).toHaveText(/only active session/, {
      timeout: 20_000,
    });
  }

  async continueStep(): Promise<void> {
    await this.page.getByTestId('rotation-next').click();
  }

  async acknowledgeDrafts(): Promise<void> {
    await this.page.getByTestId('rotation-rescan-drafts').click();
    await this.page.getByTestId('rotation-ack-other-devices').check();
  }

  async enterPassphrases(current: string, next: string): Promise<void> {
    await this.page.getByTestId('rotation-current-passphrase').fill(current);
    await this.page.getByTestId('rotation-new-passphrase').fill(next);
    await this.page.getByTestId('rotation-confirm-passphrase').fill(next);
    await this.page.getByTestId('rotation-verify-passphrase').click();
  }

  async begin(): Promise<void> {
    await this.page.getByTestId('rotation-begin').click();
    await this.expectStep('running', 40_000);
  }

  /** Runs the worker and waits for every item to be durably accepted. */
  async processAll(timeout = 120_000): Promise<void> {
    await this.page.getByTestId('rotation-process').click();
    await expect(this.page.getByTestId('rotation-wizard')).toHaveAttribute('data-step', 'recovery', { timeout });
  }

  async progress(): Promise<{ processed: number; total: number }> {
    const bar = this.page.getByTestId('rotation-progress');
    return {
      processed: Number(await bar.getAttribute('data-processed')),
      total: Number(await bar.getAttribute('data-total')),
    };
  }

  /**
   * Saves the recovery file and confirms it, exactly as a user would: download,
   * then select the downloaded file. Returns its contents so a spec can assert
   * on the binding or reuse it later.
   */
  async saveAndConfirmRecoveryFile(): Promise<string> {
    const contents = await this.saveRecoveryFile();
    await this.confirmRecoveryFile(contents);
    return contents;
  }

  async saveRecoveryFile(): Promise<string> {
    const download = this.page.waitForEvent('download');
    await this.page.getByTestId('rotation-save-recovery').click();
    const stream = await (await download).createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  }

  /** Feeds bytes back through the real file input, never through the store. */
  async confirmRecoveryFile(contents: string): Promise<void> {
    await this.page.getByTestId('rotation-recovery-input').setInputFiles({
      name: 'signote-recovery.json',
      mimeType: 'application/json',
      buffer: Buffer.from(contents, 'utf8'),
    });
  }

  async activate(timeout = 60_000): Promise<void> {
    await this.page.getByTestId('rotation-activate').click();
    await this.expectStep('done', timeout);
  }

  async cancel(): Promise<void> {
    await this.page.getByTestId('rotation-cancel').click();
  }

  async error(): Promise<string | null> {
    const error = this.page.getByTestId('rotation-error');
    return (await error.count()) > 0 ? error.textContent() : null;
  }

  /**
   * Everything up to (but not including) activation. Steps are driven one at a
   * time rather than in a single helper call so a spec can interrupt anywhere.
   */
  async runUntilActivation(
    current = RotationPage.PASSPHRASE,
    next = RotationPage.NEW_PASSPHRASE,
  ): Promise<{ recoveryFile: string }> {
    await this.expectStep('intro');
    await this.startFromIntro();
    await this.revokeOtherSessions();
    await this.continueStep();
    await this.expectStep('drafts');
    await this.acknowledgeDrafts();
    await this.continueStep();
    await this.expectStep('credentials');
    await this.enterPassphrases(current, next);
    await this.expectStep('confirm', 60_000);
    await this.begin();
    await this.processAll();
    const recoveryFile = await this.saveAndConfirmRecoveryFile();
    await this.expectStep('commit', 30_000);
    return { recoveryFile };
  }
}
