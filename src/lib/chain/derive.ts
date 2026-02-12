import { defineChain } from "viem";

export const deriveMainnet = defineChain({
  id: 957,
  name: "Derive",
  nativeCurrency: {
    decimals: 18,
    name: "Ether",
    symbol: "ETH",
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.lyra.finance"],
      webSocket: ["wss://rpc.lyra.finance"],
    },
  },
  blockExplorers: {
    default: {
      name: "Derive Explorer",
      url: "https://explorer.lyra.finance",
    },
  },
});

export const deriveTestnet = defineChain({
  id: 901,
  name: "Derive Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "Ether",
    symbol: "ETH",
  },
  rpcUrls: {
    default: {
      http: ["https://rpc-prod-testnet-0eakp60405.t.conduit.xyz"],
      webSocket: ["wss://rpc-prod-testnet-0eakp60405.t.conduit.xyz"],
    },
  },
  blockExplorers: {
    default: {
      name: "Derive Testnet Explorer",
      url: "https://explorer-testnet.lyra.finance",
    },
  },
  testnet: true,
});

export function getDeriveChain(env: "testnet" | "mainnet") {
  return env === "testnet" ? deriveTestnet : deriveMainnet;
}
