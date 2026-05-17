'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useEncryption } from '@/contexts/EncryptionContext';
import { PassphraseModal } from '@/components/PassphraseModal/PassphraseModal';

type SimpleGuardReturn = {
  execute: (action: (mek: CryptoKey) => Promise<void>) => Promise<void>;
  PassphraseGuard: React.ReactNode | null;
};

type AdvancedGuardReturn = SimpleGuardReturn & {
  onRehydrate: (callback: () => void | Promise<void>) => void;
  isMekAvailable: boolean;
  isPending: boolean;
};

/**
 * Simple encryption guard — call execute() with your action; PassphraseGuard handles modal rendering.
 */
export function useSimpleEncryptionGuard(): SimpleGuardReturn {
  const { execute, PassphraseGuard } = useEncryptionGuard();
  return { execute, PassphraseGuard };
}

/**
 * Encryption guard hook. Supports optional post-unlock recovery callback (e.g., rehydrate).
 */
export function useEncryptionGuard(options?: { onRehydrate?: () => void | Promise<void> }): AdvancedGuardReturn {
  const { mek } = useEncryption();
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [isPending, setPending] = useState(false);
  const pendingActionRef = useRef<((mek: CryptoKey) => Promise<void>) | null>(null);
  const rehydrateCallbackRef = useRef<(() => void | Promise<void>) | null>(options?.onRehydrate ?? null);
  const resolvePassphraseRef = useRef<(() => void) | null>(null);
  const waitingForMekRef = useRef(false);

  const execute = useCallback(
    async (action: (mek: CryptoKey) => Promise<void>): Promise<void> => {
      if (!mek) {
        setPending(true);
        pendingActionRef.current = action;
        waitingForMekRef.current = true;
        setShowPassphrase(true);
        return new Promise<void>((resolve) => {
          resolvePassphraseRef.current = resolve;
        });
      }
      await action(mek);
    },
    [mek],
  );

  const handlePassphraseSuccess = useCallback(async () => {
    setShowPassphrase(false);
    setPending(false);

    if (rehydrateCallbackRef.current) {
      await rehydrateCallbackRef.current();
    }
  }, []);

  const handlePassphraseClose = useCallback(() => {
    setShowPassphrase(false);
    setPending(false);
    waitingForMekRef.current = false;
    pendingActionRef.current = null;
    if (resolvePassphraseRef.current) {
      resolvePassphraseRef.current();
      resolvePassphraseRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!mek || !waitingForMekRef.current || !pendingActionRef.current) return;

    (async () => {
      await pendingActionRef.current!(mek);
      pendingActionRef.current = null;
      waitingForMekRef.current = false;

      if (resolvePassphraseRef.current) {
        resolvePassphraseRef.current();
        resolvePassphraseRef.current = null;
      }
    })();
  }, [mek]);

  const onRehydrate = useCallback((callback: () => void | Promise<void>) => {
    rehydrateCallbackRef.current = callback;
  }, []);

  const passphraseFinallyGuard = showPassphrase ? (
    <PassphraseModal onSuccess={handlePassphraseSuccess} onClose={handlePassphraseClose} />
  ) : null;

  return {
    execute,
    onRehydrate,
    PassphraseGuard: passphraseFinallyGuard,
    isMekAvailable: !!mek,
    isPending,
  };
}
