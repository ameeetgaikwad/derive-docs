import { defineChain } from "viem";

export const BSC_TESTNET_RPC_URL =
  process.env.NEXT_PUBLIC_BSC_TESTNET_RPC_URL ??
  "https://bsc-testnet.bnbchain.org";

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

export const TBNB_FAUCET_URL = "https://www.bnbchain.org/en/testnet-faucet";
