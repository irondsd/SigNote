'use client';

/**
 * The key-rotation wizard.
 *
 * Every rule it enforces lives in `lib/rotation/wizard.ts`; this file is the
 * rendering of that object. A disabled button here is a picture of
 * `canAdvance()`, never a second opinion about it — which matters because a
 * wizard that could be skipped by manipulating the DOM would be the kind of
 * safety story the plan explicitly refuses to accept.
 *
 * The completed markers on the rail are status indicators, not checkboxes: they
 * report what the server has durably accepted, and a user cannot tick one.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { CheckCircle, Download, KeyRound, Loader2, ShieldAlert, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MIN_PASSPHRASE_LENGTH } from '@/config/constants';
import { useRotationWizard } from '@/hooks/useRotationWizard';
import { discardDraftKeys, observeDraftFreeze } from '@/lib/rotation/drafts';
import { passphraseProblem, type WizardStep } from '@/lib/rotation/wizard';
import s from './page.module.scss';

const RAIL: { step: WizardStep; label: string }[] = [
  { step: 'intro', label: 'Overview' },
  { step: 'sessions', label: 'Sessions' },
  { step: 'drafts', label: 'Local work' },
  { step: 'credentials', label: 'Passphrase' },
  { step: 'confirm', label: 'Start' },
  { step: 'running', label: 'Re-encrypt' },
  { step: 'recovery', label: 'Recovery file' },
  { step: 'commit', label: 'Activate' },
];

const order = (step: WizardStep) => RAIL.findIndex((entry) => entry.step === step);

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default function RotateKeysPage() {
  const { status } = useSession();
  const router = useRouter();
  const { wizard, state } = useRotationWizard();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const recoveryInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/');
  }, [status, router]);

  // This tab is also an ordinary tab: if another one starts a rotation, it must
  // stop writing encrypted checkpoints too.
  useEffect(() => observeDraftFreeze(), []);

  useEffect(() => {
    if (wizard) void wizard.load();
  }, [wizard]);

  if (status !== 'authenticated' || !wizard || !state) return null;

  const { step, busy, error } = state;
  const advance = () => wizard.goTo(RAIL[Math.min(order(step) + 1, RAIL.length - 1)].step);
  const canAdvance = wizard.canAdvance();

  const passphraseIssue = next || confirmation ? passphraseProblem(next, confirmation) : null;

  const saveRecoveryFile = () => {
    const file = wizard.buildRecoveryFile();
    const url = URL.createObjectURL(new Blob([file.contents], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const readRecoveryFile = async (file: File | undefined) => {
    if (!file) return;
    await wizard.confirmRecoveryFile(await file.text());
  };

  return (
    <div className={s.container}>
      <div className={s.card} data-testid="rotation-wizard" data-step={step}>
        <div className={step === 'done' ? s.successIcon : s.iconWrap}>
          {step === 'done' ? <CheckCircle size={40} strokeWidth={1.3} /> : <KeyRound size={40} strokeWidth={1.3} />}
        </div>

        <ol className={s.rail} aria-label="Rotation steps">
          {RAIL.map((entry) => {
            const position = order(entry.step);
            const done = step === 'done' || position < order(step);
            return (
              <li
                key={entry.step}
                className={`${s.railItem} ${entry.step === step ? s.railCurrent : ''} ${done ? s.railDone : ''}`}
                aria-current={entry.step === step ? 'step' : undefined}
                data-state={done ? 'complete' : entry.step === step ? 'current' : 'pending'}
              >
                {done && <CheckCircle size={12} aria-hidden />}
                {entry.label}
              </li>
            );
          })}
        </ol>

        {step === 'intro' && (
          <section className={s.section} data-testid="rotation-intro">
            <h2 className={s.heading}>Replace your encryption keys</h2>
            <p className={s.body}>
              This replaces the encryption keys for your Secrets, Seals, Authenticator entries, their history and every
              encrypted attachment. Plaintext Notes are not affected. Keep your current and new passphrases available
              until it finishes.
            </p>
            <p className={s.warning}>
              If your connection drops or this device restarts, sign in again to resume — your existing data stays
              readable until the very last step. Unsaved encrypted drafts left on other devices will no longer open
              after this completes.
            </p>
            <p className={s.hint}>
              Use a laptop or desktop on power and a stable network, and keep this page open. Rotation cannot recover
              data that is already damaged or missing, and it cannot revoke anything that has already been copied off
              this account.
            </p>
            <Button onClick={advance} data-testid="rotation-start">
              Get started
            </Button>
          </section>
        )}

        {step === 'sessions' && (
          <section className={s.section} data-testid="rotation-sessions">
            <h2 className={s.heading}>Sign out everywhere else</h2>
            {state.resuming && (
              <p className={s.warning} data-testid="rotation-resuming">
                A rotation is already in progress on this account. Nothing that was already done is lost — signing in
                again cleared the server&apos;s record of which session owns it, so this step has to be repeated before
                it can continue.
              </p>
            )}
            <p className={s.body}>
              Every other session must end before the keys can be replaced, so that no other device can write with the
              old keys while this runs. This is irreversible — those devices will need to sign in again even if you
              cancel the rotation.
            </p>
            <p className={s.hint}>
              It cannot erase anything already on those devices. If you have unsaved work elsewhere, save it first.
            </p>
            {state.sessions.checked && (
              <p className={s.hint} data-testid="rotation-session-count">
                {state.sessions.otherSessions === 0
                  ? 'This is now the only active session.'
                  : `${state.sessions.otherSessions} other session${state.sessions.otherSessions === 1 ? '' : 's'} still active.`}
              </p>
            )}
            <div className={s.actions}>
              <Button
                variant="outline"
                onClick={() => void wizard.revokeOtherSessions()}
                disabled={busy}
                data-testid="rotation-revoke-others"
              >
                Revoke all other sessions
              </Button>
              <Button onClick={advance} disabled={!canAdvance || busy} data-testid="rotation-next">
                Continue
              </Button>
            </div>
          </section>
        )}

        {step === 'drafts' && (
          <section className={s.section} data-testid="rotation-drafts">
            <h2 className={s.heading}>Resolve unsaved work</h2>
            <p className={s.body}>
              Unsaved drafts on this device are stored with the keys that are about to be replaced. Save them from their
              editors, or discard them here.
            </p>

            {state.drafts?.scan.storageUnavailable && (
              <p className={s.error} data-testid="rotation-draft-storage-error">
                This browser will not let the app read its local storage, so it cannot tell whether you have unsaved
                drafts. Allow site data for this site and scan again.
              </p>
            )}

            {(state.drafts?.scan.drafts.length ?? 0) > 0 && (
              <ul className={s.list} data-testid="rotation-draft-list">
                {state.drafts?.scan.drafts.map((draft) => (
                  <li key={draft.draftId ?? draft.title} className={s.listRow}>
                    <span className={s.listTitle}>{draft.title || 'Untitled'}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        discardDraftKeys([draft.draftId ? `sn_draft:${draft.draftId}` : 'sn_draft']);
                        wizard.rescanDrafts();
                      }}
                    >
                      Discard
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {(state.drafts?.scan.unreadableKeys.length ?? 0) > 0 && (
              <>
                <p className={s.error} data-testid="rotation-draft-unreadable">
                  {state.drafts?.scan.unreadableKeys.length === 1
                    ? '1 saved item could not be read.'
                    : `${state.drafts?.scan.unreadableKeys.length} saved items could not be read.`}{' '}
                  They may be drafts whose storage was damaged, so this cannot be treated as “no unsaved work”. Nothing
                  is deleted unless you choose to.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    discardDraftKeys(state.drafts?.scan.unreadableKeys ?? []);
                    wizard.rescanDrafts();
                  }}
                  data-testid="rotation-discard-unreadable"
                >
                  Discard unreadable items
                </Button>
              </>
            )}

            <label className={s.acknowledgement}>
              <input
                type="checkbox"
                checked={state.acknowledgedOtherDevices}
                onChange={(event) => wizard.acknowledgeOtherDevices(event.target.checked)}
                data-testid="rotation-ack-other-devices"
              />
              <span>
                I checked my other devices. I understand that remaining unsaved encrypted drafts will become
                unrecoverable after rotation.
              </span>
            </label>

            <div className={s.actions}>
              <Button variant="outline" onClick={() => wizard.rescanDrafts()} data-testid="rotation-rescan-drafts">
                Scan again
              </Button>
              <Button onClick={advance} disabled={!canAdvance || busy} data-testid="rotation-next">
                Continue
              </Button>
            </div>
          </section>
        )}

        {step === 'credentials' && (
          <section className={s.section} data-testid="rotation-credentials">
            <h2 className={s.heading}>Verify and choose a passphrase</h2>
            <p className={s.body}>
              {state.resuming
                ? 'Enter your current passphrase and the new one you chose when this rotation started. Both are checked in this browser and never sent anywhere.'
                : 'Your current passphrase is checked in this browser and never sent anywhere. You may keep the same passphrase — a fresh salt means the stored halves change either way — but changing it is recommended.'}
            </p>
            <div className={s.field}>
              <label className={s.label} htmlFor="rotate-current">
                Current passphrase
              </label>
              <Input
                id="rotate-current"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
                data-testid="rotation-current-passphrase"
              />
            </div>
            <div className={s.field}>
              <label className={s.label} htmlFor="rotate-new">
                New passphrase
              </label>
              <Input
                id="rotate-new"
                type="password"
                autoComplete="new-password"
                placeholder={`At least ${MIN_PASSPHRASE_LENGTH} characters`}
                value={next}
                onChange={(event) => setNext(event.target.value)}
                data-testid="rotation-new-passphrase"
              />
            </div>
            <div className={s.field}>
              <label className={s.label} htmlFor="rotate-confirm">
                Confirm new passphrase
              </label>
              <Input
                id="rotate-confirm"
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                data-testid="rotation-confirm-passphrase"
              />
            </div>
            {passphraseIssue && <p className={s.error}>{passphraseIssue}</p>}
            {state.reusingPassphrase && (
              <p className={s.hint}>You kept the same passphrase. Your keys are still being replaced.</p>
            )}
            <div className={s.actions}>
              <Button
                onClick={async () => {
                  await wizard.setCredentials(current, next, confirmation);
                  if (wizard.canAdvance('credentials')) advance();
                }}
                disabled={busy || !current || !!passphraseIssue}
                data-testid="rotation-verify-passphrase"
              >
                {busy ? 'Checking…' : 'Verify and continue'}
              </Button>
            </div>
          </section>
        )}

        {step === 'confirm' && (
          <section className={s.section} data-testid="rotation-confirm">
            <h2 className={s.heading}>Ready to start</h2>
            <p className={s.body}>
              Starting freezes changes to your encrypted data and creates the new copies alongside the existing ones.
              Nothing is replaced until the final step, and you can cancel until then.
            </p>
            <p className={s.warning}>
              You confirmed that unsaved encrypted drafts on other devices will become unrecoverable, and other sessions
              have been revoked. Those two things are not undone by cancelling.
            </p>
            <div className={s.actions}>
              <Button variant="outline" asChild>
                <Link href="/secrets">Not now</Link>
              </Button>
              <Button onClick={() => void wizard.begin()} disabled={busy} data-testid="rotation-begin">
                {busy ? 'Starting…' : 'Start rotation'}
              </Button>
            </div>
          </section>
        )}

        {step === 'running' && (
          <section className={s.section} data-testid="rotation-running">
            <h2 className={s.heading}>Replacing your encrypted data</h2>
            <p className={s.body}>Keep this page open. If it is interrupted you can sign in again and resume.</p>
            <RotationProgressBar state={state} />
            <div className={s.actions}>
              {/* Pausing stops the worker where it stands. Everything already
                  accepted by the server survives, so resuming picks up rather
                  than starting over — and cancelling is still lossless. */}
              {busy ? (
                <Button variant="outline" onClick={() => wizard.pauseProcessing()} data-testid="rotation-pause">
                  Pause
                </Button>
              ) : (
                <Button variant="outline" onClick={() => void wizard.cancel()} data-testid="rotation-cancel">
                  Cancel
                </Button>
              )}
              <Button onClick={() => void wizard.process()} disabled={busy} data-testid="rotation-process">
                {busy ? 'Working…' : state.progress ? 'Resume' : 'Begin re-encrypting'}
              </Button>
            </div>
          </section>
        )}

        {step === 'recovery' && (
          <section className={s.section} data-testid="rotation-recovery">
            <h2 className={s.heading}>Save your new recovery file</h2>
            <p className={s.body}>
              This file is the only way back into the new keys if you forget the new passphrase. Save it somewhere safe,
              then select it again so this device can confirm it really works.
            </p>
            <p className={s.hint}>
              Until the rotation is activated this file is marked as pending: it does not unlock your current data, and
              it is useless if you cancel.
            </p>
            <div className={s.actions}>
              <Button variant="outline" onClick={saveRecoveryFile} data-testid="rotation-save-recovery">
                <Download size={16} aria-hidden /> Save recovery file
              </Button>
              <Button
                onClick={() => recoveryInput.current?.click()}
                disabled={busy || !state.recoverySaved}
                data-testid="rotation-verify-recovery"
              >
                <Upload size={16} aria-hidden /> Confirm the saved file
              </Button>
            </div>
            <input
              ref={recoveryInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => void readRecoveryFile(event.target.files?.[0])}
              data-testid="rotation-recovery-input"
            />
          </section>
        )}

        {step === 'commit' && (
          <section className={s.section} data-testid="rotation-commit">
            <h2 className={s.heading}>Activate the new keys</h2>
            <p className={s.body}>
              Everything has been re-encrypted and verified. Activating switches your whole vault over in one step.
              After this your old passphrase and old recovery files stop working.
            </p>
            <div className={s.actions}>
              <Button variant="outline" onClick={() => void wizard.cancel()} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={() => void wizard.commit()} disabled={busy} data-testid="rotation-activate">
                {busy ? 'Activating…' : 'Activate new keys'}
              </Button>
            </div>
          </section>
        )}

        {step === 'done' && (
          <section className={s.section} data-testid="rotation-done">
            <h2 className={s.heading}>Rotation complete</h2>
            <p className={s.body}>
              Your data is now encrypted with the new keys. Use the new passphrase from now on, and keep the recovery
              file you just saved — earlier recovery files no longer open this vault.
            </p>
            <p className={s.hint}>
              Your other devices must sign in, unlock, and set up the Authenticator again. Cleaning up the old encrypted
              copies happens in the background; if that is delayed it does not affect the rotation.
            </p>
            <Button asChild data-testid="rotation-finish">
              <Link href="/secrets">Back to Secrets</Link>
            </Button>
          </section>
        )}

        {error && (
          <div role="alert">
            <p className={s.error} data-testid="rotation-error">
              <ShieldAlert size={14} aria-hidden /> {error}
            </p>
            {/* Cancelling needs the same single-session prerequisite as every
                other step, so a device signing in mid-rotation otherwise leaves
                the user fenced with no way out. Offer the two actions as one. */}
            {error.startsWith('Another session signed in.') && state.operation && (
              <div className={s.actions}>
                <Button
                  variant="outline"
                  onClick={() => void wizard.revokeAndCancel()}
                  disabled={busy}
                  data-testid="rotation-revoke-and-cancel"
                >
                  Revoke other sessions and cancel
                </Button>
              </div>
            )}
          </div>
        )}
        {busy && (
          <p className={s.hint} role="status">
            <Loader2 size={14} aria-hidden /> Working…
          </p>
        )}
      </div>
    </div>
  );
}

function RotationProgressBar({ state }: { state: NonNullable<ReturnType<typeof useRotationWizard>['state']> }) {
  const progress = state.progress;
  const total = progress?.total ?? state.operation?.itemCount ?? 0;
  const processed = progress?.processed ?? 0;
  const percent = total > 0 ? Math.round((processed / total) * 100) : 0;

  return (
    <div className={s.section} data-testid="rotation-progress" data-processed={processed} data-total={total}>
      <div className={s.progressTrack}>
        <div className={s.progressBar} style={{ width: `${percent}%` }} />
      </div>
      <div className={s.progressMeta}>
        {/* Counted only when the server has durably accepted an item, which is
            why this can sit still while a large file transfers. */}
        <span aria-live="polite">
          {processed} of {total} items
        </span>
        {(progress?.bytesTotal ?? 0) > 0 && (
          <span>
            {formatBytes(progress?.bytesProcessed ?? 0)} / {formatBytes(progress?.bytesTotal ?? 0)}
          </span>
        )}
      </div>
    </div>
  );
}
