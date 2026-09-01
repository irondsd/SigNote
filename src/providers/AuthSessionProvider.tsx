'use client';

import type { FC, ReactNode } from 'react';
import { useEffect } from 'react';
import { SessionProvider, signOut, useSession } from 'next-auth/react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { queryCacheStorage } from '@/lib/idb';
import { clearDraft } from '@/lib/draft';
import { DesktopAuthCallbackHandler } from '@/components/DesktopAuthCallbackHandler/DesktopAuthCallbackHandler';

type AuthSessionProviderProps = {
  children: ReactNode;
};

function SessionCleanup() {
  const { status } = useSession();
  useEffect(() => {
    if (status === 'unauthenticated') {
      // The query cache is account data and must be removed on sign-out. Drafts
      // are recovery data, though: an expired session may be the very reason a
      // save failed, so deleting them here would turn an auth failure into data
      // loss. They are cleared only after a confirmed save or explicit discard.
      queryCacheStorage.removeItem('signote-query-cache');
    }
  }, [status]);
  useEffect(() => {
    const channel = new BroadcastChannel('signote-auth');
    channel.onmessage = (e) => {
      if (e.data?.type === 'logout') {
        if (e.data?.preserveDraft !== true) clearDraft();
        signOut({ redirect: false });
      }
    };
    return () => channel.close();
  }, []);
  return null;
}

export const AuthSessionProvider: FC<AuthSessionProviderProps> = ({ children }) => {
  const isOnline = useOnlineStatus();
  return (
    <SessionProvider refetchOnWindowFocus={isOnline}>
      <SessionCleanup />
      <DesktopAuthCallbackHandler />
      {children}
    </SessionProvider>
  );
};
