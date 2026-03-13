'use client';

import { connectorsForWallets, getDefaultConfig, getDefaultWallets } from '@rainbow-me/rainbowkit';

import { server } from './server';

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID as string;

// this function has to be called on the client
const walletConnectParams = {
  appName: 'Next Web3 Starter',
  projectId: walletConnectProjectId,
};
const { wallets } = getDefaultWallets(walletConnectParams);
const connectors = connectorsForWallets([...wallets], walletConnectParams);

// extend server wagmi config with connectors on the client
const wagmiConfig = {
  ...server,
  connectors,
};

export const config = getDefaultConfig({
  ...wagmiConfig,
  projectId: walletConnectProjectId,
  appName: 'Next Web3 Starter',
  appDescription: '',
  appUrl: 'https://whatever.com',
  appIcon: '',
});
