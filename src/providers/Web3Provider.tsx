'use client';

import { RainbowKitProvider, darkTheme, lightTheme } from '@rainbow-me/rainbowkit';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import type { FC, ReactNode } from 'react';
import { WagmiProvider } from 'wagmi';

import { config } from '@/config/wagmi';
import { getQueryClient } from '@/utils/getQueryClient';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

type WagmiProviderProps = {
  children: ReactNode;
};

const appInfo = { appName: 'Next Web3 Starter' };

export const Web3Provider: FC<WagmiProviderProps> = ({ children }) => {
  const queryClient = getQueryClient();
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const rkTheme = mounted && resolvedTheme === 'dark' ? darkTheme() : lightTheme();

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider appInfo={appInfo} theme={rkTheme}>
          {children}
        </RainbowKitProvider>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </WagmiProvider>
  );
};
