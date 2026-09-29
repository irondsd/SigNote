'use client';

import { useState } from 'react';
import { ShieldCheck, AlertTriangle } from 'lucide-react';
import posthog from 'posthog-js';
import { useEncryption } from '@/contexts/EncryptionContext';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/PasswordInput/PasswordInput';
import s from './EncryptionSetup.module.scss';
import { MAX_PASSPHRASE_LENGTH, MIN_PASSPHRASE_LENGTH } from '@/config/constants';

type EncryptionSetupProps = {
  displayName?: string;
};

export function EncryptionSetup({ displayName }: EncryptionSetupProps) {
  const { setupProfile } = useEncryption();
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function validate(): string {
    if (!passphrase) return 'Passphrase is required.';
    if (passphrase.length < MIN_PASSPHRASE_LENGTH)
      return `Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`;
    if (passphrase.length > MAX_PASSPHRASE_LENGTH)
      return `Passphrase must be at most ${MAX_PASSPHRASE_LENGTH} characters.`;
    if (passphrase !== confirm) return 'Passphrases do not match.';
    return '';
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError('');
    setLoading(true);
    try {
      await setupProfile(passphrase);
      posthog.capture('encryption_profile_setup');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create encryption profile.');
      posthog.captureException(e);
      setLoading(false);
    }
  };

  return (
    <div className={s.container}>
      <div className={s.card}>
        <div className={s.iconWrap}>
          <ShieldCheck size={40} strokeWidth={1.3} />
        </div>
        <h2 className={s.heading}>Set up encrypted notes</h2>

        <div className={s.warningBox}>
          <AlertTriangle size={16} className={s.warningIcon} />
          <div className={s.warningText}>
            <p>Your passphrase is never stored by the app.</p>
            <p>If you forget it, your encrypted notes cannot be recovered.</p>
            <p>Use a strong passphrase of at least 16 characters — ideally multiple random words.</p>
          </div>
        </div>

        <form className={s.form} onSubmit={handleSubmit}>
          <input
            type="text"
            autoComplete="username"
            value={displayName ?? ''}
            readOnly
            aria-hidden="true"
            style={{ display: 'none' }}
          />

          <div className={s.field}>
            <label className={s.label} htmlFor="enc-passphrase">
              Passphrase
            </label>
            <PasswordInput
              id="enc-passphrase"
              autoComplete="new-password"
              placeholder="Enter a strong passphrase"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              disabled={loading}
              toggleTabIndex={-1}
            />
          </div>

          <div className={s.field}>
            <label className={s.label} htmlFor="enc-confirm">
              Confirm passphrase
            </label>
            <PasswordInput
              id="enc-confirm"
              autoComplete="new-password"
              placeholder="Repeat your passphrase"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={loading}
              toggleTabIndex={-1}
            />
          </div>

          {error && <p className={s.error}>{error}</p>}

          <Button type="submit" disabled={loading} className={s.submitBtn}>
            {loading ? 'Creating encryption keys…' : 'Create encryption keys'}
          </Button>
        </form>
      </div>
    </div>
  );
}
