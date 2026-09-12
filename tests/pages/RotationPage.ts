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
  async step(timeout = 10_000): Promise<string> {
    return (await this.page.getByTestId('rotation-wizard').getAttribute('data-step', { timeout })) ?? '';
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

  /**
   * Runs the worker and waits for every item to be durably accepted.
   *
   * The wait is bounded by *stalling*, not by a deadline. A flat timeout has to
   * be set for the slowest run the suite contains — 500 items and 100 MiB of
   * files, six workers deep — which makes it both too short there and useless
   * everywhere else. This instead fails as soon as the wizard stops making
   * progress, and otherwise waits as long as it keeps making it.
   *
   * `hardTimeout` remains as a backstop against a wizard that reports progress
   * forever without finishing; leave it alone unless a spec has a reason.
   */
  async processAll({ stallTimeout = 60_000, hardTimeout = 480_000 } = {}): Promise<void> {
    await this.page.getByTestId('rotation-process').click();

    const startedAt = Date.now();
    let lastMovedAt = Date.now();
    let lastProgress = '';

    for (;;) {
      const step = await this.step();
      if (step === 'recovery') return;

      // A wizard that surfaced an error is done moving; say what it said
      // rather than sitting out the stall window to report a timeout.
      const error = await this.error();
      if (error) throw new Error(`Rotation stopped with an error during processing: ${error}`);

      const progress = await this.progress(2_000).catch(() => null);
      const signature = progress ? `${progress.processed} items / ${progress.bytesProcessed} bytes` : '';
      if (signature !== lastProgress) {
        lastProgress = signature;
        lastMovedAt = Date.now();
      }

      const stalledFor = Date.now() - lastMovedAt;
      if (stalledFor > stallTimeout)
        throw new Error(
          `Rotation made no progress for ${Math.round(stalledFor / 1000)}s at step "${step}" ` +
            `(${lastProgress || 'no progress reported'}).`,
        );
      if (Date.now() - startedAt > hardTimeout)
        throw new Error(
          `Rotation still at step "${step}" after ${Math.round(hardTimeout / 1000)}s ` +
            `(${lastProgress || 'no progress reported'}); it was still moving, so raise hardTimeout if that is expected.`,
        );

      await this.page.waitForTimeout(500);
    }
  }

  /**
   * All three counters out of one read, so a watcher comparing them across
   * polls cannot see two halves of different renders.
   */
  async progress(timeout = 10_000): Promise<{ processed: number; total: number; bytesProcessed: number }> {
    return this.page.getByTestId('rotation-progress').evaluate(
      (bar) => ({
        processed: Number(bar.getAttribute('data-processed')),
        total: Number(bar.getAttribute('data-total')),
        bytesProcessed: Number(bar.getAttribute('data-bytes-processed')),
      }),
      undefined,
      { timeout },
    );
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
