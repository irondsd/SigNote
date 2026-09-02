'use client';

import { getDefaultConfig, getDefaultWallets } from '@rainbow-me/rainbowkit';
import { injectedWallet, walletConnectWallet } from '@rainbow-me/rainbowkit/wallets';
import { server } from './server';

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID as string;
export const walletAppUrl = typeof window === 'undefined' ? 'https://signote.app' : window.location.origin;

const walletConnectParams = {
  appName: 'SigNote',
  projectId: walletConnectProjectId,
};
const { wallets } = getDefaultWallets(walletConnectParams);

const metadata = {
  projectId: walletConnectProjectId,
  appName: 'SigNote',
  appDescription: 'Secure notes with privacy-first sign-in.',
  appUrl: walletAppUrl,
  appIcon: `${walletAppUrl}/web-app-manifest-512x512.png`,
};

export const webConfig = getDefaultConfig({
  ...server,
  ...metadata,
  wallets: [
    ...wallets,
    // Required by browser E2E tests and useful when an extension injects
    // window.ethereum into the ordinary web application.
    { groupName: 'Other', wallets: [injectedWallet] },
  ],
});

export const desktopConfig = getDefaultConfig({
  ...server,
  ...metadata,
  // Electron has no supported extension surface. The generic WalletConnect
  // connector deliberately exposes only the QR-compatible transport.
  wallets: [{ groupName: 'Mobile wallets', wallets: [walletConnectWallet] }],
});

// Backwards-compatible export for callers that mean the normal web config.
export const config = webConfig;
