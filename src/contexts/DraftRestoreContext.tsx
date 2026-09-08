'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

import type { StoredDraft } from '@/lib/draft';

// The envelope, not the plaintext: the toast that fills this in lives outside
// `EncryptionProvider` and has no key. Whoever opens the editor decrypts.
type DraftRestoreData = StoredDraft;

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
