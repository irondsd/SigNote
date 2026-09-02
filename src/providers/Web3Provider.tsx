'use client';

import { RainbowKitProvider, darkTheme, lightTheme } from '@rainbow-me/rainbowkit';
import type { FC, ReactNode } from 'react';
import { WagmiProvider } from 'wagmi';

import { getWalletConfig, walletAppUrl } from '@/config/wagmi';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { WalletSessionBridge } from '@/providers/WalletSessionBridge';

type Web3ProviderProps = {
  children: ReactNode;
  desktop?: boolean;
};

const appInfo = { appName: 'SigNote', learnMoreUrl: `${walletAppUrl}/docs/about` };

export const Web3Provider: FC<Web3ProviderProps> = ({ children, desktop = false }) => {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const rkTheme = mounted && resolvedTheme === 'dark' ? darkTheme() : lightTheme();
  const config = getWalletConfig(desktop);

  return (
    <WagmiProvider config={config}>
      <RainbowKitProvider appInfo={appInfo} theme={rkTheme}>
        <WalletSessionBridge />
        {children}
      </RainbowKitProvider>
    </WagmiProvider>
  );
};
