'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

type SearchPaletteContextValue = {
  isOpen: boolean;
  query: string;
  open: (initial?: string) => void;
  close: () => void;
  setQuery: (q: string) => void;
};

const SearchPaletteContext = createContext<SearchPaletteContextValue | null>(null);

export function SearchPaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQueryState] = useState('');
  const pathname = usePathname();

  const open = useCallback((initial?: string) => {
    if (initial !== undefined) setQueryState(initial);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setQueryState('');
  }, []);

  const setQuery = useCallback((q: string) => setQueryState(q), []);

  const prevPathnameRef = useRef(pathname);
  useEffect(() => {
    if (prevPathnameRef.current !== pathname) {
      prevPathnameRef.current = pathname;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- closing palette on route change is intentional
      setIsOpen(false);
      setQueryState('');
    }
  }, [pathname]);

  const value = useMemo(() => ({ isOpen, query, open, close, setQuery }), [isOpen, query, open, close, setQuery]);

  return <SearchPaletteContext.Provider value={value}>{children}</SearchPaletteContext.Provider>;
}

export function useSearchPalette(): SearchPaletteContextValue {
  const ctx = useContext(SearchPaletteContext);
  if (!ctx) throw new Error('useSearchPalette must be used within SearchPaletteProvider');
  return ctx;
}
