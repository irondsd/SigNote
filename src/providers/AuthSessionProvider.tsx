'use client';

import type { FC, ReactNode } from 'react';
import { useEffect } from 'react';
import { SessionProvider, useSession } from 'next-auth/react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { clearDraft } from '@/lib/draft';
import { queryCacheStorage } from '@/lib/idb';

type AuthSessionProviderProps = {
  children: ReactNode;
};

function SessionCleanup() {
  const { status } = useSession();
  useEffect(() => {
    if (status === 'unauthenticated') {
      clearDraft();
      queryCacheStorage.removeItem('signote-query-cache');
    }
  }, [status]);
  return null;
}

export const AuthSessionProvider: FC<AuthSessionProviderProps> = ({ children }) => {
  const isOnline = useOnlineStatus();
  return (
    <SessionProvider refetchOnWindowFocus={isOnline}>
      <SessionCleanup />
      {children}
    </SessionProvider>
  );
};
