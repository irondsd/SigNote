'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

type DraftRestoreData = { title: string; content: string };

const DraftRestoreContext = createContext<{
  draftRestore: DraftRestoreData | null;
  setDraftRestore: (data: DraftRestoreData | null) => void;
}>({ draftRestore: null, setDraftRestore: () => {} });

export function DraftRestoreProvider({ children }: { children: ReactNode }) {
  const [draftRestore, setDraftRestore] = useState<DraftRestoreData | null>(null);
  return (
    <DraftRestoreContext.Provider value={{ draftRestore, setDraftRestore }}>
      {children}
    </DraftRestoreContext.Provider>
  );
}

export function useDraftRestore() {
  return useContext(DraftRestoreContext);
}
