'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { CheckCircle, Eye, EyeOff, KeyRound, ShieldCheck, Upload } from 'lucide-react';
import { HTTPError } from 'ky';
import posthog from 'posthog-js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useProfile } from '@/hooks/useProfile';
import {
  createKeyCheck,
  deriveDeviceShare,
  fromBase64,
  generateSalt,
  importMEK,
  loadDeviceShare,
  saveDeviceShare,
  verifyKeyCheck,
  xor32,
} from '@/lib/crypto';
import { decodeDeviceShare, parseBackupText, type RecoveryBackup } from '@/lib/recoveryBackup';
import { MAX_PASSPHRASE_LENGTH, MIN_PASSPHRASE_LENGTH } from '@/config/constants';
import { cn } from '@/utils/cn';
import s from './page.module.scss';

type Material = {
  serverShare: string;
  salt: string;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; length: number };
  keyCheck: { alg: 'A256GCM'; iv: string; ciphertext: string };
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
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
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
        material = await api.get('/api/encryption/material').json<Material>();
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
        setUploadError(
          'This file appears valid but does not match your current encryption profile. It may have been made before a passphrase change.',
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

      try {
        await api.patch('/api/encryption/profile', {
          json: { serverShare: newServerShareB64, salt: newSalt, keyCheck: newKeyCheck },
        });
      } catch (e) {
        if (e instanceof HTTPError) {
          const body = await e.response.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error || 'Failed to update encryption profile.');
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
      <div className={s.container}>
        <div className={s.card}>
          <div className={s.successIcon}>
            <CheckCircle size={48} strokeWidth={1.3} />
          </div>
          <h2 className={s.heading}>Success</h2>
          <p className={s.successText}>
            Your encryption profile has been recovered. You can now access your <Link href="/secrets">Secrets</Link> or{' '}
            <Link href="/seals">Seals</Link>.
          </p>
        </div>
      </div>
    );
  }

  if (screen === 'passphrase') {
    return (
      <div className={s.container}>
        <div className={s.card}>
          <div className={s.iconWrap}>
            <KeyRound size={40} strokeWidth={1.3} />
          </div>
          <h2 className={s.heading}>Set a new passphrase</h2>
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

            <div className={s.field}>
              <label className={s.label} htmlFor="rec-new">
                New passphrase
              </label>
              <div className={s.inputWrapper}>
                <Input
                  id="rec-new"
                  type={showNew ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder={`At least ${MIN_PASSPHRASE_LENGTH} characters`}
                  value={newPassphrase}
                  onChange={(e) => setNewPassphrase(e.target.value)}
                  disabled={submitting}
                  className={s.inputWithIcon}
                  autoFocus
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground absolute inset-y-0 right-0 hover:bg-transparent"
                  onClick={() => setShowNew((v) => !v)}
                  tabIndex={-1}
                  aria-label={showNew ? 'Hide passphrase' : 'Show passphrase'}
                >
                  {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {newPassphrase && newPassphrase.length < MIN_PASSPHRASE_LENGTH && (
                <p className={s.hint}>At least {MIN_PASSPHRASE_LENGTH} characters required.</p>
              )}
            </div>

            <div className={s.field}>
              <label className={s.label} htmlFor="rec-confirm">
                Confirm new passphrase
              </label>
              <div className={s.inputWrapper}>
                <Input
                  id="rec-confirm"
                  type={showConfirm ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Repeat your new passphrase"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={submitting}
                  className={s.inputWithIcon}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground absolute inset-y-0 right-0"
                  onClick={() => setShowConfirm((v) => !v)}
                  tabIndex={-1}
                  aria-label={showConfirm ? 'Hide passphrase' : 'Show passphrase'}
                >
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {confirm && newPassphrase !== confirm && <p className={s.error}>Passphrases do not match.</p>}
            </div>

            {submitError && <p className={s.error}>{submitError}</p>}

            <Button type="submit" disabled={!canSubmit} className={s.submitBtn}>
              {submitting ? 'Recovering…' : 'Recover access'}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className={s.container}>
      <div className={s.card}>
        <div className={s.iconWrap}>
          <ShieldCheck size={40} strokeWidth={1.3} />
        </div>
        <h2 className={s.heading}>Recover access</h2>
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
      </div>
    </div>
  );
}
