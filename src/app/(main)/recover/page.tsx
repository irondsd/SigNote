'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { CheckCircle, KeyRound, ShieldCheck, Upload } from 'lucide-react';
import { TRPCClientError } from '@trpc/client';
import posthog from 'posthog-js';
import { Button } from '@/components/ui/button';
import { PassphrasePairFields } from '@/components/PassphrasePairFields/PassphrasePairFields';
import { SecurityPageCard } from '@/components/SecurityPageCard/SecurityPageCard';
import { trpcClient } from '@/lib/trpcClient';
import { useProfile } from '@/hooks/useProfile';
import {
  createKeyCheck,
  deriveDeviceShare,
  deriveVaultKeyId,
  fromBase64,
  generateSalt,
  importMEK,
  loadDeviceShare,
  saveDeviceShare,
  verifyKeyCheck,
  xor32,
} from '@/lib/crypto';
import {
  decodeDeviceShare,
  parseBackupText,
  ROTATION_RECOVERY_BACKUP_VERSION,
  type RecoveryBackup,
} from '@/lib/recoveryBackup';
import { MAX_PASSPHRASE_LENGTH, MIN_PASSPHRASE_LENGTH } from '@/config/constants';
import { cn } from '@/utils/cn';
import s from './page.module.scss';

type Material = {
  serverShare: string;
  salt: string;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; length: number };
  keyCheck: { alg: 'A256GCM'; iv: string; ciphertext: string };
  vaultKeyId: string | null;
};

type Screen = 'upload' | 'passphrase' | 'success';

