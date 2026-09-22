'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Download, Eye, EyeOff, RefreshCw, ShieldAlert, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type {
  VaultExportCategory,
  VaultExportProgress,
  VaultExportSelection,
  VaultExportSummary,
} from '@/lib/vaultBackup/exportTypes';
import { prepareVaultDownload, type PreparedVaultDownload } from '@/lib/vaultBackup/downloadSink';
import { createVaultExportWorker, type VaultExportWorker } from '@/lib/vaultBackup/exportWorkerClient';
import { trpcClient } from '@/lib/trpcClient';
import s from './page.module.scss';

const CATEGORIES: { key: VaultExportCategory; label: string; description: string }[] = [
  { key: 'notes', label: 'Notes', description: 'Plaintext notes, history, tags and attachments' },
  { key: 'secrets', label: 'Secrets', description: 'Encrypted content, history, tags and attachments' },
  { key: 'seals', label: 'Seals', description: 'Wrapped note keys, encrypted content and attachments' },
  { key: 'authenticators', label: 'Authenticator', description: 'Synced credentials and retained tombstones' },
];

const initialSelection: VaultExportSelection = {
  notes: true,
  secrets: true,
  seals: true,
  authenticators: true,
};

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let amount = value / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && amount >= 1024; index++) {
    amount /= 1024;
    unit = units[index];
  }
  return `${amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)} ${unit}`;
}

function generatedPassword(): string {
  const random = crypto.getRandomValues(new Uint8Array(24));
  let binary = '';
  for (const value of random) binary += String.fromCharCode(value);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function exportErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('VAULT_CHANGED_OR_STREAM_INTERRUPTED'))
    return 'Your vault changed or the connection was interrupted while exporting. No usable partial backup was kept; start again.';
  if (message.includes('VAULT_CHANGED') || message.includes('GENERATION_MISMATCH'))
    return 'Your vault changed while it was being exported. No usable partial backup was kept; start again.';
  if (message.includes('CANCELLED') || (error instanceof DOMException && error.name === 'AbortError'))
    return 'Export cancelled.';
  if (message.includes('STREAMING_DOWNLOAD_UNAVAILABLE') || message.includes('EXPORT_TOO_LARGE_FOR_BROWSER'))
    return 'This browser cannot safely save an export of this size. Use a browser with “Save file” support or install SigNote as a PWA.';
  if (message.includes('VAULT_ID_REQUIRED'))
    return 'Unlock Secrets once to prepare this vault for portable backups, then retry.';
  if (message.includes('ROTATION_IN_PROGRESS'))
    return 'Encrypted data cannot be exported while key rotation is in progress.';
  if (message.includes('DISABLED') || message.includes('FORBIDDEN')) return 'Vault export is currently unavailable.';
  if (message.includes('LIMIT'))
    return 'This vault holds more items or attachments than a single archive can restore. Export the categories separately.';
  return 'The export could not be completed. No usable partial backup was kept.';
}

/** When saving fails, the sink has seen only a broken stream; the Worker
 * reports why it broke (a changed vault, say). Prefer its reason when it
 * arrives promptly. */
async function workerCause(worker: VaultExportWorker | null, fallback: unknown): Promise<unknown> {
  if (!worker) return fallback;
  return Promise.race([
    worker.completed.then(
      () => fallback,
      (error: unknown) => error,
    ),
    new Promise((resolve) => setTimeout(() => resolve(fallback), 1_000)),
  ]);
}

type Success = {
  bytes: number;
  seconds: number;
  selection: VaultExportSelection;
  counts: VaultExportSummary['categories'];
};

