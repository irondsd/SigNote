import type { Config } from 'wagmi';
import { http, createConfig } from 'wagmi';
import { mainnet } from 'wagmi/chains';

const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;

export const server = {
  chains: [mainnet],
  transports: {
    [mainnet.id]: http(`https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`),
  },
  ssr: false,
} as const;

export const serverConfig: Config = createConfig(server);
