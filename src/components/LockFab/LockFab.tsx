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

  const handleClick = async () => {
    if (isUnlocked) {
      lock();
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
      <button
        className={cn(s.fab, isUnlocked ? s.unlocked : s.locked)}
        onClick={handleClick}
        disabled={rehydrating}
        aria-label={isUnlocked ? 'Lock' : 'Unlock'}
        title={isUnlocked ? 'Lock' : 'Unlock'}
      >
        {isUnlocked ? <Lock size={16} /> : <LockOpen size={16} />}
        {rehydrating ? 'Unlocking…' : isUnlocked ? 'Lock' : 'Unlock'}
      </button>

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
