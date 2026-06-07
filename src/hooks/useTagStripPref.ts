'use client';

import { useCallback, useState } from 'react';

const KEY = 'signote:tagStripOpen';

/**
 * Whether the note-modal "Tags" strip starts open. The user's last choice is
 * remembered in localStorage and reused across modals; `fallback` only applies
 * the very first time, before any toggle has been stored.
 */
export function useTagStripPref(fallback: boolean) {
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return fallback;
    const stored = window.localStorage.getItem(KEY);
    return stored === null ? fallback : stored === 'true';
  });

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(KEY, String(next));
      } catch {
        // ignore storage failures (private mode, quota, etc.)
      }
      return next;
    });
  }, []);

  return { open, toggle };
}
