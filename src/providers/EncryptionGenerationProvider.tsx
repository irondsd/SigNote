'use client';

/**
 * Binds the signed-in account to the generation the transports put on the wire,
 * and reconciles this device when the account's vault moves on.
 *
 * It sits at the root rather than inside `(vault)`, because the plaintext Note
 * tier is fenced by exactly the same server check as the encrypted ones: every
 * ordinary request needs the header, not only the ones that carry ciphertext.
 *
 * Three things can tell a device that a rotation committed: its own persisted
 * marker (left unreconciled by an interrupted purge), a sibling tab's
 * broadcast, or the server refusing a request it sent. All three land in the
 * same place — purge, then reload — because a reload is the only way to be sure
 * that no component is still holding a decrypted value from the old vault in
 * React state or a blob URL.
 *
 * The device that performed the rotation does not go through here: the wizard
 * reconciles in place and completes the marker before releasing the UI, so this
 * provider sees an already-reconciled account and does nothing.
 */

import { useEffect, useRef, useState, type FC, type ReactNode } from 'react';
import { useSession } from 'next-auth/react';

import {
  bindGenerationUser,
  needsReconciliation,
  observeGeneration,
  readMarker,
  subscribeGeneration,
} from '@/lib/encryptionGeneration';
import { syncGeneration } from '@/lib/encryptionGenerationClient';
import { reconcileToGeneration } from '@/lib/encryptionReconcile';

export const EncryptionGenerationProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const { status, data } = useSession();
  const userId = data?.user?.id ?? null;

  // Binding has to happen during render, not in an effect: a child's first
  // query can be in flight before effects run, and it must already carry the
  // generation this device recorded.
  const [bound, setBound] = useState<string | null>(null);
  if (bound !== userId) {
    bindGenerationUser(userId);
    setBound(userId);
  }

  /** True while this device is purging; children stay unmounted until it ends. */
  const [reconciling, setReconciling] = useState(false);
  const running = useRef(false);

  useEffect(() => {
    if (!userId || status !== 'authenticated') return;
    let cancelled = false;

    const reconcile = async (generation: number) => {
      if (running.current) return;
      running.current = true;
      if (!cancelled) setReconciling(true);
      const ok = await reconcileToGeneration({ userId, generation });
      if (cancelled) return;
      // A failed purge leaves the marker unreconciled, so reloading would spin.
      // Render instead, locked: the server fence still refuses every stale
      // write, and the next launch retries the purge.
      if (ok) window.location.reload();
      else {
        running.current = false;
        setReconciling(false);
      }
    };

    // An interrupted purge is resumed before anything is fetched with the new
    // generation, which is what the persisted marker exists to guarantee.
    if (needsReconciliation(userId)) {
      void reconcile(readMarker(userId)!.generation);
      return () => {
        cancelled = true;
      };
    }

    // A device with no marker learns its generation here rather than by having
    // its first real query refused.
    if (readMarker(userId) === null) {
      void syncGeneration(userId);
    }

    const unsubscribe = subscribeGeneration((message) => {
      if (message.userId !== userId) return;
      if (observeGeneration(userId, message.generation) === 'unchanged') return;
      void reconcile(message.generation);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [userId, status]);

  if (reconciling) return null;
  return <>{children}</>;
};
