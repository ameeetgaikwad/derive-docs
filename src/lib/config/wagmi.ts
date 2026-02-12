import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { deriveMainnet, deriveTestnet } from "@/lib/chain/derive";
import { mainnet, arbitrum } from "wagmi/chains";

const deriveEnv = process.env.NEXT_PUBLIC_DERIVE_ENV ?? "mainnet";

export const config = getDefaultConfig({
  appName: "Strikely",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "",
  chains: [
    deriveEnv === "testnet" ? deriveTestnet : deriveMainnet,
    mainnet,
    arbitrum,
  ],
  ssr: true,
});
