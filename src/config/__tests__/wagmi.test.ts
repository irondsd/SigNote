const mockGetDefaultConfig = jest.fn((options: unknown) => ({ options }));
const mockGetDefaultWallets = jest.fn(() => ({
  wallets: [{ groupName: 'Web wallets', wallets: [jest.fn()] }],
}));
const mockInjectedWallet = jest.fn();
const mockWalletConnectWallet = jest.fn();

jest.mock('@rainbow-me/rainbowkit', () => ({
  getDefaultConfig: mockGetDefaultConfig,
  getDefaultWallets: mockGetDefaultWallets,
}));

jest.mock('@rainbow-me/rainbowkit/wallets', () => ({
  injectedWallet: mockInjectedWallet,
  walletConnectWallet: mockWalletConnectWallet,
}));

jest.mock('@/config/server', () => ({
  server: {
    chains: [{ id: 1 }],
    transports: { 1: jest.fn() },
    ssr: true,
  },
}));

import { getWalletConfig } from '@/config/wagmi';

describe('getWalletConfig', () => {
  it('constructs only one cached desktop connector graph', () => {
    expect(mockGetDefaultConfig).not.toHaveBeenCalled();
    expect(mockGetDefaultWallets).not.toHaveBeenCalled();

    const first = getWalletConfig(true);
    const second = getWalletConfig(true);

    expect(first).toBe(second);
    expect(mockGetDefaultConfig).toHaveBeenCalledTimes(1);
    expect(mockGetDefaultWallets).not.toHaveBeenCalled();
    expect(mockGetDefaultConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        wallets: [{ groupName: 'Mobile wallets', wallets: [mockWalletConnectWallet] }],
      }),
    );
  });
});
