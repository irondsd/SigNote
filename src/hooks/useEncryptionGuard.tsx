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
 * Simple encryption guard for trivial cases (70% of uses).
 * Call execute() with your action; PassphraseGuard handles modal rendering.
 *
 * @example
 * const guard = useSimpleEncryptionGuard();
 * await guard.execute(async (mek) => saveNote(mek));
 * return <>{guard.PassphraseGuard}</>;
 */
export function useSimpleEncryptionGuard(): SimpleGuardReturn {
  const { mek } = useEncryption();
  const [showPassphrase, setShowPassphrase] = useState(false);
  const pendingActionRef = useRef<((mek: CryptoKey) => Promise<void>) | null>(null);
  const resolvePassphraseRef = useRef<(() => void) | null>(null);
  const waitingForMekRef = useRef(false);

  const execute = useCallback(
    async (action: (mek: CryptoKey) => Promise<void>): Promise<void> => {
      if (!mek) {
        pendingActionRef.current = action;
        waitingForMekRef.current = true;
        setShowPassphrase(true);
        // Wait for passphrase modal to complete before returning
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
    // Don't execute action here - let useEffect handle it when mek becomes available
  }, []);

  const handlePassphraseClose = useCallback(() => {
    setShowPassphrase(false);
    waitingForMekRef.current = false;
    pendingActionRef.current = null;
    // Resolve the waiting execute() call (user cancelled)
    if (resolvePassphraseRef.current) {
      resolvePassphraseRef.current();
      resolvePassphraseRef.current = null;
    }
  }, []);

  // Execute pending action when mek becomes available
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

  const passphraseFinallyGuard = showPassphrase ? (
    <PassphraseModal onSuccess={handlePassphraseSuccess} onClose={handlePassphraseClose} />
  ) : null;

  return {
    execute,
    PassphraseGuard: passphraseFinallyGuard,
  };
}

/**
 * Advanced encryption guard hook for complex cases (30% of uses).
 * Supports post-unlock recovery callbacks (e.g., rehydrate).
 *
 * @example
 * const guard = useEncryptionGuard({ onRehydrate: () => refetchPreviews() });
 * const handleClick = async (note) => {
 *   if (lockType === 'soft') {
 *     await guard.execute(async () => rehydrate());
 *   } else {
 *     guard.execute(async (mek) => openNote(mek));
 *   }
 * };
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
        // Wait for passphrase modal to complete before returning
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

    // Call rehydrate callback if registered
    if (rehydrateCallbackRef.current) {
      await rehydrateCallbackRef.current();
    }

    // Don't execute action here - let useEffect handle it when mek becomes available
  }, []);

  const handlePassphraseClose = useCallback(() => {
    setShowPassphrase(false);
    setPending(false);
    waitingForMekRef.current = false;
    pendingActionRef.current = null;
    // Resolve the waiting execute() call (user cancelled)
    if (resolvePassphraseRef.current) {
      resolvePassphraseRef.current();
      resolvePassphraseRef.current = null;
    }
  }, []);

  // Execute pending action when mek becomes available
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
