'use client';

import { getDefaultConfig, getDefaultWallets } from '@rainbow-me/rainbowkit';
import { injectedWallet, walletConnectWallet } from '@rainbow-me/rainbowkit/wallets';
import { server } from './server';

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID as string;
export const walletAppUrl = typeof window === 'undefined' ? 'https://signote.tech' : window.location.origin;

const walletConnectParams = {
  appName: 'SigNote',
  projectId: walletConnectProjectId,
};

const metadata = {
  projectId: walletConnectProjectId,
  appName: 'SigNote',
  appDescription: 'Secure notes with privacy-first sign-in.',
  appUrl: walletAppUrl,
  appIcon: `${walletAppUrl}/web-app-manifest-512x512.png`,
};

function createWebConfig() {
  const { wallets } = getDefaultWallets(walletConnectParams);
  return getDefaultConfig({
    ...server,
    ...metadata,
    wallets: [
      ...wallets,
      // Required by browser E2E tests and useful when an extension injects
      // window.ethereum into the ordinary web application.
      { groupName: 'Other', wallets: [injectedWallet] },
    ],
  });
}

function createDesktopConfig() {
  return getDefaultConfig({
    ...server,
    ...metadata,
    // Electron has no supported extension surface. The generic WalletConnect
    // connector deliberately exposes only the QR-compatible transport.
    wallets: [{ groupName: 'Mobile wallets', wallets: [walletConnectWallet] }],
  });
}

type WalletConfig = ReturnType<typeof createWebConfig>;

let webConfig: WalletConfig | undefined;
let desktopConfig: WalletConfig | undefined;

/**
 * Construct only the connector graph used by the current runtime. Creating
 * both Wagmi configs eagerly makes their WalletConnect connectors share
 * storage and process the same proposal/session events twice.
 */
export function getWalletConfig(desktop: boolean): WalletConfig {
  if (desktop) {
    desktopConfig ??= createDesktopConfig();
    return desktopConfig;
  }

  webConfig ??= createWebConfig();
  return webConfig;
}
