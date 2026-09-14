'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { X, Eye, EyeOff } from 'lucide-react';
import posthog from 'posthog-js';
import { useEncryption } from '@/contexts/EncryptionContext';
import { EncryptionMaterialUnavailableError } from '@/lib/encryptionMaterial';
import { IncorrectPassphraseError } from '@/lib/vaultKey';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Backdrop } from '@/components/Backdrop/Backdrop';
import { Modal } from '@/components/Modal/Modal';
import s from './PassphraseModal.module.scss';

type PassphraseModalProps = {
  onSuccess: () => void;
  onClose: () => void;
  displayName?: string;
};

export function PassphraseModal({ onSuccess, onClose, displayName }: PassphraseModalProps) {
  const { unlock, preloadUnlockMaterial, clearPreloadedUnlockMaterial } = useEncryption();
  const passphraseId = useId();
  const hintId = useId();
  const errorId = useId();
  const [passphrase, setPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);

  useEffect(() => {
    preloadUnlockMaterial();
    return clearPreloadedUnlockMaterial;
  }, [clearPreloadedUnlockMaterial, preloadUnlockMaterial]);

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
      posthog.capture('vault_unlocked');
      onSuccess();
    } catch (caught) {
      const reason =
        caught instanceof IncorrectPassphraseError
          ? 'incorrect_passphrase'
          : caught instanceof EncryptionMaterialUnavailableError
            ? 'material_unavailable'
            : 'unknown';
      posthog.capture('vault_unlock_failed', { reason });
      setError(
        reason === 'incorrect_passphrase'
          ? 'Incorrect passphrase. Please try again.'
          : caught instanceof EncryptionMaterialUnavailableError
            ? caught.message
            : "We couldn't unlock your encrypted notes. Please try again.",
      );
      setHasFailed(reason === 'incorrect_passphrase');
      setLoading(false);
    }
  };

  return (
    <Backdrop onClose={onClose} className={s.backdrop}>
      <Modal className={s.modal}>
        <div className={s.header}>
          <h2 className={s.heading}>Unlock encrypted notes</h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} title="Close">
            <X size={18} />
          </Button>
        </div>

        <form className={s.body} onSubmit={handleSubmit}>
          <p id={hintId} className={s.hint}>
            Enter your passphrase to decrypt your notes for this session.
          </p>

          <input
            type="text"
            autoComplete="username"
            value={displayName ?? ''}
            readOnly
            aria-hidden="true"
            style={{ display: 'none' }}
          />

          <div className={s.inputWrapper}>
            <label htmlFor={passphraseId} className="sr-only">
              Encryption passphrase
            </label>
            <Input
              id={passphraseId}
              type={showPassphrase ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="Your passphrase"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              disabled={loading}
              autoFocus
              aria-invalid={!!error}
              aria-describedby={error ? `${hintId} ${errorId}` : hintId}
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
              {showPassphrase ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>

          {error && (
            <p id={errorId} className={s.error} role="alert">
              {error}
            </p>
          )}
          {hasFailed && (
            <p className={s.recoverLink}>
              Forgot your passphrase?{' '}
              <Link href="/recover" onClick={onClose}>
                Recover →
              </Link>
            </p>
          )}

          <div className={s.actions}>
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
