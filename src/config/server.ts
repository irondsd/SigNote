import type { Config } from "wagmi";
import { http, createConfig } from "wagmi";
import { bsc } from "wagmi/chains";

const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;

export const server = {
  chains: [bsc],
  transports: {
    [bsc.id]: http(`https://bnb-mainnet.g.alchemy.com/v2/${alchemyKey}`),
  },
  ssr: false,
} as const;

export const serverConfig: Config = createConfig(server);
