import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http } from "wagmi";
import { bscTestnet, BSC_TESTNET_RPC_URL } from "@/lib/protocol/chain";

// RainbowKit requires a non-empty WalletConnect projectId at config time.
// Without one, injected wallets (MetaMask, Rabby, ...) still work fine —
// only WalletConnect-protocol wallets need a real id. Set
// NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID in .env.local for those.
const wcProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "sats-options-dev-placeholder";

export const config = getDefaultConfig({
  appName: "sats-options",
  projectId: wcProjectId,
  chains: [bscTestnet],
  transports: {
    [bscTestnet.id]: http(BSC_TESTNET_RPC_URL),
  },
  ssr: true,
});
