'use client';

import { connectorsForWallets, getDefaultConfig, getDefaultWallets } from '@rainbow-me/rainbowkit';
import { injectedWallet } from '@rainbow-me/rainbowkit/wallets';
import { server } from './server';

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID as string;

// this function has to be called on the client
const walletConnectParams = {
  appName: 'Next Web3 Starter',
  projectId: walletConnectProjectId,
};
const { wallets } = getDefaultWallets(walletConnectParams);
const connectors = connectorsForWallets(
  [
    ...wallets,
    // Injected wallet uses window.ethereum directly — needed for e2e tests
    // with mock provider (the MetaMask option uses @metamask/sdk instead)
    { groupName: 'Other', wallets: [injectedWallet] },
  ],
  walletConnectParams,
);

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
