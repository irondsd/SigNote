import type { Config } from 'wagmi';
import { http, createConfig } from 'wagmi';
import { mainnet } from 'wagmi/chains';

const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;

export const server = {
  chains: [mainnet],
  transports: {
    [mainnet.id]: http(rpcUrl),
  },
  ssr: true,
} as const;

export const serverConfig: Config = createConfig(server);
