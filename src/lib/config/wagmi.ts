import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http } from "wagmi";
import {
  bscMainnet,
  bscTestnet,
  BSC_MAINNET_RPC_URL,
  BSC_TESTNET_RPC_URL,
} from "@/lib/protocol/chain";

// RainbowKit requires a non-empty WalletConnect projectId at config time.
// Without one, injected wallets (MetaMask, Rabby, ...) still work fine —
// only WalletConnect-protocol wallets need a real id. Set
// NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID in .env.local for those.
const wcProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "sats-options-dev-placeholder";

// Both BSC networks are configured so the app can switch at runtime. The
// wallet is prompted to switch to whichever the user selects in the header.
export const config = getDefaultConfig({
  appName: "Hedge",
  projectId: wcProjectId,
  chains: [bscTestnet, bscMainnet],
  transports: {
    [bscTestnet.id]: http(BSC_TESTNET_RPC_URL),
    [bscMainnet.id]: http(BSC_MAINNET_RPC_URL),
  },
  ssr: true,
});
