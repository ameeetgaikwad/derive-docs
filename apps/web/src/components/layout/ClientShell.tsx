"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { Providers } from "@/providers";
import { Header } from "@/components/layout/Header";
import { Toaster } from "sonner";

const emptySubscribe = () => () => {};

export function ClientShell({ children }: { children: ReactNode }) {
  // true on the client after hydration, false during SSR/prerender
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  // Prevent SSR/prerender of wallet-dependent code entirely: the whole app
  // needs WagmiProvider, so render nothing until mounted on the client.
  if (!mounted) {
    return <main className="min-h-screen bg-background" />;
  }

  return (
    <Providers>
      <Header />
      <main>{children}</main>
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: {
            background: "#18181b",
            border: "0.5px solid #3f3f46",
            color: "#fafafa",
            fontFamily: "var(--font-dm-sans), 'DM Sans', sans-serif",
            borderRadius: "10px",
          },
        }}
      />
    </Providers>
  );
}
