'use client';

import { useEffect, useId, useState } from 'react';
import { useSession } from 'next-auth/react';
import { AlertTriangle, Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MAX_PASSPHRASE_LENGTH, MIN_PASSPHRASE_LENGTH } from '@/config/constants';
import { useEncryption } from '@/contexts/EncryptionContext';
import { useSecurityPreferences } from '@/hooks/useSecurityPreferences';
import { trpcClient } from '@/lib/trpcClient';
import { acquireResumableVaultKey, acquireVaultKeyWithPassphrase, createVaultProfile } from '@/lib/vaultKey';

type Promote = (mek: CryptoKey, onProgress: (message: string) => void) => Promise<unknown>;
type CommonProps = { onCancel: () => void; onDone: () => void; onPromote: Promote };

type ProfileResponse = { exists: boolean };

function PassphraseField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  disabled,
  autoFocus,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  disabled: boolean;
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="grid gap-1.5 text-left">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          autoFocus={autoFocus}
          className="pr-10"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute top-0.5 right-0.5 text-muted-foreground hover:bg-transparent"
          onClick={() => setVisible((current) => !current)}
          disabled={disabled}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        >
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </Button>
      </div>
    </div>
  );
}

function DialogFrame({
  title,
  description,
  icon,
  busy,
  progress,
  error,
  submitLabel,
  submitDisabled,
  onCancel,
  onSubmit,
  children,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  busy: boolean;
  progress: string;
  error: string;
  submitLabel: string;
  submitDisabled?: boolean;
  onCancel: () => void;
  onSubmit: (event: React.FormEvent) => void;
  children?: React.ReactNode;
}) {
  return (
    <AlertDialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <AlertDialogContent
        className="z-[221] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-md"
        overlayClassName="z-[220] bg-black/25"
        onEscapeKeyDown={(event) => busy && event.preventDefault()}
      >
        <form onSubmit={onSubmit} className="contents">
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-primary/10 text-primary" aria-hidden="true">
              {icon}
            </AlertDialogMedia>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>

          {children}

          {busy && (
            <div className="flex items-center gap-3 rounded-lg bg-muted px-3 py-2.5 text-sm" role="status">
              <span className="size-4 animate-spin rounded-full border-2 border-primary/25 border-t-primary motion-reduce:animate-none" />
              <span>{progress}</span>
            </div>
          )}
          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel type="button" onClick={onCancel} disabled={busy}>
              Cancel
            </AlertDialogCancel>
            <Button type="submit" disabled={busy || submitDisabled}>
              {busy ? 'Moving…' : submitLabel}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function NotePromotionDialog({ onCancel, onDone, onPromote }: CommonProps) {
  const { data: session } = useSession();
  const { data: security } = useSecurityPreferences();
  const passphraseId = useId();
  const confirmId = useId();
  const [profileExists, setProfileExists] = useState<boolean | null>(null);
  const [resumableKey, setResumableKey] = useState<CryptoKey | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('Checking vault…');
  const [error, setError] = useState('');

  const userId = session?.user?.id;

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const profile = (await trpcClient.encryption.profile.query()) as ProfileResponse;
        if (!active) return;
        if (profile.exists) {
          const key = await acquireResumableVaultKey({ userId, allowed: security?.cacheServerShare });
          if (active) {
            setResumableKey(key);
            setProfileExists(true);
          }
        } else {
          setProfileExists(false);
        }
      } catch {
        if (active) setError('Could not check your encrypted-notes setup. Please try again.');
      }
    })();
    return () => {
      active = false;
    };
  }, [security?.cacheServerShare, userId]);

  const validateSetup = () => {
    if (passphrase.length < MIN_PASSPHRASE_LENGTH)
      return `Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`;
    if (passphrase.length > MAX_PASSPHRASE_LENGTH)
      return `Passphrase must be at most ${MAX_PASSPHRASE_LENGTH} characters.`;
    if (passphrase !== confirm) return 'Passphrases do not match.';
    return '';
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (profileExists === null) return;
    if (!resumableKey && !passphrase) {
      setError('Passphrase is required.');
      return;
    }
    if (!profileExists) {
      const validation = validateSetup();
      if (validation) {
        setError(validation);
        return;
      }
    }

    setBusy(true);
    setError('');
    try {
      setProgress(profileExists ? 'Unlocking for this move…' : 'Creating encryption keys…');
      const key = resumableKey
        ? resumableKey
        : profileExists
          ? (
              await acquireVaultKeyWithPassphrase(passphrase, {
                userId,
                allowed: security?.cacheServerShare,
              })
            ).mek
          : (await createVaultProfile(passphrase)).mek;
      await onPromote(key, setProgress);
      onDone();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '';
      setError(
        message === 'Incorrect passphrase'
          ? 'Incorrect passphrase. Please try again.'
          : message || 'Could not move this note. Nothing was changed.',
      );
      setBusy(false);
    }
  };

  const needsPassphrase = profileExists === true && !resumableKey;
  return (
    <DialogFrame
      title="Move note to Secrets?"
      description="Its content, attachments, and version history will be encrypted. This move cannot be undone."
      icon={<LockKeyhole />}
      busy={busy}
      progress={progress}
      error={error}
      submitLabel="Move to Secrets"
      submitDisabled={profileExists === null}
      onCancel={onCancel}
      onSubmit={handleSubmit}
    >
      {profileExists === null ? (
        <div
          className="h-16 animate-pulse rounded-lg bg-muted motion-reduce:animate-none"
          aria-label="Checking encryption setup"
        />
      ) : profileExists === false ? (
        <div className="grid gap-4">
          <div className="flex gap-2.5 rounded-lg border border-primary/20 bg-primary/8 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <p>
              First, create a vault passphrase. It is never stored and encrypted notes cannot be recovered if you forget
              it.
            </p>
          </div>
          <PassphraseField
            id={passphraseId}
            label="New passphrase"
            value={passphrase}
            onChange={setPassphrase}
            autoComplete="new-password"
            disabled={busy}
            autoFocus
          />
          <PassphraseField
            id={confirmId}
            label="Confirm passphrase"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            disabled={busy}
          />
        </div>
      ) : needsPassphrase ? (
        <div className="grid gap-3">
          <input
            type="text"
            autoComplete="username"
            value={session?.user?.name ?? ''}
            readOnly
            aria-hidden="true"
            className="hidden"
          />
          <p className="text-sm text-muted-foreground">
            Enter your vault passphrase for this move. The Notes page will remain outside the vault.
          </p>
          <PassphraseField
            id={passphraseId}
            label="Vault passphrase"
            value={passphrase}
            onChange={setPassphrase}
            autoComplete="current-password"
            disabled={busy}
            autoFocus
          />
        </div>
      ) : (
        <div className="flex gap-2.5 rounded-lg bg-primary/8 p-3 text-sm">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <p>Your active vault session can authorize this move. No passphrase is needed.</p>
        </div>
      )}
    </DialogFrame>
  );
}

