'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { useEncryption } from '@/contexts/EncryptionContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Backdrop } from '@/components/Backdrop/Backdrop';
import { Modal } from '@/components/Modal/Modal';
import styles from './PassphraseModal.module.scss';

type PassphraseModalProps = {
  onSuccess: () => void;
  onClose: () => void;
};

export function PassphraseModal({ onSuccess, onClose }: PassphraseModalProps) {
  const { unlock } = useEncryption();
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphrase.trim()) {
      setError('Passphrase is required.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await unlock(passphrase);
      onSuccess();
    } catch {
      setError('Incorrect passphrase. Please try again.');
      setLoading(false);
    }
  };

  return (
    <Backdrop onClose={onClose} className={styles.backdrop}>
      <Modal className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.heading}>Unlock encrypted notes</h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} title="Close">
            <X size={18} />
          </Button>
        </div>

        <form className={styles.body} onSubmit={handleSubmit}>
          <p className={styles.hint}>Enter your passphrase to decrypt your notes for this session.</p>

          <Input
            type="password"
            autoComplete="current-password"
            placeholder="Your passphrase"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            disabled={loading}
            autoFocus
          />

          {error && <p className={styles.error}>{error}</p>}

          <div className={styles.actions}>
            <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !passphrase.trim()}>
              {loading ? 'Unlocking…' : 'Unlock'}
            </Button>
          </div>
        </form>
      </Modal>
    </Backdrop>
  );
}
