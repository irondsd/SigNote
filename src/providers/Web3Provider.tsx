'use client';

import { RainbowKitProvider, darkTheme, lightTheme } from '@rainbow-me/rainbowkit';
import type { FC, ReactNode } from 'react';
import { WagmiProvider } from 'wagmi';

import { config } from '@/config/wagmi';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

type Web3ProviderProps = {
  children: ReactNode;
};

const appInfo = { appName: 'Next Web3 Starter' };

export const Web3Provider: FC<Web3ProviderProps> = ({ children }) => {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const rkTheme = mounted && resolvedTheme === 'dark' ? darkTheme() : lightTheme();

  return (
    <WagmiProvider config={config}>
      <RainbowKitProvider appInfo={appInfo} theme={rkTheme}>
        {children}
      </RainbowKitProvider>
    </WagmiProvider>
  );
};
