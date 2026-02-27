"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useDisconnect } from "wagmi";
import { cn } from "@/lib/utils";
import { useDerive } from "@/providers/DeriveProvider";
import { useCollaterals } from "@/hooks/portfolio/useCollaterals";
import { HedgeLogo } from "@/components/ui/HedgeLogo";
import { TokenIcon } from "@/components/ui/TokenIcon";
import { FundsModal } from "@/components/portfolio/FundsModal";

const navLinks = [
  { href: "/trade", label: "Trade" },
  { href: "/portfolio", label: "Portfolio" },
];

export function Header() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [fundsTab, setFundsTab] = useState<"deposit" | "withdraw" | "bridge" | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { isAuthenticated, subaccountId } = useDerive();
  const { data: collaterals = [] } = useCollaterals();
  const { disconnect } = useDisconnect();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setWalletOpen(false);
      }
    }
    if (walletOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [walletOpen]);

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-border bg-card">
        <div className="mx-auto flex h-12 max-w-7xl items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center">
              <HedgeLogo size={18} className="text-foreground" />
            </Link>
            {process.env.NEXT_PUBLIC_DERIVE_ENV === "testnet" && (
              <span className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-accent">
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
                    "rounded-md px-3 py-1.5 text-xs transition-colors",
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
            <ConnectButton.Custom>
              {({ account, chain, openConnectModal, mounted }) => {
                const connected = mounted && account && chain;
                return (
                  <div className="relative" ref={dropdownRef}>
                    <button
                      onClick={connected ? () => setWalletOpen(!walletOpen) : openConnectModal}
                      className={cn(
                        "rounded-md border-[0.5px] px-3 py-1.5 text-xs font-medium transition-colors",
                        connected
                          ? "border-border bg-background text-foreground"
                          : "border-accent bg-accent/10 text-accent"
                      )}
                    >
                      {connected
                        ? `${account.address.slice(0, 6)}...${account.address.slice(-4)}`
                        : "Connect Wallet"}
                    </button>

                    {connected && walletOpen && (
                      <div className="absolute right-0 top-full z-[100] mt-2 w-72 rounded-[10px] border-[0.5px] border-border bg-card p-4">
                        {/* Address + status */}
                        <div className="mb-3 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className={cn(
                              "h-2 w-2 rounded-full",
                              isAuthenticated ? "bg-success" : "bg-accent"
                            )} />
                            <span className="text-xs text-foreground">
                              {account.address.slice(0, 6)}...{account.address.slice(-4)}
                            </span>
                          </div>
                          {subaccountId && (
                            <span className="text-[10px] text-muted-foreground">
                              sub#{subaccountId}
                            </span>
                          )}
                        </div>

                        {/* Balances */}
                        {isAuthenticated && collaterals.length > 0 ? (
                          <div className="mb-3 space-y-1.5">
                            {collaterals.map((c) => (
                              <div key={c.asset_name} className="flex items-center justify-between text-xs">
                                <span className="flex items-center gap-2 text-secondary-foreground">
                                  <TokenIcon symbol={c.asset_name} size={16} />
                                  {c.asset_name}
                                </span>
                                <div>
                                  <span className="text-foreground">{parseFloat(c.amount).toFixed(4)}</span>
                                  {parseFloat(c.mark_value) > 0 && (
                                    <span className="ml-1.5 text-muted-foreground">
                                      ${parseFloat(c.mark_value).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : isAuthenticated ? (
                          <div className="mb-3 py-2 text-center text-xs text-muted-foreground">
                            No balances yet
                          </div>
                        ) : null}

                        {/* Action buttons */}
                        {isAuthenticated && (
                          <div className="mb-3 grid grid-cols-3 gap-1.5">
                            <button
                              onClick={() => { setFundsTab("deposit"); setWalletOpen(false); }}
                              className="rounded-md border border-accent/20 bg-accent/10 py-1.5 text-[10px] font-semibold text-accent transition-colors"
                            >
                              Deposit
                            </button>
                            <button
                              onClick={() => { setFundsTab("withdraw"); setWalletOpen(false); }}
                              className="rounded-md border border-secondary-foreground/20 bg-secondary-foreground/10 py-1.5 text-[10px] font-semibold text-secondary-foreground transition-colors"
                            >
                              Withdraw
                            </button>
                            <button
                              onClick={() => { setFundsTab("bridge"); setWalletOpen(false); }}
                              className="rounded-md border border-blue-500/20 bg-blue-500/10 py-1.5 text-[10px] font-semibold text-blue-500 transition-colors"
                            >
                              Bridge
                            </button>
                          </div>
                        )}

                        {/* Divider + Disconnect */}
                        <div className="border-t border-border pt-2">
                          <button
                            onClick={() => { disconnect(); setWalletOpen(false); }}
                            className="w-full rounded-md py-1.5 text-[10px] font-medium text-destructive transition-colors"
                          >
                            Disconnect
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              }}
            </ConnectButton.Custom>
            <button
              className="rounded-md border-[0.5px] border-border p-1.5 text-muted-foreground md:hidden"
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
                  "block px-3 py-2 text-xs transition-colors",
                  pathname === link.href
                    ? "text-accent"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <FundsModal
        open={fundsTab !== null}
        onClose={() => setFundsTab(null)}
        collaterals={collaterals}
        initialTab={fundsTab ?? "deposit"}
      />
    </>
  );
}
