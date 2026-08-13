"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FlaskConical, User, WalletIcon } from "lucide-react";
import { useAccount, useSwitchChain } from "wagmi";
import { NavbarLogo } from "@/components/root/navbar-logo";
import { Text } from "@/components/ui/text";
import { useBtcbBalance, useMintBtcb } from "@/hooks/protocol/useBtcb";
import { useNetwork } from "@/hooks/protocol/useNetwork";
import { TBNB_FAUCET_URL } from "@/lib/protocol/chain";
import { rfqEngineHealthy } from "@/lib/protocol/rfq-engine";
import { cn } from "@/lib/utils";
import type { AppChainId } from "@/stores/network";

const navItems = [
  { href: "/app", label: "Trade", exact: true },
  { href: "/app/positions", label: "Positions", exact: false },
] as const;

const networks: { id: AppChainId; label: string; short: string }[] = [
  { id: 97, label: "Testnet", short: "Test" },
  { id: 56, label: "Mainnet", short: "Main" },
];

function isActive(pathname: string, href: string, exact: boolean) {
  return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isConnected } = useAccount();
  const { balanceNumber } = useBtcbBalance();
  const mintBtcb = useMintBtcb();
  const { chainId, isTestnet, setChainId } = useNetwork();
  const { switchChainAsync } = useSwitchChain();
  const health = useQuery({
    queryKey: ["rfq-engine-health", chainId],
    queryFn: () => rfqEngineHealthy(chainId),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const setNetwork = (nextChainId: AppChainId) => {
    setChainId(nextChainId);
    switchChainAsync({ chainId: nextChainId }).catch(() => {});
  };

  return (
    <div className="min-h-screen bg-white text-zinc-950">
      <header className="sticky top-0 z-40 border-b-[0.5px] border-zinc-200 bg-white/95 backdrop-blur-[6px]">
        <div className="mx-auto flex min-h-[76px] w-full max-w-[1512px] items-center justify-between gap-4 px-5 sm:px-8 lg:px-[clamp(2rem,13.93vw_-_110.66px,6.25rem)]">
          <div className="flex min-w-0 items-center gap-5 sm:gap-7">
            <NavbarLogo />
            <span aria-hidden className="hidden h-7 w-px bg-zinc-200 sm:block" />
            <nav className="hidden items-center gap-6 sm:flex" aria-label="Application navigation">
              {navItems.map(({ href, label, exact }) => {
                const active = isActive(pathname, href, exact);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "text-sm font-medium transition-colors",
                      active ? "text-orange-600" : "text-zinc-500 hover:text-zinc-950",
                    )}
                  >
                    {label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <QuoteStatus
              loading={health.isLoading}
              online={health.data === true}
              className="hidden lg:flex"
            />
            <div className="flex items-center gap-3 border-r-[0.5px] border-zinc-200 pr-3">
              {networks.map((network) => (
                <button
                  key={network.id}
                  type="button"
                  aria-pressed={chainId === network.id}
                  onClick={() => setNetwork(network.id)}
                  className={cn(
                    "relative min-h-9 rounded-none border-0 px-0 font-mono text-[10px] font-medium uppercase transition-colors",
                    chainId === network.id
                      ? "text-orange-700 after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-orange-500 after:content-['']"
                      : "text-zinc-500 hover:text-zinc-950",
                  )}
                >
                  <span className="sm:hidden">{network.short}</span>
                  <span className="hidden sm:inline">{network.label}</span>
                </button>
              ))}
            </div>
            {isConnected && isTestnet && (
              <details className="group relative hidden sm:block">
                <summary
                  aria-label="Test funds"
                  className="flex size-9 cursor-pointer list-none items-center justify-center text-zinc-500 transition-colors hover:text-orange-700 marker:hidden"
                >
                  <FlaskConical className="size-4" aria-hidden="true" />
                </summary>
                <div className="absolute right-0 top-full z-50 mt-2 w-56 border border-zinc-200 bg-white p-4 shadow-sm">
                  <p className="font-mono text-[11px] text-zinc-500">
                    <span className="font-medium text-zinc-950">{balanceNumber.toFixed(4)}</span> BTCB on testnet
                  </p>
                  <button
                    type="button"
                    onClick={() => mintBtcb.mutate()}
                    disabled={mintBtcb.isPending}
                    className="mt-2 flex min-h-10 w-full items-center gap-2 font-mono text-[11px] text-orange-700 disabled:opacity-50"
                  >
                    <FlaskConical className="size-3.5" aria-hidden="true" />
                    {mintBtcb.isPending ? "Minting test BTCB…" : "Mint test BTCB"}
                  </button>
                  <a
                    href={TBNB_FAUCET_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-h-10 items-center gap-2 font-mono text-[11px] text-zinc-600 hover:text-zinc-950"
                  >
                    Get tBNB gas <ExternalLink className="size-3" aria-hidden="true" />
                  </a>
                </div>
              </details>
            )}
            {isConnected && (
              <span className="hidden font-mono text-xs text-zinc-500 min-[1100px]:inline-flex">
                <span className="font-medium text-zinc-950">{balanceNumber.toFixed(4)}</span>&nbsp;BTCB
              </span>
            )}
            <WalletControl />
          </div>
        </div>

        <div className="mx-auto flex min-h-11 w-full max-w-[1512px] items-center justify-between gap-3 border-t-[0.5px] border-zinc-100 px-5 sm:hidden">
          <nav className="flex items-center gap-5" aria-label="Application navigation">
            {navItems.map(({ href, label, exact }) => {
              const active = isActive(pathname, href, exact);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "font-mono text-[11px] font-medium uppercase tracking-[0.04em]",
                    active ? "text-orange-600" : "text-zinc-500",
                  )}
                >
                  {label}
                </Link>
              );
            })}
            {isConnected && isTestnet && (
              <details className="group relative">
                <summary className="min-h-9 cursor-pointer list-none py-2 font-mono text-[11px] font-medium uppercase tracking-[0.04em] text-zinc-500 marker:hidden">
                  Funds
                </summary>
                <div className="absolute left-0 top-full z-50 mt-1 w-52 border border-zinc-200 bg-white p-4 shadow-sm">
                  <p className="font-mono text-[11px] text-zinc-500">
                    <span className="font-medium text-zinc-950">{balanceNumber.toFixed(4)}</span> BTCB
                  </p>
                  <button
                    type="button"
                    onClick={() => mintBtcb.mutate()}
                    disabled={mintBtcb.isPending}
                    className="mt-2 flex min-h-10 w-full items-center gap-2 font-mono text-[11px] text-orange-700 disabled:opacity-50"
                  >
                    <FlaskConical className="size-3.5" aria-hidden="true" />
                    {mintBtcb.isPending ? "Minting test BTCB…" : "Mint test BTCB"}
                  </button>
                  <a
                    href={TBNB_FAUCET_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-h-10 items-center gap-2 font-mono text-[11px] text-zinc-600 hover:text-zinc-950"
                  >
                    Get tBNB gas <ExternalLink className="size-3" aria-hidden="true" />
                  </a>
                </div>
              </details>
            )}
          </nav>
          <QuoteStatus loading={health.isLoading} online={health.data === true} />
        </div>

      </header>

      <main className="mx-auto min-h-[calc(100vh-76px)] w-full max-w-[1512px] px-5 py-6 sm:px-8 sm:py-8 lg:px-[clamp(2rem,13.93vw_-_110.66px,6.25rem)]">
        {children}
      </main>
    </div>
  );
}

function QuoteStatus({
  loading,
  online,
  className,
}: {
  loading: boolean;
  online: boolean;
  className?: string;
}) {
  return (
    <span className={cn("items-center gap-2 font-mono text-[10px] text-zinc-500", className ?? "flex")}>
      <span
        className={cn(
          "size-1.5 rounded-full",
          loading ? "animate-pulse bg-zinc-400" : online ? "bg-green-500" : "bg-amber-500",
        )}
      />
      {loading ? "Checking RFQ engine" : online ? "RFQ engine reachable" : "RFQ engine unavailable"}
    </span>
  );
}

function WalletControl() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openAccountModal, openChainModal, openConnectModal }) => {
        const connected = mounted && account && chain;
        if (!connected) {
          return (
            <button
              type="button"
              aria-label="Connect wallet"
              onClick={openConnectModal}
              className="inline-flex min-h-11 items-center gap-2.5 text-zinc-950 transition-opacity hover:opacity-70"
            >
              <Text variant="body-default" className="hidden whitespace-nowrap font-mono font-normal tracking-normal md:block">
                Connect wallet
              </Text>
              <User className="size-5 md:hidden" aria-hidden="true" />
              <WalletIcon className="hidden size-5 md:block" aria-hidden="true" />
            </button>
          );
        }
        if (chain.unsupported) {
          return (
            <button
              type="button"
              onClick={openChainModal}
              className="inline-flex min-h-11 items-center gap-2 font-mono text-xs text-orange-600"
            >
              Wrong network <WalletIcon className="size-5" aria-hidden="true" />
            </button>
          );
        }
        return (
          <button
            type="button"
            aria-label={`Open wallet${account.displayName ? ` ${account.displayName}` : ""}`}
            onClick={openAccountModal}
            className="inline-flex min-h-11 items-center gap-2.5 text-zinc-950 transition-opacity hover:opacity-70"
          >
            <span className="hidden whitespace-nowrap font-mono text-xs md:block">
              {account.displayName ?? "Connected"}
            </span>
            <WalletIcon className="size-5" aria-hidden="true" />
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
