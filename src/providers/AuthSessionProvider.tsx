'use client';

import type { FC, ReactNode } from 'react';
import { useEffect } from 'react';
import { SessionProvider, signOut, useSession } from 'next-auth/react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { queryCacheStorage } from '@/lib/idb';
import { clearDraft } from '@/lib/draft';
import { DesktopAuthCallbackHandler } from '@/components/DesktopAuthCallbackHandler/DesktopAuthCallbackHandler';
import { rememberLastSignInMethod } from '@/lib/lastSignInMethod';
import { removeAllVaults } from '@/lib/otpStore';

type AuthSessionProviderProps = {
  children: ReactNode;
};

/**
 * The service worker's runtime caches are account data too: `apis` holds every
 * tRPC GET it has seen — note bodies, and the `serverShare` half of the
 * encryption key — and they outlive the credentials that fetched them, so a
 * signed-out device still answered those reads from disk.
 *
 * The precache is exempt: it is the static app shell, identical for everyone.
 */
async function purgeAccountCaches(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => !name.startsWith('serwist-precache')).map((name) => caches.delete(name)));
  } catch {
    // Storage can be unavailable (private mode, blocked site data); sign-out
    // must complete regardless.
  }
}

function SessionCleanup() {
  const { data: session, status } = useSession();
  useEffect(() => {
    if (status === 'authenticated' && session?.authProvider) {
      rememberLastSignInMethod(session.authProvider);
    }
  }, [session?.authProvider, status]);
  useEffect(() => {
    if (status === 'unauthenticated') {
      // Account data must be removed once sign-out is confirmed. The service
      // worker supplies the cached authenticated session when the network is
      // unavailable, so ordinary offline use does not enter this branch.
      queryCacheStorage.removeItem('signote-query-cache');
      void removeAllVaults().catch(() => undefined);
      void purgeAccountCaches();

      // Drafts are recovery data, though: an expired session may be the very
      // reason a save failed, so deleting them here would turn an auth failure
      // into data loss. They are cleared only after a confirmed save or
      // explicit discard.
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
