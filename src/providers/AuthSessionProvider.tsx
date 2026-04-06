'use client';

import type { FC, ReactNode } from 'react';
import { SessionProvider } from 'next-auth/react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

type AuthSessionProviderProps = {
  children: ReactNode;
};

export const AuthSessionProvider: FC<AuthSessionProviderProps> = ({ children }) => {
  const isOnline = useOnlineStatus();
  return <SessionProvider refetchOnWindowFocus={isOnline}>{children}</SessionProvider>;
};
