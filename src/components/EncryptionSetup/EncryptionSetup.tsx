'use client';

import { useState } from 'react';
import { Eye, EyeOff, ShieldCheck, AlertTriangle } from 'lucide-react';
import { useEncryption } from '@/contexts/EncryptionContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import s from './EncryptionSetup.module.scss';
import { MAX_PASSPHRASE_LENGTH, MIN_PASSPHRASE_LENGTH } from '@/config/constants';

type EncryptionSetupProps = {
  address?: string;
};

export function EncryptionSetup({ address }: EncryptionSetupProps) {
  const { setupProfile } = useEncryption();
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [showPassphrase, setShowPassphrase] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

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
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create encryption profile.');
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
            value={address ?? ''}
            readOnly
            aria-hidden="true"
            style={{ display: 'none' }}
          />

          <div className={s.field}>
            <label className={s.label} htmlFor="enc-passphrase">
              Passphrase
            </label>
            <div className={s.inputWrapper}>
              <Input
                id="enc-passphrase"
                type={showPassphrase ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="Enter a strong passphrase"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                disabled={loading}
                className={s.inputWithIcon}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground absolute inset-y-0 right-0 hover:bg-transparent"
                onClick={() => setShowPassphrase((v) => !v)}
                tabIndex={-1}
                aria-label={showPassphrase ? 'Hide passphrase' : 'Show passphrase'}
              >
                {showPassphrase ? (
                  <EyeOff className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Eye className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </div>
          </div>

          <div className={s.field}>
            <label className={s.label} htmlFor="enc-confirm">
              Confirm passphrase
            </label>
            <div className={s.inputWrapper}>
              <Input
                id="enc-confirm"
                type={showConfirm ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="Repeat your passphrase"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={loading}
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
