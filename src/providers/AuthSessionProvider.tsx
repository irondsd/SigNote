'use client';

import type { FC, ReactNode } from 'react';
import { SessionProvider } from 'next-auth/react';

type AuthSessionProviderProps = {
  children: ReactNode;
};

export const AuthSessionProvider: FC<AuthSessionProviderProps> = ({ children }) => {
  // refetchOnWindowFocus:false prevents session re-checks on tab focus,
  // which would fail (and drop the session) when the user is offline.
  // todo: check if we can make it conditional based on online status, to allow session refreshing when online.
  return <SessionProvider refetchOnWindowFocus={false}>{children}</SessionProvider>;
};
