'use client';

import { useEffect, useRef } from 'react';
import { HARD_LOCK_MS, SLEEP_CHECK_INTERVAL_MS, SLEEP_THRESHOLD_MS } from '@/config/constants';
import { useEncryption } from '@/contexts/EncryptionContext';

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'] as const;

export function useAutoLock() {
  const { phase, lockType, softLock, lock } = useEncryption();
  const isSoftLocked = lockType === 'soft';
  const isUnlocked = phase === 'unlocked';

  // Soft lock: visibilitychange
  useEffect(() => {
    if (!isUnlocked) return;

    const handleVisibilityChange = () => {
      if (document.hidden) softLock();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isUnlocked, softLock]);

  // Hard lock: inactivity timer
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!isUnlocked) return;

    const resetTimer = () => {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(lock, HARD_LOCK_MS);
    };

    resetTimer();

    for (const event of ACTIVITY_EVENTS) {
      document.addEventListener(event, resetTimer, { passive: true });
    }

    return () => {
      clearTimeout(timerRef.current);
      for (const event of ACTIVITY_EVENTS) {
        document.removeEventListener(event, resetTimer);
      }
    };
  }, [isUnlocked, lock]);

  // Hard lock: escalate soft lock after HARD_LOCK_MS (handles mobile PWA resume + foreground case)
  useEffect(() => {
    if (!isSoftLocked) return;

    const checkEscalation = () => {
      const ts = sessionStorage.getItem('softLockTs');
      if (ts && Date.now() - parseInt(ts, 10) > HARD_LOCK_MS) {
        lock();
      }
    };

    const timer = setTimeout(checkEscalation, HARD_LOCK_MS);

    const handleVisibilityChange = () => {
      if (!document.hidden) checkEscalation();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isSoftLocked, lock]);

  // Hard lock: sleep detection
  useEffect(() => {
    if (!isUnlocked) return;

    let lastTick = Date.now();
    const interval = setInterval(() => {
      const now = Date.now();
      if (now - lastTick > SLEEP_THRESHOLD_MS) {
        lock();
      }
      lastTick = now;
    }, SLEEP_CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isUnlocked, lock]);
}
