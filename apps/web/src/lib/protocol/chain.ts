import { defineChain, type Chain } from "viem";
import type { AppChainId } from "@/stores/network";

export const BSC_TESTNET_RPC_URL =
  process.env.NEXT_PUBLIC_BSC_TESTNET_RPC_URL ??
  "https://bsc-testnet.bnbchain.org";

export const BSC_MAINNET_RPC_URL =
  process.env.NEXT_PUBLIC_BSC_MAINNET_RPC_URL ?? "https://bsc-dataseed.bnbchain.org";

/**
 * BSC testnet (chainId 97). Defined locally (instead of wagmi/chains) so the
 * default RPC is our configured endpoint — the public BSC testnet RPCs are
 * flaky (see protocol/TESTNET.md), so the URL is env-overridable.
 */
export const bscTestnet = defineChain({
  id: 97,
  name: "BSC Testnet",
  nativeCurrency: { decimals: 18, name: "tBNB", symbol: "tBNB" },
  rpcUrls: {
    default: { http: [BSC_TESTNET_RPC_URL] },
  },
  blockExplorers: {
    default: { name: "BscScan Testnet", url: "https://testnet.bscscan.com" },
  },
  contracts: {
    multicall3: {
      address: "0xca11bde05977b3631167028862be2a173976ca11",
      blockCreated: 17422483,
    },
  },
  testnet: true,
});

/** BSC mainnet (chainId 56). */
export const bscMainnet = defineChain({
  id: 56,
  name: "BNB Smart Chain",
  nativeCurrency: { decimals: 18, name: "BNB", symbol: "BNB" },
  rpcUrls: {
    default: { http: [BSC_MAINNET_RPC_URL] },
  },
  blockExplorers: {
    default: { name: "BscScan", url: "https://bscscan.com" },
  },
  contracts: {
    multicall3: {
      address: "0xca11bde05977b3631167028862be2a173976ca11",
      blockCreated: 15921452,
    },
  },
  testnet: false,
});

export type AppChain = typeof bscTestnet | typeof bscMainnet;

/** The two chains the app supports, in the wagmi transports order. */
export const APP_CHAINS: readonly [Chain, ...Chain[]] = [bscTestnet, bscMainnet];

export function getAppChain(chainId: AppChainId): AppChain {
  return chainId === 56 ? bscMainnet : bscTestnet;
}

/** Human label for a network. */
export function networkLabel(chainId: AppChainId): string {
  return chainId === 56 ? "Mainnet" : "Testnet";
}

export const TBNB_FAUCET_URL = "https://www.bnbchain.org/en/testnet-faucet";
