'use client';

import { useEffect, useState, type FC, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { useDesktopApp } from '@/hooks/useDesktopApp';

const Web3Provider = dynamic(() => import('@/providers/Web3Provider').then((m) => m.Web3Provider), { ssr: false });

export const Web3ProviderLazy: FC<{ children: ReactNode }> = ({ children }) => {
  const isDesktop = useDesktopApp();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Keep the server and first client render provider-free. The preload bridge
    // can then select the desktop config without creating a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted) return children;
  return <Web3Provider desktop={isDesktop}>{children}</Web3Provider>;
};
