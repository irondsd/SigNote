'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

/**
 * The keys an editor's attachments open with. `mek` reads vault-keyed files —
 * a Secret's, and a Seal's from before attachments were Seal-keyed. `seal` is
 * present only inside a Seal: its id, and its note key while the vault is
 * unlocked, for the files under that Seal's own key.
 */
export type FileKeys = {
  mek: CryptoKey | null;
  seal?: { id: string; noteKey: CryptoKey | null };
};

const FileEncryptionContext = createContext<FileKeys>({ mek: null });

export function FileEncryptionProvider({
  mek,
  seal,
  children,
}: FileKeys & {
  children: ReactNode;
}) {
  const sealId = seal?.id;
  const noteKey = seal?.noteKey ?? null;
  const value = useMemo(() => ({ mek, seal: sealId ? { id: sealId, noteKey } : undefined }), [mek, sealId, noteKey]);
  return <FileEncryptionContext.Provider value={value}>{children}</FileEncryptionContext.Provider>;
}

export function useFileEncryption() {
  return useContext(FileEncryptionContext);
}
