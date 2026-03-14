'use client';

import type { FC, ReactNode } from 'react';
import { SessionProvider } from 'next-auth/react';

type AuthSessionProviderProps = {
  children: ReactNode;
};

export const AuthSessionProvider: FC<AuthSessionProviderProps> = ({ children }) => {
  return <SessionProvider>{children}</SessionProvider>;
};
