"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Navbar from "@/components/root/navbar";
import { Toaster } from "sonner";

const emptySubscribe = () => () => {};
const Providers = dynamic(() => import("@/providers").then((mod) => mod.Providers), {
  ssr: false,
});

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
      <Navbar />
      <main>{children}</main>
      <Toaster
        theme="light"
        position="bottom-right"
        toastOptions={{
          style: {
            background: "#ffffff",
            border: "0.5px solid #e4e4e7",
            color: "#09090b",
            fontFamily: "var(--font-dm-sans), 'DM Sans', sans-serif",
            borderRadius: "8px",
          },
        }}
      />
    </Providers>
  );
}