export default function RecoverPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { data: profile, isLoading: profileLoading } = useProfile();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/');
  }, [status, router]);

  useEffect(() => {
    if (!profileLoading && profile && !profile.hasEncryptionProfile) router.replace('/secrets');
  }, [profileLoading, profile, router]);

  useEffect(() => {
    if (status === 'authenticated' && loadDeviceShare()) {
      router.replace('/change-passphrase');
    }
  }, [status, router]);

  const [screen, setScreen] = useState<Screen>('upload');
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const mekBytesRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const materialRef = useRef<Material | null>(null);

  const [newPassphrase, setNewPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (status !== 'authenticated') return null;
  const userId = session?.user?.id;

  const handleFile = async (file: File) => {
    setUploadError('');
    setFileName(file.name);
    setVerifying(true);
    mekBytesRef.current = null;

    try {
      const text = await file.text();
      const result = parseBackupText(text);
      if (!result.ok) {
        switch (result.reason) {
          case 'not-json':
          case 'wrong-type':
          case 'malformed':
            setUploadError("This doesn't look like a SigNote recovery file.");
            break;
          case 'unsupported-version':
            setUploadError('This recovery file was made by a newer version of SigNote. Please update and try again.');
            break;
        }
        return;
      }

      const backup: RecoveryBackup = result.backup;
      if (backup.userId !== userId) {
        setUploadError('This recovery file is for a different account.');
        return;
      }

      let material: Material;
      try {
        material = (await trpcClient.encryption.material.query()) as unknown as Material;
      } catch {
        setUploadError('Failed to load encryption profile. Please try again.');
        return;
      }
      materialRef.current = material;

      const deviceShare = decodeDeviceShare(backup);
      const serverShareBytes = fromBase64(material.serverShare);
      const mekBytes = xor32(deviceShare, serverShareBytes);
      const candidate = await importMEK(mekBytes);
      const valid = await verifyKeyCheck(candidate, material.keyCheck);

      if (!valid) {
        // A v2 file is the recovery file for a *pending* rotation, so it only
        // ever unlocks the generation that rotation was going to activate. If it
        // does not match, that rotation was cancelled or has not finished — a
        // different situation from a v1 file that predates a passphrase change
        // or a completed rotation, and one that reads as alarming if the two
        // are reported with the same words.
        setUploadError(
          backup.version === ROTATION_RECOVERY_BACKUP_VERSION
            ? 'This file was saved for a key change that was never completed, so it does not unlock your vault. Use the recovery file you had before that key change.'
            : 'This file appears valid but does not match your current encryption profile. It may have been made before a passphrase or key change.',
        );
        return;
      }

      mekBytesRef.current = mekBytes;
      setScreen('passphrase');
    } catch {
      setUploadError("This doesn't look like a SigNote recovery file.");
    } finally {
      setVerifying(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  };

  const canSubmit =
    newPassphrase.length >= MIN_PASSPHRASE_LENGTH &&
    newPassphrase.length <= MAX_PASSPHRASE_LENGTH &&
    newPassphrase === confirm &&
    !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mekBytesRef.current || !materialRef.current) {
      setSubmitError('Recovery file not validated.');
      return;
    }
    if (newPassphrase.length < MIN_PASSPHRASE_LENGTH)
      return setSubmitError(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
    if (newPassphrase.length > MAX_PASSPHRASE_LENGTH)
      return setSubmitError(`Passphrase must be at most ${MAX_PASSPHRASE_LENGTH} characters.`);
    if (newPassphrase !== confirm) return setSubmitError('Passphrases do not match.');

    setSubmitError('');
    setSubmitting(true);
    try {
      const mekBytes = mekBytesRef.current;
      const { kdf } = materialRef.current;
      const newSalt = generateSalt();
      const newDeviceShare = await deriveDeviceShare(newPassphrase, newSalt, kdf);
      const newServerShareBytes = xor32(mekBytes, newDeviceShare);
      const newServerShareB64 = btoa(String.fromCharCode(...newServerShareBytes));

      const mek = await importMEK(mekBytes);
      const newKeyCheck = await createKeyCheck(mek);
      const vaultKeyId = await deriveVaultKeyId(mek);

      try {
        await trpcClient.encryption.update.mutate({
          serverShare: newServerShareB64,
          salt: newSalt,
          keyCheck: newKeyCheck,
          vaultKeyId,
        });
      } catch (e) {
        if (e instanceof TRPCClientError) {
          throw new Error(e.message || 'Failed to update encryption profile.');
        }
        throw e;
      }

      saveDeviceShare(newDeviceShare);
      posthog.capture('recovery_completed');
      setScreen('success');
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to update encryption profile.');
      setSubmitting(false);
    }
  };

  if (screen === 'success') {
    return (
      <SecurityPageCard icon={<CheckCircle size={48} strokeWidth={1.3} />} title="Success" size="wide" tone="success">
        <p className={s.successText}>
          Your encryption profile has been recovered. You can now access your <Link href="/secrets">Secrets</Link> or{' '}
          <Link href="/seals">Seals</Link>.
        </p>
      </SecurityPageCard>
    );
  }

  if (screen === 'passphrase') {
    return (
      <SecurityPageCard icon={<KeyRound size={40} strokeWidth={1.3} />} title="Set a new passphrase" size="wide">
        <p className={s.intro}>
          Recovery file verified. Choose a new passphrase to protect your encryption profile from now on.
        </p>

        <form className={s.form} onSubmit={handleSubmit}>
          <input
            type="text"
            autoComplete="username"
            value={session?.user?.name ?? ''}
            readOnly
            aria-hidden="true"
            style={{ display: 'none' }}
          />

          <PassphrasePairFields
            mode="replace"
            newId="rec-new"
            confirmationId="rec-confirm"
            value={newPassphrase}
            confirmation={confirm}
            onValueChange={setNewPassphrase}
            onConfirmationChange={setConfirm}
            disabled={submitting}
            autoFocus
          />

          {submitError && <p className={s.error}>{submitError}</p>}

          <Button type="submit" disabled={!canSubmit} className={s.submitBtn}>
            {submitting ? 'Recovering…' : 'Recover access'}
          </Button>
        </form>
      </SecurityPageCard>
    );
  }

  return (
    <SecurityPageCard icon={<ShieldCheck size={40} strokeWidth={1.3} />} title="Recover access" size="wide">
      <p className={s.intro}>Upload your recovery file to set a new passphrase and regain access to your data.</p>

      <label
        className={cn(s.dropzone, dragActive && s.dropzoneActive)}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
      >
        <Upload size={28} strokeWidth={1.4} />
        {fileName ? (
          <span className={s.fileName}>{fileName}</span>
        ) : (
          <span className={s.dropzoneText}>Drop your recovery file here or click to choose</span>
        )}
        <span className={s.dropzoneHint}>{verifying ? 'Verifying…' : 'JSON file from a previous backup'}</span>
        <input type="file" accept="application/json,.json" onChange={onChange} style={{ display: 'none' }} />
      </label>

      {uploadError && <p className={s.error}>{uploadError}</p>}

      <div className={s.divider} />

      <div className={s.crosslinks}>
        <p>
          Don&apos;t have a backup? Unfortunately, end-to-end encryption means we cannot recover your data without it.
          You can <Link href="/erase-encryption">erase your encryption profile</Link> to start over (this deletes all
          secrets and seals).
        </p>
        <p>
          <Link href="/profile">← Back to profile</Link>
        </p>
      </div>
    </SecurityPageCard>
  );
}
