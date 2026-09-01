'use client';

import { useEffect } from 'react';
import { useDisconnect } from 'wagmi';
import { onWalletDisconnectRequested } from '@/lib/walletEvents';

export function WalletSessionBridge() {
  const { disconnect } = useDisconnect();

  useEffect(() => onWalletDisconnectRequested(disconnect), [disconnect]);

  return null;
}
