"use client";

import {
  RainbowKitProvider,
  getDefaultConfig,
  lightTheme,
} from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@rainbow-me/rainbowkit/styles.css";
import { deriveChain } from "@/lib/derive/constants";

const config = getDefaultConfig({
  appName: "Axiom",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "demo",
  chains: [deriveChain],
  ssr: true,
});

const queryClient = new QueryClient();

const customTheme = lightTheme({
  accentColor: "#1a1a1a",
  accentColorForeground: "#ffffff",
  borderRadius: "medium",
  fontStack: "system",
  overlayBlur: "small",
});

// Override specific theme tokens to match Rysk's cream aesthetic
customTheme.colors.modalBackground = "#ffffff";
customTheme.colors.modalBorder = "#d4cfc6";
customTheme.colors.profileForeground = "#f8f5f0";
customTheme.colors.actionButtonBorder = "#d4cfc6";
customTheme.colors.actionButtonSecondaryBackground = "#f0ebe3";
customTheme.colors.menuItemBackground = "#f0ebe3";
customTheme.colors.generalBorder = "#d4cfc6";
customTheme.colors.generalBorderDim = "#e5dfd6";
customTheme.colors.connectButtonBackground = "#ffffff";
customTheme.colors.connectButtonInnerBackground = "#f0ebe3";
customTheme.colors.closeButton = "#6b6560";
customTheme.colors.closeButtonBackground = "#e5dfd6";
customTheme.fonts.body = '"SF Mono", "Fira Code", "Fira Mono", "Roboto Mono", monospace';

export default function WalletProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={customTheme}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
