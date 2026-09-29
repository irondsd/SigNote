'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle, HelpCircle, KeyRound, Loader2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import posthog from 'posthog-js';
import { MAX_PASSPHRASE_LENGTH, MIN_PASSPHRASE_LENGTH } from '@/config/constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PassphrasePairFields } from '@/components/PassphrasePairFields/PassphrasePairFields';
import { SecurityPageCard } from '@/components/SecurityPageCard/SecurityPageCard';
import s from './page.module.scss';
import { TRPCClientError } from '@trpc/client';
import { trpcClient } from '@/lib/trpcClient';
import type { StoredMaterial } from '@/lib/encryptionMaterialStore';
import { updateEncryptionPassphrase } from '@/lib/updateEncryptionPassphrase';
import { useProfile } from '@/hooks/useProfile';
import { useSecurityPreferences } from '@/hooks/useSecurityPreferences';
import { deriveDeviceShare, importMEK, verifyKeyCheck, xor32 } from '@/lib/crypto';

type VerifyState = 'idle' | 'verifying' | 'valid' | 'invalid';

export default function ChangePassphrasePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { data: profile, isLoading: profileLoading } = useProfile();
  const { data: security } = useSecurityPreferences();
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
  const materialRef = useRef<StoredMaterial | null>(null);

  const [newPassphrase, setNewPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
      let material: StoredMaterial;
      try {
        material = (await trpcClient.encryption.material.query()) as unknown as StoredMaterial;
      } catch (e) {
        if (e instanceof TRPCClientError && e.data?.code === 'NOT_FOUND') {
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
      await updateEncryptionPassphrase(mekBytesRef.current, newPassphrase, materialRef.current, {
        userId: session?.user?.id,
        allowed: security?.cacheServerShare,
      });
      posthog.capture('passphrase_changed');
      setScreen('success');
    } catch (e: unknown) {
      setSubmitError(e instanceof Error && e.message ? e.message : 'Failed to update passphrase.');
      setSubmitting(false);
    }
  };

  if (screen === 'success') {
    return (
      <SecurityPageCard icon={<CheckCircle size={48} strokeWidth={1.3} />} title="Passphrase changed" tone="success">
        <p className={s.successText}>
          Your encryption keys have been updated. Your old passphrase will no longer work.
        </p>
        <p className={s.successText}>Your previous recovery backup is no longer valid.{' \n'}</p>
        <Link href="/backup-recovery" className={s.successLink}>
          Back up again →
        </Link>
        <Button asChild variant="outline" className={s.submitBtn}>
          <Link href="/secrets">Back to Secrets</Link>
        </Button>
      </SecurityPageCard>
    );
  }

  return (
    <SecurityPageCard icon={<KeyRound size={40} strokeWidth={1.3} />} title="Change passphrase">
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

        <PassphrasePairFields
          mode="replace"
          newId="cp-new"
          confirmationId="cp-confirm"
          value={newPassphrase}
          confirmation={confirm}
          onValueChange={setNewPassphrase}
          onConfirmationChange={setConfirm}
          disabled={submitting}
        />

        {submitError && <p className={s.error}>{submitError}</p>}

        <Button type="submit" disabled={!canSubmit} className={s.submitBtn}>
          {submitting ? 'Updating…' : 'Change passphrase'}
        </Button>
      </form>
    </SecurityPageCard>
  );
}
