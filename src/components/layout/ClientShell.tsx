"use client";

import { useState, useEffect, type ReactNode } from "react";
import { Providers } from "@/providers";
import { Header } from "@/components/layout/Header";
import { Toaster } from "sonner";

export function ClientShell({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Prevent SSR of wallet-connect-dependent code entirely
  if (!mounted) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6">
        {children}
      </div>
    );
  }

  return (
    <Providers>
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
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