export function ExportVaultClient() {
  const router = useRouter();
  const { status } = useSession();
  const [summary, setSummary] = useState<VaultExportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selection, setSelection] = useState(initialSelection);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [generated, setGenerated] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [active, setActive] = useState(false);
  const [progress, setProgress] = useState<VaultExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<Success | null>(null);
  const operationId = useRef<string | null>(null);
  const worker = useRef<VaultExportWorker | null>(null);
  const sink = useRef<PreparedVaultDownload | null>(null);
  const abort = useRef<AbortController | null>(null);
  const selectionInitialized = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const next = await trpcClient.vaultExport.summary.query();
      setSummary(next);
      if (!selectionInitialized.current) {
        selectionInitialized.current = true;
        const hasAny = CATEGORIES.some(({ key }) => next.categories[key].count > 0);
        setSelection({
          notes: next.categories.notes.count > 0 || !hasAny,
          secrets: next.categories.secrets.count > 0,
          seals: next.categories.seals.count > 0,
          authenticators: next.categories.authenticators.count > 0,
        });
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/');
    if (status === 'authenticated') void refresh();
  }, [refresh, router, status]);

  useEffect(() => {
    const onFocus = () => {
      if (!active) void refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [active, refresh]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!active) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);

  const encryptedSelected = selection.secrets || selection.seals || selection.authenticators;
  const selected = CATEGORIES.filter(({ key }) => selection[key]);
  const estimatedBytes = useMemo(
    () => selected.reduce((total, { key }) => total + (summary?.categories[key].estimatedBytes ?? 0), 0),
    [selected, summary],
  );
  const prerequisite = !summary
    ? null
    : !summary.available
      ? 'disabled'
      : encryptedSelected && !summary.profileExists
        ? 'profile'
        : encryptedSelected && !summary.vaultKeyId
          ? 'vault-id'
          : encryptedSelected && summary.rotationInProgress
            ? 'rotation'
            : null;
  const validPassword = password.length >= 12 && password === confirmation;
  const canStart = !!summary && selected.length > 0 && !prerequisite && validPassword && !active;

  const cancel = useCallback(async () => {
    abort.current?.abort();
    worker.current?.cancel();
    await sink.current?.abort();
    const id = operationId.current;
    if (id) void trpcClient.vaultExport.cancel.mutate({ operationId: id }).catch(() => undefined);
    setActive(false);
    setProgress(null);
    setError('Export cancelled.');
  }, []);

  const start = async () => {
    if (!canStart || !summary) return;
    setError(null);
    setSuccess(null);
    setActive(true);
    const runAbort = new AbortController();
    abort.current = runAbort;
    const predictedName = `signote-vault-${new Date().toISOString().slice(0, 10)}.snvault`;
    const started = performance.now();
    try {
      // This call stays at the start of the click handler so the native file
      // picker retains the browser's user-activation permission.
      sink.current = await prepareVaultDownload(predictedName, estimatedBytes);
      if (runAbort.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const plan = await trpcClient.vaultExport.begin.mutate(selection);
      operationId.current = plan.operationId;
      if (runAbort.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      worker.current = createVaultExportWorker(plan, password, setProgress);
      const stream = await worker.current.stream;
      const [saved, result] = await Promise.all([sink.current.save(stream, runAbort.signal), worker.current.completed]);
      if (runAbort.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      await trpcClient.vaultExport.finish.mutate({
        operationId: plan.operationId,
        manifestDigest: result.manifestDigest,
      });
      setSuccess({
        bytes: saved.bytesWritten,
        seconds: (performance.now() - started) / 1000,
        selection: { ...selection },
        counts: summary.categories,
      });
      setPassword('');
      setConfirmation('');
      setGenerated(null);
    } catch (caught) {
      const message = exportErrorMessage(await workerCause(worker.current, caught));
      worker.current?.cancel();
      if (message !== 'Export cancelled.') setError(message);
      const id = operationId.current;
      if (id) void trpcClient.vaultExport.cancel.mutate({ operationId: id }).catch(() => undefined);
      await sink.current?.abort();
    } finally {
      setActive(false);
      setProgress(null);
      operationId.current = null;
      worker.current = null;
      sink.current = null;
      abort.current = null;
    }
  };

  if (status !== 'authenticated') return null;

  return (
    <main className={s.container}>
      <div className={s.content}>
        <header className={s.header}>
          <div className={s.eyebrow}>Data portability</div>
          <h1>Export your vault</h1>
          <p>
            Create a portable, password-encrypted copy that can be restored on another SigNote deployment. Your archive
            password is processed only in this browser.
          </p>
        </header>

        <Card>
          <CardHeader className={s.cardHeader}>
            <CardTitle role="heading" aria-level={2}>
              Choose what to include
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading || active}>
              <RefreshCw aria-hidden="true" className={loading ? s.spin : undefined} /> Refresh
            </Button>
          </CardHeader>
          <CardContent className={s.categoryList} aria-busy={loading}>
            {loadError ? (
              <div className={s.inlineError}>Could not load your vault summary. Try refreshing.</div>
            ) : (
              CATEGORIES.map(({ key, label, description }) => {
                const details = summary?.categories[key];
                return (
                  <label className={s.categoryRow} key={key}>
                    <span className={s.categoryText}>
                      <span className={s.categoryTitle}>{label}</span>
                      <span>{description}</span>
                    </span>
                    <span className={s.categoryMeta}>
                      {loading ? 'Loading…' : `${details?.count ?? 0} · ${formatBytes(details?.estimatedBytes ?? 0)}`}
                    </span>
                    <Switch
                      checked={selection[key]}
                      onCheckedChange={(checked) => setSelection((current) => ({ ...current, [key]: checked }))}
                      disabled={active || loading}
                      aria-label={`Include ${label}`}
                    />
                  </label>
                );
              })
            )}
            <div className={s.totalRow}>
              <span>Estimated source size</span>
              <strong>{formatBytes(estimatedBytes)}</strong>
            </div>
          </CardContent>
        </Card>

        {prerequisite && (
          <div className={s.notice} role="status">
            <ShieldAlert aria-hidden="true" />
            <div>
              {prerequisite === 'disabled' && <p>Portable vault export is currently unavailable.</p>}
              {prerequisite === 'profile' && (
                <p>Set up vault encryption before including Secrets, Seals or Authenticator.</p>
              )}
              {prerequisite === 'vault-id' && (
                <p>
                  Unlock your vault once to create its portable identity.{' '}
                  <Link href="/secrets" target="_blank" rel="noreferrer">
                    Open Secrets to unlock
                  </Link>
                  , then return and refresh.
                </p>
              )}
              {prerequisite === 'rotation' && <p>Finish or cancel key rotation before exporting encrypted data.</p>}
            </div>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              Protect the archive
            </CardTitle>
          </CardHeader>
          <CardContent className={s.passwordBody}>
            <p className={s.help} id="archive-password-help">
              This is a new password for the backup file—not your vault passphrase. SigNote cannot recover it. You will
              still need your original vault passphrase after restoration.
            </p>
            <div className={s.passwordGrid}>
              <label>
                <span>Archive password</span>
                <div className={s.inputWrap}>
                  <Input
                    className={s.passwordInput}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setGenerated(null);
                    }}
                    disabled={active}
                    aria-describedby={`archive-password-help${password.length > 0 && password.length < 12 ? ' password-error' : ''}`}
                    aria-invalid={password.length > 0 && password.length < 12}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-lg"
                    className={s.reveal}
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={showPassword ? 'Hide archive passwords' : 'Show archive passwords'}
                    aria-pressed={showPassword}
                    disabled={active}
                  >
                    {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                  </Button>
                </div>
              </label>
              <label>
                <span>Confirm password</span>
                <Input
                  className={s.passwordInput}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  disabled={active}
                  aria-describedby={
                    confirmation.length > 0 && confirmation !== password ? 'confirmation-error' : undefined
                  }
                  aria-invalid={confirmation.length > 0 && confirmation !== password}
                />
              </label>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={s.generateButton}
              disabled={active}
              onClick={() => {
                const value = generatedPassword();
                setPassword(value);
                setConfirmation(value);
                setGenerated(value);
              }}
            >
              <Sparkles aria-hidden="true" /> Generate a strong password
            </Button>
            {generated && (
              <div className={s.generated}>
                <code>{generated}</code>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Copy generated password"
                  onClick={() =>
                    void navigator.clipboard.writeText(generated).then(() => toast.success('Password copied'))
                  }
                >
                  <Copy aria-hidden="true" />
                </Button>
              </div>
            )}
            {password.length > 0 && password.length < 12 && (
              <p className={s.validation} id="password-error">
                Use at least 12 characters.
              </p>
            )}
            {confirmation.length > 0 && confirmation !== password && (
              <p className={s.validation} id="confirmation-error">
                Passwords do not match.
              </p>
            )}
          </CardContent>
        </Card>

        {active && !progress && (
          <div className={s.progressPanel} aria-live="polite">
            <div className={s.progressTop}>
              <span>Preparing a consistent snapshot…</span>
            </div>
            <progress />
          </div>
        )}
        {active && progress && (
          <div className={s.progressPanel} aria-live="polite">
            <div className={s.progressTop}>
              <span>Exporting {progress.category === 'authenticators' ? 'Authenticator' : progress.category}…</span>
              <strong>{Math.round((progress.sourceBytes / Math.max(progress.sourceTotalBytes, 1)) * 100)}%</strong>
            </div>
            <progress value={progress.sourceBytes} max={Math.max(progress.sourceTotalBytes, 1)} />
            <span>{formatBytes(progress.sourceBytes)} read and encrypted</span>
          </div>
        )}

        {error && (
          <div className={s.inlineError} role="alert">
            {error}
          </div>
        )}
        {success && (
          <div className={s.success} role="status">
            <Check aria-hidden="true" />
            <div>
              <strong>Encrypted vault downloaded</strong>
              <p>
                {formatBytes(success.bytes)} · {success.seconds.toFixed(1)} seconds ·{' '}
                {CATEGORIES.filter(({ key }) => success.selection[key])
                  .map(({ key, label }) => `${success.counts[key].count} ${label}`)
                  .join(', ')}
              </p>
              <p>Keep the archive password somewhere separate from the file. It cannot be recovered.</p>
            </div>
          </div>
        )}

        <div className={s.actions}>
          <Button variant="ghost" onClick={() => router.push('/profile')} disabled={active}>
            Back to profile
          </Button>
          {active ? (
            <Button variant="destructive" onClick={() => void cancel()}>
              <X aria-hidden="true" /> Cancel export
            </Button>
          ) : (
            <Button onClick={() => void start()} disabled={!canStart} data-testid="start-vault-export">
              <Download aria-hidden="true" /> Create encrypted export
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}
