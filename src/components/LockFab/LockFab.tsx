'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Lock, LockOpen } from 'lucide-react';
import { useEncryption } from '@/contexts/EncryptionContext';
import { PassphraseModal } from '@/components/PassphraseModal/PassphraseModal';
import s from './LockFab.module.scss';
import { cn } from '@/utils/cn';

export function LockFab() {
  const { data: session } = useSession();
  const { phase, lockType, lock, rehydrate } = useEncryption();
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [rehydrating, setRehydrating] = useState(false);

  const isAuthenticated = !!session?.user?.id;
  const isUnlocked = phase === 'unlocked';

  if (!isAuthenticated || (phase !== 'locked' && phase !== 'unlocked')) return null;

  const handleLock = () => {
    if (!isUnlocked) {
      return;
    }

    lock();
  };

  const handleUnlock = async () => {
    if (isUnlocked) {
      return;
    }
    if (lockType === 'soft') {
      setRehydrating(true);
      try {
        await rehydrate();
      } catch {
        setShowPassphrase(true);
      } finally {
        setRehydrating(false);
      }
    } else {
      setShowPassphrase(true);
    }
  };

  return (
    <>
      <div
        className={cn(s.fab, isUnlocked ? s.isUnlocked : s.isLocked)}
        role="group"
        aria-label="Encryption lock controls"
        aria-busy={rehydrating}
      >
        <span className={s.thumb} aria-hidden="true" />

        <button
          type="button"
          className={cn(s.option, s.lockOption)}
          onClick={handleLock}
          disabled={rehydrating}
          aria-label="Lock"
          aria-pressed={!isUnlocked}
          title="Lock"
        >
          <Lock size={20} />
        </button>

        <button
          type="button"
          className={cn(s.option, s.unlockOption)}
          onClick={handleUnlock}
          disabled={rehydrating}
          aria-label="Unlock"
          aria-pressed={isUnlocked}
          title="Unlock"
        >
          <LockOpen size={20} />
        </button>
      </div>

      {showPassphrase && (
        <PassphraseModal
          onSuccess={() => setShowPassphrase(false)}
          onClose={() => setShowPassphrase(false)}
          displayName={session?.user?.name ?? undefined}
        />
      )}
    </>
  );
}
