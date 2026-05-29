'use client';

import { useCallback, useEffect, useState } from 'react';

const KEY = 'sn-recent-searches';
const MAX = 8;

function readFromStorage(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function useRecentSearches() {
  const [recents, setRecents] = useState<string[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initialising from localStorage after mount
    setRecents(readFromStorage());
  }, []);

  const save = useCallback((query: string) => {
    const q = query.trim();
    if (!q) return;
    setRecents((prev) => {
      const next = [q, ...prev.filter((r) => r !== q)].slice(0, MAX);
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // storage unavailable
      }
      return next;
    });
  }, []);

  return { recents, save };
}
