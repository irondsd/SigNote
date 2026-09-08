'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

import type { DraftContent } from '@/lib/draft';

type DraftRestoreData = DraftContent;

const DraftRestoreContext = createContext<{
  draftRestore: DraftRestoreData | null;
  setDraftRestore: (data: DraftRestoreData | null) => void;
}>({ draftRestore: null, setDraftRestore: () => {} });

export function DraftRestoreProvider({ children }: { children: ReactNode }) {
  const [draftRestore, setDraftRestore] = useState<DraftRestoreData | null>(null);
  return (
    <DraftRestoreContext.Provider value={{ draftRestore, setDraftRestore }}>{children}</DraftRestoreContext.Provider>
  );
}

export function useDraftRestore() {
  return useContext(DraftRestoreContext);
}