export function SecretPromotionDialog({ onCancel, onDone, onPromote }: CommonProps) {
  const { mek, lockType, rehydrate, unlock } = useEncryption();
  const passphraseId = useId();
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('Preparing secret…');
  const [error, setError] = useState('');
  const [forcePassphrase, setForcePassphrase] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!mek && (lockType !== 'soft' || forcePassphrase) && !passphrase) {
      setError('Passphrase is required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      let key = mek;
      if (!key && lockType === 'soft' && !forcePassphrase) {
        try {
          key = await rehydrate();
        } catch {
          setForcePassphrase(true);
          if (!passphrase) {
            setError('Your vault session expired. Enter your passphrase to continue.');
            setBusy(false);
            return;
          }
        }
      }
      if (!key) key = await unlock(passphrase);
      await onPromote(key, setProgress);
      onDone();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '';
      setError(
        message === 'Incorrect passphrase'
          ? 'Incorrect passphrase. Please try again.'
          : message || 'Could not move this secret. Nothing was changed.',
      );
      setBusy(false);
    }
  };

  return (
    <DialogFrame
      title="Move secret to Seals?"
      description="Its content and full history will be re-encrypted with a unique key. This move cannot be undone."
      icon={<ShieldCheck />}
      busy={busy}
      progress={progress}
      error={error}
      submitLabel="Move to Seals"
      onCancel={onCancel}
      onSubmit={handleSubmit}
    >
      {!mek && (lockType !== 'soft' || forcePassphrase) && (
        <PassphraseField
          id={passphraseId}
          label="Vault passphrase"
          value={passphrase}
          onChange={setPassphrase}
          autoComplete="current-password"
          disabled={busy}
          autoFocus
        />
      )}
      {mek && (
        <div className="flex gap-2.5 rounded-lg bg-primary/8 p-3 text-sm">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <p>Your unlocked vault is ready. The move will preserve metadata, tags, attachments, and history.</p>
        </div>
      )}
    </DialogFrame>
  );
}
