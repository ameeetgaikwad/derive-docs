import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { deriveMainnet, deriveTestnet } from "@/lib/chain/derive";
import { mainnet, arbitrum, base, optimism } from "wagmi/chains";
import { http, fallback } from "wagmi";

const deriveEnv = process.env.NEXT_PUBLIC_DERIVE_ENV ?? "mainnet";
const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

// WalletConnect RPC proxy — reliable, keyed to project
const wcRpc = (chainId: number) =>
  http(`https://rpc.walletconnect.org/v1/?chainId=eip155:${chainId}&projectId=${wcProjectId}`);

export const config = getDefaultConfig({
  appName: "Hedge",
  projectId: wcProjectId,
  chains: [
    deriveEnv === "testnet" ? deriveTestnet : deriveMainnet,
    mainnet,
    arbitrum,
    base,
    optimism,
  ],
  transports: {
    [deriveEnv === "testnet" ? deriveTestnet.id : deriveMainnet.id]: http(),
    [mainnet.id]: fallback([
      wcRpc(1),
      http("https://eth.llamarpc.com"),
      http("https://rpc.ankr.com/eth"),
      http("https://cloudflare-eth.com"),
    ]),
    [arbitrum.id]: fallback([
      wcRpc(42161),
      http("https://arb1.arbitrum.io/rpc"),
      http("https://rpc.ankr.com/arbitrum"),
    ]),
    [base.id]: fallback([
      wcRpc(8453),
      http("https://mainnet.base.org"),
      http("https://rpc.ankr.com/base"),
    ]),
    [optimism.id]: fallback([
      wcRpc(10),
      http("https://mainnet.optimism.io"),
      http("https://rpc.ankr.com/optimism"),
    ]),
  },
  ssr: true,
});
