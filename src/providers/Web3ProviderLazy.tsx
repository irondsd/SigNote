'use client';

import type { FC, ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { useDesktopApp } from '@/hooks/useDesktopApp';

const Web3Provider = dynamic(() => import('@/providers/Web3Provider').then((m) => m.Web3Provider), { ssr: false });

export const Web3ProviderLazy: FC<{ children: ReactNode }> = ({ children }) => {
  const isDesktop = useDesktopApp();
  if (isDesktop) return children;
  return <Web3Provider>{children}</Web3Provider>;
};
