'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle, Eye, EyeOff, HelpCircle, KeyRound, Loader2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { MAX_PASSPHRASE_LENGTH, MIN_PASSPHRASE_LENGTH } from '@/config/constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import s from './page.module.scss';
import { HTTPError } from 'ky';
import { api } from '@/lib/api';
import { useProfile } from '@/hooks/useProfile';
import {
  createKeyCheck,
  deriveDeviceShare,
  generateSalt,
  importMEK,
  saveDeviceShare,
  verifyKeyCheck,
  xor32,
} from '@/lib/crypto';

type VerifyState = 'idle' | 'verifying' | 'valid' | 'invalid';

type Material = {
  serverShare: string;
  salt: string;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; length: number };
  keyCheck: { alg: 'A256GCM'; iv: string; ciphertext: string };
};

export default function ChangePassphrasePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { data: profile, isLoading: profileLoading } = useProfile();
  const oldPassphraseInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/');
  }, [status, router]);

  useEffect(() => {
    if (!profileLoading && profile && !profile.hasEncryptionProfile) router.replace('/secrets');
  }, [profileLoading, profile, router]);

  const [screen, setScreen] = useState<'form' | 'success'>('form');

  const [oldPassphrase, setOldPassphrase] = useState('');
  const [verifyState, setVerifyState] = useState<VerifyState>('idle');
  const mekBytesRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const materialRef = useRef<Material | null>(null);

  const [newPassphrase, setNewPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const syncOldPassphraseFromDom = () => {
    const domValue = oldPassphraseInputRef.current?.value ?? '';
    if (!domValue || domValue === oldPassphrase) return;

    setOldPassphrase(domValue);
    setVerifyState('idle');
    mekBytesRef.current = null;
    materialRef.current = null;
  };

  const handleOldBlur = async () => {
    if (!oldPassphrase) return;
    if (status !== 'authenticated') return;

    setVerifyState('verifying');
    mekBytesRef.current = null;
    materialRef.current = null;
    try {
      let material: Material;
      try {
        material = await api.get('/api/encryption/material').json<Material>();
      } catch (e) {
        if (e instanceof HTTPError && e.response.status === 404) {
          router.replace('/secrets');
          return;
        }
        throw new Error('Failed to fetch material');
      }
      materialRef.current = material;

      const deviceShare = await deriveDeviceShare(oldPassphrase, material.salt, material.kdf);
      const serverShareBytes = Uint8Array.from(atob(material.serverShare), (c) => c.charCodeAt(0));
      const mekBytes = xor32(deviceShare, serverShareBytes);
      const mek = await importMEK(mekBytes);
      const valid = await verifyKeyCheck(mek, material.keyCheck);

      if (valid) {
        mekBytesRef.current = mekBytes;
        setVerifyState('valid');
      } else {
        setVerifyState('invalid');
      }
    } catch {
      setVerifyState('invalid');
    }
  };

  // Chrome can autofill password fields after hydration without firing onChange.
  // Read the DOM value and sync it into React state shortly after mount.
  useEffect(() => {
    const raf = requestAnimationFrame(syncOldPassphraseFromDom);
    const timeout = setTimeout(syncOldPassphraseFromDom, 150);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Trigger verification when session loads with a pre-filled field (browser autofill)
  useEffect(() => {
    if (status === 'authenticated' && oldPassphrase && verifyState === 'idle') {
      void handleOldBlur();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, oldPassphrase, verifyState]);

  if (status !== 'authenticated') return null;

  const canSubmit =
    verifyState === 'valid' &&
    newPassphrase.length >= MIN_PASSPHRASE_LENGTH &&
    newPassphrase === confirm &&
    !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newPassphrase) return setSubmitError('New passphrase is required.');
    if (newPassphrase.length < MIN_PASSPHRASE_LENGTH)
      return setSubmitError(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
    if (newPassphrase.length > MAX_PASSPHRASE_LENGTH)
      return setSubmitError(`Passphrase must be at most ${MAX_PASSPHRASE_LENGTH} characters.`);
    if (newPassphrase !== confirm) return setSubmitError('Passphrases do not match.');
    if (!mekBytesRef.current || !materialRef.current)
      return setSubmitError('Please verify your current passphrase first.');

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
          throw new Error((body as { error?: string }).error || 'Failed to update passphrase.');
        }
        throw e;
      }

      saveDeviceShare(newDeviceShare);
      setScreen('success');
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to update passphrase.');
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
          <h2 className={s.heading}>Passphrase changed</h2>
          <p className={s.successText}>
            Your encryption keys have been updated. Your old passphrase will no longer work.
          </p>
          <Button asChild variant="outline" className={s.submitBtn}>
            <Link href="/secrets">Back to Secrets</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={s.container}>
      <div className={s.card}>
        <div className={s.iconWrap}>
          <KeyRound size={40} strokeWidth={1.3} />
        </div>
        <h2 className={s.heading}>Change passphrase</h2>

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
            <label className={s.label} htmlFor="cp-old">
              Current passphrase
            </label>
            <div className={s.inputWrapper}>
              <Input
                id="cp-old"
                ref={oldPassphraseInputRef}
                name="current-password"
                type="password"
                autoComplete="current-password"
                placeholder="Enter your current passphrase"
                value={oldPassphrase}
                onChange={(e) => {
                  setOldPassphrase(e.target.value);
                  setVerifyState('idle');
                  mekBytesRef.current = null;
                  materialRef.current = null;
                }}
                onInput={syncOldPassphraseFromDom}
                onBlur={handleOldBlur}
                disabled={submitting}
                className={s.inputWithIcon}
              />
              <span className={s.inputIcon}>
                {verifyState === 'idle' && <HelpCircle size={16} className={s.iconIdle} />}
                {verifyState === 'verifying' && <Loader2 size={16} className={s.spinning} />}
                {verifyState === 'valid' && <CheckCircle size={16} className={s.iconValid} />}
                {verifyState === 'invalid' && <XCircle size={16} className={s.iconInvalid} />}
              </span>
            </div>
            {verifyState === 'invalid' && <p className={s.error}>Incorrect passphrase.</p>}
          </div>

          <div className={s.field}>
            <label className={s.label} htmlFor="cp-new">
              New passphrase
            </label>
            <div className={s.inputWrapper}>
              <Input
                id="cp-new"
                type={showNew ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="At least 16 characters"
                value={newPassphrase}
                onChange={(e) => setNewPassphrase(e.target.value)}
                disabled={submitting}
                className={s.inputWithIcon}
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
            <label className={s.label} htmlFor="cp-confirm">
              Confirm new passphrase
            </label>
            <div className={s.inputWrapper}>
              <Input
                id="cp-confirm"
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
                {showConfirm ? (
                  <EyeOff className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Eye className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </div>
            {confirm && newPassphrase !== confirm && <p className={s.error}>Passphrases do not match.</p>}
          </div>

          {submitError && <p className={s.error}>{submitError}</p>}

          <Button type="submit" disabled={!canSubmit} className={s.submitBtn}>
            {submitting ? 'Updating…' : 'Change passphrase'}
          </Button>
        </form>
      </div>
    </div>
  );
}
