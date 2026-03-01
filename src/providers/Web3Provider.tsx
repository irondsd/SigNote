"use client";

import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import type { FC, ReactNode } from "react";
import { WagmiProvider } from "wagmi";

import { config } from "@/config/wagmi";
import { getQueryClient } from "@/utils/getQueryClient";

type WagmiProviderProps = {
  children: ReactNode;
};

const appInfo = { appName: "Next Web3 Starter" };

export const Web3Provider: FC<WagmiProviderProps> = ({ children }) => {
  const queryClient = getQueryClient();

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider appInfo={appInfo} theme={darkTheme()}>
          {children}
        </RainbowKitProvider>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </WagmiProvider>
  );
};
