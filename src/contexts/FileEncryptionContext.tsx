'use client';

import { createContext, useContext, type ReactNode } from 'react';

type FileEncryptionContextValue = {
  mek: CryptoKey | null;
};

const FileEncryptionContext = createContext<FileEncryptionContextValue>({ mek: null });

export function FileEncryptionProvider({
  mek,
  children,
}: {
  mek: CryptoKey | null;
  children: ReactNode;
}) {
  return <FileEncryptionContext.Provider value={{ mek }}>{children}</FileEncryptionContext.Provider>;
}

export function useFileEncryption() {
  return useContext(FileEncryptionContext);
}
