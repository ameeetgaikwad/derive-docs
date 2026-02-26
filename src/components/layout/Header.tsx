"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { cn } from "@/lib/utils";
import { AccountStatus } from "@/components/account/AccountStatus";
import { HedgeLogo } from "@/components/ui/HedgeLogo";

const navLinks = [
  { href: "/trade", label: "trade" },
  { href: "/markets", label: "markets" },
  { href: "/strategies", label: "strategies" },
  { href: "/portfolio", label: "portfolio" },
];

export function Header() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-card">
      <div className="mx-auto flex h-12 max-w-7xl items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2">
            <HedgeLogo size={22} />
            <span className="font-mono text-sm font-bold text-foreground">
              Hedge
            </span>
          </Link>
          {process.env.NEXT_PUBLIC_DERIVE_ENV === "testnet" && (
            <span className="rounded border border-warning/50 bg-warning/10 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-warning">
              testnet
            </span>
          )}

          <div className="hidden h-4 w-px bg-border md:block" />

          <nav className="hidden items-center gap-1 md:flex">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "rounded-md px-3 py-1.5 font-mono text-xs transition-colors",
                  pathname === link.href
                    ? "font-bold text-accent"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <AccountStatus />
          <ConnectButton
            showBalance={false}
            chainStatus="icon"
            accountStatus="address"
          />
          <button
            className="md:hidden rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
              {mobileOpen ? (
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              ) : (
                <path
                  fillRule="evenodd"
                  d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"
                  clipRule="evenodd"
                />
              )}
            </svg>
          </button>
        </div>
      </div>
      {mobileOpen && (
        <nav className="border-t border-border bg-card px-4 py-2 md:hidden">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "block px-3 py-2 font-mono text-xs transition-colors",
                pathname === link.href
                  ? "font-bold text-accent"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
