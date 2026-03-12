'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle, Eye, EyeOff, HelpCircle, KeyRound, Loader2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { MAX_PASSPHRASE_LENGTH, MIN_PASSPHRASE_LENGTH } from '@/config/constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import styles from './page.module.scss';
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
  const { status } = useSession();
  const router = useRouter();
  const oldPassphraseInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/');
  }, [status, router]);

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
      const res = await fetch('/api/encryption/material');
      if (res.status === 404) {
        router.replace('/');
        return;
      }
      if (!res.ok) throw new Error('Failed to fetch material');
      const material: Material = await res.json();
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

      const res = await fetch('/api/encryption/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverShare: newServerShareB64, salt: newSalt, keyCheck: newKeyCheck }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || 'Failed to update passphrase.');
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
      <div className={styles.container}>
        <div className={styles.card}>
          <div className={styles.successIcon}>
            <CheckCircle size={48} strokeWidth={1.3} />
          </div>
          <h2 className={styles.heading}>Passphrase changed</h2>
          <p className={styles.successText}>
            Your encryption keys have been updated. Your old passphrase will no longer work.
          </p>
          <Button asChild variant="outline" className={styles.submitBtn}>
            <Link href="/secrets">Back to Secrets</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.iconWrap}>
          <KeyRound size={40} strokeWidth={1.3} />
        </div>
        <h2 className={styles.heading}>Change passphrase</h2>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="cp-old">
              Current passphrase
            </label>
            <div className={styles.inputWrapper}>
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
                className={styles.inputWithIcon}
              />
              <span className={styles.inputIcon}>
                {verifyState === 'idle' && <HelpCircle size={16} className={styles.iconIdle} />}
                {verifyState === 'verifying' && <Loader2 size={16} className={styles.spinning} />}
                {verifyState === 'valid' && <CheckCircle size={16} className={styles.iconValid} />}
                {verifyState === 'invalid' && <XCircle size={16} className={styles.iconInvalid} />}
              </span>
            </div>
            {verifyState === 'invalid' && <p className={styles.error}>Incorrect passphrase.</p>}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="cp-new">
              New passphrase
            </label>
            <div className={styles.inputWrapper}>
              <Input
                id="cp-new"
                type={showNew ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="At least 16 characters"
                value={newPassphrase}
                onChange={(e) => setNewPassphrase(e.target.value)}
                disabled={submitting}
                className={styles.inputWithIcon}
              />
              <button
                type="button"
                className={styles.inputIconBtn}
                onClick={() => setShowNew((v) => !v)}
                tabIndex={-1}
                aria-label={showNew ? 'Hide passphrase' : 'Show passphrase'}
              >
                {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {newPassphrase && newPassphrase.length < MIN_PASSPHRASE_LENGTH && (
              <p className={styles.hint}>At least {MIN_PASSPHRASE_LENGTH} characters required.</p>
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="cp-confirm">
              Confirm new passphrase
            </label>
            <div className={styles.inputWrapper}>
              <Input
                id="cp-confirm"
                type={showConfirm ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="Repeat your new passphrase"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={submitting}
                className={styles.inputWithIcon}
              />
              <button
                type="button"
                className={styles.inputIconBtn}
                onClick={() => setShowConfirm((v) => !v)}
                tabIndex={-1}
                aria-label={showConfirm ? 'Hide passphrase' : 'Show passphrase'}
              >
                {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {confirm && newPassphrase !== confirm && <p className={styles.error}>Passphrases do not match.</p>}
          </div>

          {submitError && <p className={styles.error}>{submitError}</p>}

          <Button type="submit" disabled={!canSubmit} className={styles.submitBtn}>
            {submitting ? 'Updating…' : 'Change passphrase'}
          </Button>
        </form>
      </div>
    </div>
  );
}
