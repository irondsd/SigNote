'use client';

import { useEffect, useRef } from 'react';
import { useEncryption } from '@/contexts/EncryptionContext';

const HARD_LOCK_MS = 5 * 60 * 1000; // 5 minutes
const SLEEP_CHECK_INTERVAL_MS = 10_000; // 10 seconds
const SLEEP_THRESHOLD_MS = 30_000; // 30 seconds gap = sleep detected

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'] as const;

export function useAutoLock() {
  const { phase, softLock, lock } = useEncryption();
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
