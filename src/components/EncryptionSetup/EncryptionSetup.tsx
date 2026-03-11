'use client';

import { useState } from 'react';
import { ShieldCheck, AlertTriangle } from 'lucide-react';
import { useEncryption } from '@/contexts/EncryptionContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import styles from './EncryptionSetup.module.scss';

const MIN_PASSPHRASE_LENGTH = 16;
const MAX_PASSPHRASE_LENGTH = 256;

export function EncryptionSetup() {
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
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create encryption profile.');
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.iconWrap}>
          <ShieldCheck size={40} strokeWidth={1.3} />
        </div>
        <h2 className={styles.heading}>Set up encrypted notes</h2>

        <div className={styles.warningBox}>
          <AlertTriangle size={16} className={styles.warningIcon} />
          <div className={styles.warningText}>
            <p>Your passphrase is never stored by the app.</p>
            <p>If you forget it, your encrypted notes cannot be recovered.</p>
            <p>Use a strong passphrase of at least 16 characters — ideally multiple random words.</p>
          </div>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="enc-passphrase">
              Passphrase
            </label>
            <Input
              id="enc-passphrase"
              type="password"
              autoComplete="new-password"
              placeholder="Enter a strong passphrase"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="enc-confirm">
              Confirm passphrase
            </label>
            <Input
              id="enc-confirm"
              type="password"
              autoComplete="new-password"
              placeholder="Repeat your passphrase"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={loading}
            />
          </div>

          {error && <p className={styles.error}>{error}</p>}

          <Button type="submit" disabled={loading} className={styles.submitBtn}>
            {loading ? 'Creating encryption keys…' : 'Create encryption keys'}
          </Button>
        </form>
      </div>
    </div>
  );
}
