'use client';

import { useEffect, useRef } from 'react';
import type { LockType } from '@/contexts/EncryptionContext';

type EncryptedAction = (mek: CryptoKey) => Promise<void>;

type Options<Action extends string> = {
  mek: CryptoKey | null;
  lockType: LockType;
  rehydrate: () => Promise<CryptoKey>;
  execute: (action: EncryptedAction) => Promise<void>;
  actions: Record<Action, EncryptedAction>;
};

/** Resume a pending action after a soft unlock, or ask the guard for a passphrase. */
export function useRehydratingEncryptionAction<Action extends string>({
  mek,
  lockType,
  rehydrate,
  execute,
  actions,
}: Options<Action>) {
  const pendingActionRef = useRef<Action | null>(null);

  useEffect(() => {
    const pending = pendingActionRef.current;
    if (!pending || !mek) return;

    // Clear before awaiting the action so a rerender cannot run it twice.
    pendingActionRef.current = null;
    void actions[pending](mek);
  }, [mek, actions]);

  return async (action: Action): Promise<void> => {
    const perform = actions[action];
    if (lockType !== 'soft') {
      await execute(perform);
      return;
    }

    pendingActionRef.current = action;
    try {
      await rehydrate();
    } catch {
      // A partial rehydrate may have published a MEK before reporting failure.
      if (pendingActionRef.current !== action) return;
      pendingActionRef.current = null;
      await execute(perform);
    }
  };
}
