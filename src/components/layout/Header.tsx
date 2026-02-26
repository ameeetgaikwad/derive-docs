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
import { FundsModal } from "@/components/portfolio/FundsModal";

const navLinks = [
  { href: "/trade", label: "trade" },
  { href: "/portfolio", label: "portfolio" },
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

  // Close dropdown on outside click
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
      <header className="sticky top-0 z-50 border-b" style={{ borderColor: "#1e293b", background: "#111827" }}>
        <div className="mx-auto flex h-12 max-w-7xl items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2">
              <HedgeLogo size={22} />
              <span className="font-mono text-sm font-bold" style={{ color: "#e5e7eb" }}>
                Hedge
              </span>
            </Link>
            {process.env.NEXT_PUBLIC_DERIVE_ENV === "testnet" && (
              <span
                className="rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase"
                style={{ color: "#f59e0b", background: "rgba(245, 158, 11, 0.1)", border: "1px solid rgba(245, 158, 11, 0.3)" }}
              >
                testnet
              </span>
            )}

            <div className="hidden h-4 w-px md:block" style={{ background: "#1e293b" }} />

            <nav className="hidden items-center gap-1 md:flex">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "rounded-md px-3 py-1.5 font-mono text-xs transition-colors",
                    pathname === link.href
                      ? "font-bold"
                      : "hover:text-white"
                  )}
                  style={{ color: pathname === link.href ? "#22c55e" : "#6b7280" }}
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
                      className="rounded-lg border px-3 py-1.5 font-mono text-xs font-medium transition-colors"
                      style={{
                        borderColor: connected ? "#1e293b" : "#22c55e",
                        background: connected ? "#0b1018" : "rgba(34, 197, 94, 0.1)",
                        color: connected ? "#e5e7eb" : "#22c55e",
                      }}
                    >
                      {connected
                        ? `${account.address.slice(0, 6)}...${account.address.slice(-4)}`
                        : "Connect Wallet"}
                    </button>

                    {/* Wallet dropdown */}
                    {connected && walletOpen && (
                      <div
                        className="absolute right-0 top-full mt-2 w-72 rounded-lg border p-4"
                        style={{ borderColor: "#1e293b", background: "#111827", zIndex: 100 }}
                      >
                        {/* Address + status */}
                        <div className="mb-3 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full" style={{ background: isAuthenticated ? "#22c55e" : "#f59e0b" }} />
                            <span className="font-mono text-xs" style={{ color: "#e5e7eb" }}>
                              {account.address.slice(0, 6)}...{account.address.slice(-4)}
                            </span>
                          </div>
                          {subaccountId && (
                            <span className="font-mono text-[10px]" style={{ color: "#6b7280" }}>
                              sub#{subaccountId}
                            </span>
                          )}
                        </div>

                        {/* Balances */}
                        {isAuthenticated && collaterals.length > 0 ? (
                          <div className="mb-3 space-y-1.5">
                            {collaterals.map((c) => (
                              <div key={c.asset_name} className="flex items-center justify-between font-mono text-xs">
                                <span style={{ color: "#9ca3af" }}>{c.asset_name}</span>
                                <div>
                                  <span style={{ color: "#e5e7eb" }}>{parseFloat(c.amount).toFixed(4)}</span>
                                  {parseFloat(c.mark_value) > 0 && (
                                    <span className="ml-1.5" style={{ color: "#6b7280" }}>
                                      ${parseFloat(c.mark_value).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : isAuthenticated ? (
                          <div className="mb-3 py-2 text-center font-mono text-xs" style={{ color: "#6b7280" }}>
                            No balances yet
                          </div>
                        ) : null}

                        {/* Action buttons */}
                        {isAuthenticated && (
                          <div className="mb-3 grid grid-cols-3 gap-1.5">
                            <button
                              onClick={() => { setFundsTab("deposit"); setWalletOpen(false); }}
                              className="rounded-md py-1.5 font-mono text-[10px] font-semibold transition-colors"
                              style={{ background: "rgba(34, 197, 94, 0.1)", color: "#22c55e", border: "1px solid rgba(34, 197, 94, 0.2)" }}
                            >
                              Deposit
                            </button>
                            <button
                              onClick={() => { setFundsTab("withdraw"); setWalletOpen(false); }}
                              className="rounded-md py-1.5 font-mono text-[10px] font-semibold transition-colors"
                              style={{ background: "rgba(107, 114, 128, 0.1)", color: "#9ca3af", border: "1px solid rgba(107, 114, 128, 0.2)" }}
                            >
                              Withdraw
                            </button>
                            <button
                              onClick={() => { setFundsTab("bridge"); setWalletOpen(false); }}
                              className="rounded-md py-1.5 font-mono text-[10px] font-semibold transition-colors"
                              style={{ background: "rgba(59, 130, 246, 0.1)", color: "#3b82f6", border: "1px solid rgba(59, 130, 246, 0.2)" }}
                            >
                              Bridge
                            </button>
                          </div>
                        )}

                        {/* Divider + Disconnect */}
                        <div className="border-t pt-2" style={{ borderColor: "#1e293b" }}>
                          <button
                            onClick={() => { disconnect(); setWalletOpen(false); }}
                            className="w-full rounded-md py-1.5 font-mono text-[10px] font-medium transition-colors"
                            style={{ color: "#ef4444" }}
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
              className="rounded-md border p-1.5 md:hidden"
              style={{ borderColor: "#1e293b", color: "#6b7280" }}
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
          <nav className="border-t px-4 py-2 md:hidden" style={{ borderColor: "#1e293b", background: "#111827" }}>
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="block px-3 py-2 font-mono text-xs transition-colors"
                style={{ color: pathname === link.href ? "#22c55e" : "#6b7280" }}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        )}
      </header>

      {/* Funds modal */}
      <FundsModal
        open={fundsTab !== null}
        onClose={() => setFundsTab(null)}
        collaterals={collaterals}
        initialTab={fundsTab ?? "deposit"}
      />
    </>
  );
}
