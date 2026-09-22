'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArchiveRestore, Check, Eye, EyeOff, FileArchive, Loader2, RefreshCw, ShieldCheck, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { VaultExportCategory } from '@/lib/vaultBackup/exportTypes';
import { importDecisionKey, type ImportComparison, type ImportDecision } from '@/lib/vaultBackup/importMerge';
import type {
  VaultImportAnalysis,
  VaultImportProgress,
  VaultImportReview,
  VaultImportTagPolicy,
} from '@/lib/vaultBackup/importTypes';
import type { VaultImportWorkerClient } from '@/lib/vaultBackup/importWorkerClient';
import { generationHeaders } from '@/lib/encryptionGeneration';
import { getSessionClientHeaders } from '@/lib/sessionClient';
import { trpcClient } from '@/lib/trpcClient';
import { ImportConflicts } from './ImportConflicts';
import s from './page.module.scss';

type Phase = 'choose' | 'analyzing' | 'review' | 'importing' | 'complete';

const CATEGORIES: Array<{ key: VaultExportCategory; label: string }> = [
  { key: 'notes', label: 'Notes' },
  { key: 'secrets', label: 'Secrets' },
  { key: 'seals', label: 'Seals' },
  { key: 'authenticators', label: 'Authenticator' },
];

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let amount = value / 1024;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index++;
  }
  return `${amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('WRONG_PASSWORD')) return 'That password did not open the archive. Check it and try again.';
  if (message.includes('VAULT_KEY_MISMATCH'))
    return 'This account uses a different encryption key. The archive’s encrypted items cannot be imported here.';
  if (message.includes('VAULT_ID_REQUIRED'))
    return 'Unlock Secrets in this account once so SigNote can confirm the archive uses the same encryption key, then try again.';
  if (message.includes('STORAGE_QUOTA'))
    return 'This import’s attachments don’t fit in this account’s storage. Free some space, or import fewer items.';
  if (message.includes('LIMIT') || message.includes('PAYLOAD_TOO_LARGE'))
    return 'The archive exceeds this SigNote deployment’s restore limits.';
  if (message.includes('INVALID_ARCHIVE'))
    return 'This file is damaged, incomplete, or not a supported SigNote vault archive.';
  if (message.includes('STORAGE_MISMATCH'))
    return 'An attachment did not verify after upload. Nothing was activated; try again.';
  if (message.includes('CANCELLED')) return 'Import cancelled. Nothing was added to your vault.';
  if (message.includes('DESTINATION_CHANGED') || message.includes('GENERATION_MISMATCH'))
    return 'Your vault changed after you reviewed this import. Nothing was activated — review it again.';
  if (message.includes('IMPORT_IN_PROGRESS'))
    return 'An unfinished import is still open for this account — from a tab that was closed, or another device. Discard it to start this one.';
  if (message.includes('CONFLICT'))
    return 'Another import or a key rotation is in progress for this account. Nothing was activated.';
  return 'The vault could not be imported. Nothing was activated.';
}

const unfinishedImport = (error: unknown) => error instanceof Error && error.message.includes('IMPORT_IN_PROGRESS');

/** Tells the server the page is going away mid-import. A tRPC call cannot
 * outlive the page, a keepalive fetch can; best effort, since the account
 * otherwise stays blocked until the operation expires. */
function cancelOnUnload(operationId: string) {
  void fetch('/api/trpc/vaultImport.cancel?batch=1', {
    method: 'POST',
    keepalive: true,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...getSessionClientHeaders(), ...generationHeaders() },
    body: JSON.stringify({ 0: { operationId } }),
  }).catch(() => undefined);
}

const staleDestination = (error: unknown) =>
  error instanceof Error && /DESTINATION_CHANGED|GENERATION_MISMATCH/.test(error.message);

type Outcome = { inserted: number; replaced: number; copied: number };

export function ImportVaultClient() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status } = useSession();
  const [phase, setPhase] = useState<Phase>('choose');
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [review, setReview] = useState<VaultImportReview | null>(null);
  const [comparison, setComparison] = useState<ImportComparison | null>(null);
  const [decisions, setDecisions] = useState<Map<string, ImportDecision>>(new Map());
  const [tagPolicy, setTagPolicy] = useState<VaultImportTagPolicy>('create');
  const [progress, setProgress] = useState<VaultImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canReviewAgain, setCanReviewAgain] = useState(false);
  const [blockedByUnfinished, setBlockedByUnfinished] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const worker = useRef<VaultImportWorkerClient | null>(null);
  const operationId = useRef<string | null>(null);
  const lastAnalysis = useRef<VaultImportAnalysis | null>(null);
  // Bumped by every reset, so a run the user abandoned can tell, when its
  // in-flight request settles, that the page has already moved on.
  const run = useRef(0);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/');
  }, [router, status]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (phase !== 'analyzing' && phase !== 'importing') return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [phase]);

  useEffect(() => {
    const leave = () => {
      if (operationId.current) cancelOnUnload(operationId.current);
      operationId.current = null;
    };
    window.addEventListener('pagehide', leave);
    return () => window.removeEventListener('pagehide', leave);
  }, []);

  useEffect(() => () => worker.current?.dispose(), []);

  const abandonOperation = async () => {
    if (operationId.current)
      await trpcClient.vaultImport.cancel.mutate({ operationId: operationId.current }).catch(() => undefined);
    operationId.current = null;
  };

  /** Back to the start. The archive is forgotten; the user picks it again. */
  const reset = async (message?: string) => {
    run.current++;
    worker.current?.cancel();
    worker.current?.dispose();
    worker.current = null;
    lastAnalysis.current = null;
    await abandonOperation();
    setReview(null);
    setComparison(null);
    setDecisions(new Map());
    setProgress(null);
    setCanReviewAgain(false);
    setPhase('choose');
    if (message) setError(message);
  };

  /** Server analysis plus the id comparison, against the Worker's parsed
   * archive. Runs on first inspection and again when the destination changed. */
  const compare = async (client: VaultImportWorkerClient, analysis: VaultImportAnalysis) => {
    const nextReview = await trpcClient.vaultImport.analyze.mutate(analysis);
    operationId.current = nextReview.operationId;
    const nextComparison = await client.compare(nextReview.operationId, nextReview.generation);
    setReview(nextReview);
    setComparison(nextComparison);
    setDecisions(new Map());
    setTagPolicy(nextReview.mode === 'merge' && nextReview.tagMatches > 0 ? 'reuse' : 'create');
    setPhase('review');
  };

  const analyze = async () => {
    if (!file || !password || phase !== 'choose') return;
    setError(null);
    setBlockedByUnfinished(false);
    setPhase('analyzing');
    try {
      const { VaultImportWorkerClient } = await import('@/lib/vaultBackup/importWorkerClient');
      const nextWorker = new VaultImportWorkerClient();
      worker.current = nextWorker;
      const analysis = await nextWorker.analyze(file, password);
      lastAnalysis.current = analysis;
      await compare(nextWorker, analysis);
    } catch (caught) {
      await reset(errorMessage(caught));
      setBlockedByUnfinished(unfinishedImport(caught));
    }
  };

  /** Clears the import left open elsewhere, then inspects this archive — the
   * file and password are still selected. */
  const discardUnfinished = async () => {
    setDiscarding(true);
    try {
      await trpcClient.vaultImport.discardUnfinished.mutate();
      setBlockedByUnfinished(false);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
      return;
    } finally {
      setDiscarding(false);
    }
    await analyze();
  };

  /** The Worker still holds the verified archive: compare it with the account
   * as it is now, without asking for the file and password again. */
  const reviewAgain = async () => {
    if (!worker.current || !lastAnalysis.current) return reset();
    setError(null);
    setCanReviewAgain(false);
    setPhase('analyzing');
    try {
      await abandonOperation();
      await compare(worker.current, lastAnalysis.current);
    } catch (caught) {
      await reset(errorMessage(caught));
    }
  };

  const startImport = async () => {
    if (!review || !worker.current || phase !== 'review') return;
    setError(null);
    setPhase('importing');
    const client = worker.current;
    const current = run.current;
    client.onProgress = setProgress;
    try {
      const plan = await client.plan(decisions, tagPolicy);
      // The server refuses the same plan; checking here names the numbers
      // and keeps the review, so the user can import fewer items instead.
      const after = review.storageUsedBytes + plan.expectedAttachmentBytes;
      if (after > review.storageLimitBytes) {
        setError(
          `This import adds ${formatBytes(plan.expectedAttachmentBytes)} of attachments, but this account already uses ${formatBytes(review.storageUsedBytes)} of its ${formatBytes(review.storageLimitBytes)}. Free some space, or keep more conflicts as they are.`,
        );
        setPhase('review');
        return;
      }
      await trpcClient.vaultImport.begin.mutate({ operationId: review.operationId, plan });
      if (run.current !== current) return;
      await client.stage(review.operationId, review.generation);
      if (run.current !== current) return;
      setProgress((current) =>
        current
          ? { ...current, stage: 'committing' }
          : { stage: 'committing', itemsProcessed: 0, itemCount: 1, bytesProcessed: 0, byteCount: 1 },
      );
      const result = await trpcClient.vaultImport.commit.mutate({ operationId: review.operationId });
      operationId.current = null;
      // Everything cached may predate the import: lists, tags, authenticators,
      // and the encryption profile a restore may just have installed.
      void queryClient.invalidateQueries();
      client.dispose();
      worker.current = null;
      lastAnalysis.current = null;
      setOutcome(
        Object.values(result.counts).reduce<Outcome>(
          (sum, counts) => ({
            inserted: sum.inserted + counts.insert,
            replaced: sum.replaced + counts.replace,
            copied: sum.copied + counts.copy,
          }),
          { inserted: 0, replaced: 0, copied: 0 },
        ),
      );
      setPassword('');
      setPhase('complete');
    } catch (caught) {
      // Cancelled meanwhile: the reset already said so and closed the operation.
      if (run.current !== current) return;
      if (staleDestination(caught) && worker.current && lastAnalysis.current) {
        // Keep the verified archive: the user reviews against the new state.
        await abandonOperation();
        setError(errorMessage(caught));
        setCanReviewAgain(true);
        setProgress(null);
        setPhase('choose');
        return;
      }
      await reset(errorMessage(caught));
    }
  };

  const summary = useMemo(() => {
    if (!comparison) return null;
    let replacing = 0;
    let copying = 0;
    for (const conflict of comparison.conflicts) {
      const decision = decisions.get(importDecisionKey(conflict.category, conflict.id)) ?? 'keep';
      if (decision === 'replace') replacing++;
      if (decision === 'copy') copying++;
    }
    const total = (field: 'new' | 'identical') =>
      CATEGORIES.reduce((sum, { key }) => sum + comparison.counts[key][field], 0);
    return { new: total('new'), identical: total('identical'), replacing, copying };
  }, [comparison, decisions]);

  const blockedCounts = useMemo(() => {
    const blocked = comparison?.blocked ?? [];
    const recentlyDeleted = blocked.filter((item) => item.reason === 'attachment-recently-deleted').length;
    return { recentlyDeleted, inUse: blocked.length - recentlyDeleted };
  }, [comparison]);

  if (status !== 'authenticated') return null;

  const active = phase === 'analyzing' || phase === 'importing';
  const merge = review?.mode === 'merge';
  const nothingToDo = summary !== null && summary.new + summary.replacing + summary.copying === 0;

  return (
    <main className={s.container}>
      <div className={s.content}>
        <header className={s.header}>
          <div className={s.eyebrow}>Data portability</div>
          <h1>Import a vault</h1>
          <p>
            Restore a password-encrypted <code>.snvault</code> archive into this account, or merge it into the vault
            already here. Decryption and validation happen in this browser; the archive password is never sent to
            SigNote.
          </p>
        </header>

        {phase === 'choose' && canReviewAgain && (
          <div className={s.actions}>
            <Button variant="ghost" onClick={() => void reset()}>
              Choose another file
            </Button>
            <Button onClick={() => void reviewAgain()}>
              <RefreshCw aria-hidden="true" /> Review again
            </Button>
          </div>
        )}

        {phase === 'choose' && !canReviewAgain && (
          <Card>
            <CardHeader>
              <CardTitle role="heading" aria-level={2}>
                Choose your archive
              </CardTitle>
            </CardHeader>
            <CardContent className={s.formBody}>
              <label className={s.fileField}>
                <span>SigNote vault archive</span>
                <Input
                  type="file"
                  accept=".snvault,application/vnd.signote.vault"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  aria-describedby="import-file-help"
                />
              </label>
              <p className={s.help} id="import-file-help">
                The selected file stays on this device. Only the records and attachments that change your vault are
                uploaded.
              </p>
              <label className={s.passwordField}>
                <span>Archive password</span>
                <span className={s.inputWrap}>
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-lg"
                    className={s.reveal}
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? 'Hide archive password' : 'Show archive password'}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                  </Button>
                </span>
              </label>
              <div className={s.actions}>
                <Link href="/profile">
                  <Button variant="ghost">Back to profile</Button>
                </Link>
                <Button onClick={() => void analyze()} disabled={!file || !password}>
                  <FileArchive aria-hidden="true" /> Inspect archive
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {phase === 'analyzing' && (
          <div className={s.progressPanel} aria-live="polite">
            <div className={s.progressTop}>
              <span>Verifying the archive and comparing it with this account…</span>
              <Loader2 className={s.spin} aria-hidden="true" />
            </div>
            <progress />
            <p>Only record ids are sent for the comparison; nothing is uploaded during inspection.</p>
          </div>
        )}

        {phase === 'review' && review && comparison && summary && (
          <>
            <Card>
              <CardHeader>
                <CardTitle role="heading" aria-level={2}>
                  {merge ? 'Review this merge' : 'Review this restore'}
                </CardTitle>
              </CardHeader>
              <CardContent className={s.reviewBody}>
                <div className={s.verified}>
                  <ShieldCheck aria-hidden="true" />
                  <span>Archive authentication, manifest, paths, sizes, relationships, and checksums passed.</span>
                </div>
                <dl className={s.summaryGrid}>
                  <div>
                    <dt>Created</dt>
                    <dd>{new Date(review.archiveCreatedAt).toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Attachments in archive</dt>
                    <dd>
                      {review.counts.attachments.toLocaleString()} · {formatBytes(review.attachmentBytes)}
                    </dd>
                  </div>
                  <div>
                    <dt>Encryption profile</dt>
                    <dd>
                      {review.installsEncryptionProfile
                        ? 'Install from archive'
                        : merge && review.selection.some((category) => category !== 'notes')
                          ? 'Same key as this account'
                          : 'Not included'}
                    </dd>
                  </div>
                  <div>
                    <dt>Destination</dt>
                    <dd>{merge ? 'Merge into this vault' : 'Empty account'}</dd>
                  </div>
                </dl>
                <table className={s.outcomeTable}>
                  <thead>
                    <tr>
                      <th scope="col">Category</th>
                      <th scope="col">New</th>
                      <th scope="col">Identical</th>
                      <th scope="col">Conflicts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CATEGORIES.filter(({ key }) => review.selection.includes(key)).map(({ key, label }) => (
                      <tr key={key}>
                        <th scope="row">{label}</th>
                        <td>{comparison.counts[key].new}</td>
                        <td>{comparison.counts[key].identical}</td>
                        <td>{comparison.counts[key].conflict}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {summary.identical > 0 && (
                  <p className={s.help}>Identical items are already here and are skipped automatically.</p>
                )}
              </CardContent>
            </Card>

            {comparison.conflicts.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle role="heading" aria-level={2}>
                    Resolve {comparison.conflicts.length} conflict{comparison.conflicts.length === 1 ? '' : 's'}
                  </CardTitle>
                </CardHeader>
                <CardContent className={s.reviewBody}>
                  <p className={s.help}>
                    These items exist in both places with different content. Nothing changes unless you choose — the
                    default keeps what this account has.
                  </p>
                  <ImportConflicts conflicts={comparison.conflicts} decisions={decisions} onChange={setDecisions} />
                </CardContent>
              </Card>
            )}

            {blockedCounts.inUse > 0 && (
              <div className={s.notice}>
                {blockedCounts.inUse} item{blockedCounts.inUse === 1 ? '' : 's'} can’t be imported: an attachment ID
                they use already belongs to a different file in this account. They are skipped.
              </div>
            )}
            {blockedCounts.recentlyDeleted > 0 && (
              <div className={s.notice}>
                {blockedCounts.recentlyDeleted} item{blockedCounts.recentlyDeleted === 1 ? '' : 's'} can’t be imported
                yet: they use an attachment that was deleted here recently, and the daily storage cleanup hasn’t
                released its ID. They are skipped — import this archive again tomorrow to bring them back.
              </div>
            )}

            {review.tagCount > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle role="heading" aria-level={2}>
                    Tags
                  </CardTitle>
                </CardHeader>
                <CardContent className={s.tagChoices}>
                  {merge && review.tagMatches > 0 && (
                    <label className={s.choice}>
                      <input
                        type="radio"
                        name="tag-policy"
                        checked={tagPolicy === 'reuse'}
                        onChange={() => setTagPolicy('reuse')}
                      />
                      <span>
                        <strong>Reuse existing tags only</strong>
                        <small>
                          {review.tagMatches} of {review.tagCount} archive tags already exist here and are applied; the
                          rest are dropped.
                        </small>
                      </span>
                    </label>
                  )}
                  <label className={s.choice}>
                    <input
                      type="radio"
                      name="tag-policy"
                      checked={tagPolicy === 'create'}
                      onChange={() => setTagPolicy('create')}
                    />
                    <span>
                      <strong>
                        {merge && review.tagMatches > 0
                          ? `Reuse and create ${review.tagCount - review.tagMatches} missing tags`
                          : `Create all ${review.tagCount} tags`}
                      </strong>
                      <small>
                        Existing tags keep their color. New ones get an automatic color you can change later.
                      </small>
                    </span>
                  </label>
                  <label className={s.choice}>
                    <input
                      type="radio"
                      name="tag-policy"
                      checked={tagPolicy === 'drop'}
                      onChange={() => setTagPolicy('drop')}
                    />
                    <span>
                      <strong>Import without tags</strong>
                      <small>Import items and attachments but drop all their tag assignments.</small>
                    </span>
                  </label>
                </CardContent>
              </Card>
            )}

            {summary.replacing > 0 && (
              <div className={s.error} role="note">
                {summary.replacing} item{summary.replacing === 1 ? '' : 's'} will be replaced. Their current version,
                history, tags and attachments here are discarded for the backup’s.
              </div>
            )}
            <div className={s.notice}>
              {nothingToDo
                ? 'Everything in this archive is already here or kept as it is. There is nothing to import.'
                : `${summary.new} new, ${summary.replacing} replaced, ${summary.copying} kept as copies. Nothing is live until the final step, which first checks that this account hasn’t changed since this review.`}
            </div>
            <div className={s.actions}>
              <Button variant="ghost" onClick={() => void reset()}>
                Choose another file
              </Button>
              <Button onClick={() => void startImport()} disabled={nothingToDo}>
                <ArchiveRestore aria-hidden="true" /> {merge ? 'Import into vault' : 'Restore vault'}
              </Button>
            </div>
          </>
        )}

        {phase === 'importing' && (
          <div className={s.progressPanel} aria-live="polite">
            <div className={s.progressTop}>
              <span>
                {progress?.stage === 'committing'
                  ? 'Activating the verified import…'
                  : progress?.stage === 'attachments'
                    ? 'Verifying attachments…'
                    : 'Staging validated records…'}
              </span>
              {progress && progress.stage !== 'committing' && (
                <strong>{Math.round((progress.itemsProcessed / Math.max(progress.itemCount, 1)) * 100)}%</strong>
              )}
            </div>
            <progress
              value={progress?.stage === 'committing' ? undefined : (progress?.itemsProcessed ?? undefined)}
              max={progress?.itemCount ?? 1}
            />
            {/* Once the commit is sent it may already have won: a cancel
                then could not honestly say nothing was added. */}
            {progress?.stage !== 'committing' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void reset('Import cancelled. Nothing was added to your vault.')}
              >
                <X aria-hidden="true" /> Cancel import
              </Button>
            )}
          </div>
        )}

        {phase === 'complete' && (
          <div className={s.success} role="status">
            <Check aria-hidden="true" />
            <div>
              <strong>{merge ? 'Vault merged' : 'Vault restored'}</strong>
              <p>
                {outcome &&
                  `${outcome.inserted} added, ${outcome.replaced} replaced, ${outcome.copied} kept as copies. `}
                {review?.installsEncryptionProfile
                  ? 'Open Secrets and unlock with the original vault passphrase from the source account.'
                  : 'Encrypted items open with this vault’s passphrase, as before.'}
              </p>
              <Link href="/secrets">
                <Button size="sm">Open Secrets</Button>
              </Link>
            </div>
          </div>
        )}

        {error && (
          <div className={s.error} role="alert">
            {error}
            {blockedByUnfinished && phase === 'choose' && (
              <Button
                variant="outline"
                size="sm"
                className={s.errorAction}
                onClick={() => void discardUnfinished()}
                disabled={discarding}
              >
                {discarding && <Loader2 className={s.spin} aria-hidden="true" />}
                Discard it and continue
              </Button>
            )}
          </div>
        )}
        {active && <span className="sr-only">Import in progress</span>}
      </div>
    </main>
  );
}
