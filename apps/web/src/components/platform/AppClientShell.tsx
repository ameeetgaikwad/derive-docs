"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { Toaster } from "sonner";
import { Providers } from "@/providers";
import { AppShell } from "./AppShell";

const emptySubscribe = () => () => {};

export function AppClientShell({ children }: { children: ReactNode }) {
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);

  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="flex items-center gap-3 text-zinc-500">
          <span className="size-2 animate-pulse rounded-full bg-orange-500" />
          <span className="font-mono text-xs uppercase tracking-[0.16em]">Opening Hedge</span>
        </div>
      </div>
    );
  }

  return (
    <Providers>
      <AppShell>{children}</AppShell>
      <Toaster
        theme="light"
        position="bottom-right"
        toastOptions={{
          style: {
            background: "#ffffff",
            border: "0.5px solid #e4e4e7",
            color: "#09090b",
            fontFamily: "var(--font-dm-sans), 'DM Sans', sans-serif",
            borderRadius: "5px",
          },
        }}
      />
    </Providers>
  );
}
