"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { useState, type ReactNode } from "react";
import { config } from "@/lib/config/wagmi";
import { NetworkGuard } from "@/components/layout/NetworkGuard";

import "@rainbow-me/rainbowkit/styles.css";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: "#fb923c",
            accentColorForeground: "black",
            borderRadius: "medium",
            overlayBlur: "small",
          })}
        >
          {children}
          <NetworkGuard />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
