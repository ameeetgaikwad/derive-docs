"use client";

import { useEffect, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { User, WalletIcon } from "lucide-react";
import Link from "next/link";
import { useAccount, useSwitchChain } from "wagmi";
import { Text } from "@/components/ui/text";
import { useBtcbBalance, useMintBtcb } from "@/hooks/protocol/useBtcb";
import { useNetwork } from "@/hooks/protocol/useNetwork";
import { TBNB_FAUCET_URL } from "@/lib/protocol/chain";
import { cn } from "@/lib/utils";
import type { AppChainId } from "@/stores/network";
import { NavbarLogo } from "./navbar-logo";

const NETWORKS: { id: AppChainId; label: string }[] = [
  { id: 97, label: "Testnet" },
  { id: 56, label: "Mainnet" },
];

export default function Navbar() {
  const hidden = useHideOnScroll();
  const { isConnected } = useAccount();
  const { balanceNumber } = useBtcbBalance();
  const mintBtcb = useMintBtcb();
  const { isTestnet } = useNetwork();

  return (
    <header
      data-hidden={hidden}
      className="sticky top-0 z-50 bg-white/90 backdrop-blur-[2px] transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] will-change-transform data-[hidden=true]:-translate-y-full motion-reduce:translate-y-0 motion-reduce:transition-none"
    >
      <div className="mx-auto flex w-full max-w-[1512px] items-center justify-between gap-3 px-5 py-5 sm:px-8 lg:px-[clamp(2rem,13.93vw_-_110.66px,6.25rem)] lg:py-[40px]">
        <div className="flex items-center gap-3">
          <NavbarLogo />
          <NetworkToggle />
        </div>

        <div className="flex items-center gap-3 sm:gap-7">
          <nav className="hidden items-center gap-7 md:flex">
            <NavLink href="#learn-more">How it works</NavLink>
            <Divider />
            <NavLink href="#faq">FAQs</NavLink>
            {isConnected && (
              <>
                <Divider />
                <NavLink href="#positions">Positions</NavLink>
              </>
            )}
          </nav>

          <Divider className="hidden md:block" />

          {isConnected && (
            <div className="hidden items-center gap-2 lg:flex">
              <span className="rounded-sm border-[0.5px] border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-500">
                <span className="font-semibold text-zinc-950">
                  {balanceNumber.toFixed(4)}
                </span>{" "}
                BTCB
              </span>
              {isTestnet && (
                <>
                  <button
                    onClick={() => mintBtcb.mutate()}
                    disabled={mintBtcb.isPending}
                    title="Mint 1 mock BTCB to your testnet wallet"
                    className="rounded-sm border-[0.5px] border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-700 transition-colors hover:bg-orange-100 disabled:opacity-50"
                  >
                    {mintBtcb.isPending ? "Minting..." : "Get test BTCB"}
                  </button>
                  <a
                    href={TBNB_FAUCET_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-sm border-[0.5px] border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-950"
                  >
                    tBNB faucet
                  </a>
                </>
              )}
            </div>
          )}

          <WalletConnectControl />
        </div>
      </div>

      {isConnected && (
        <div className="mx-auto flex w-full max-w-[1512px] flex-wrap items-center gap-2 px-5 pb-4 sm:px-8 lg:hidden">
          <span className="rounded-sm border-[0.5px] border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-500">
            <span className="font-semibold text-zinc-950">
              {balanceNumber.toFixed(4)}
            </span>{" "}
            BTCB
          </span>
          {isTestnet && (
            <>
              <button
                onClick={() => mintBtcb.mutate()}
                disabled={mintBtcb.isPending}
                title="Mint 1 mock BTCB to your testnet wallet"
                className="rounded-sm border-[0.5px] border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-700 transition-colors hover:bg-orange-100 disabled:opacity-50"
              >
                {mintBtcb.isPending ? "Minting..." : "Get test BTCB"}
              </button>
              <a
                href={TBNB_FAUCET_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-sm border-[0.5px] border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-950"
              >
                tBNB faucet
              </a>
            </>
          )}
        </div>
      )}
    </header>
  );
}

function NetworkToggle() {
  const { chainId, setChainId } = useNetwork();
  const { switchChainAsync } = useSwitchChain();

  return (
    <div className="flex items-center rounded-[5px] bg-zinc-100 p-0.5">
      {NETWORKS.map((network) => {
        const active = network.id === chainId;
        return (
          <button
            key={network.id}
            type="button"
            aria-pressed={active}
            onClick={() => {
              setChainId(network.id);
              switchChainAsync({ chainId: network.id }).catch(() => {});
            }}
            className={cn(
              "rounded-[4px] px-2 py-1.5 font-mono text-[10px] font-medium uppercase transition-colors sm:px-2.5",
              active
                ? "bg-white text-orange-700 shadow-sm"
                : "text-zinc-500 hover:text-zinc-950",
            )}
          >
            <span className="sm:hidden">
              {network.id === 97 ? "Test" : "Main"}
            </span>
            <span className="hidden sm:inline">{network.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function WalletConnectControl() {
  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        mounted,
        openAccountModal,
        openChainModal,
        openConnectModal,
      }) => {
        const connected = mounted && account && chain;

        if (!connected) {
          return (
            <button
              type="button"
              onClick={openConnectModal}
              className="inline-flex items-center gap-2.5 text-zinc-950 transition-opacity hover:opacity-70"
            >
              <Text
                variant="body-default"
                className="hidden whitespace-nowrap font-mono font-normal tracking-normal md:block"
              >
                Connect Wallet
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
              className="inline-flex items-center gap-2.5 font-mono text-sm text-orange-600 transition-opacity hover:opacity-70"
            >
              Wrong network
              <WalletIcon className="size-5" aria-hidden="true" />
            </button>
          );
        }

        return (
          <button
            type="button"
            onClick={openAccountModal}
            className="inline-flex items-center gap-2.5 text-zinc-950 transition-opacity hover:opacity-70"
          >
            <Text
              variant="body-default"
              className="hidden whitespace-nowrap font-mono font-normal tracking-normal md:block"
            >
              {account.displayName ?? "Connected"}
            </Text>
            <WalletIcon className="size-5" aria-hidden="true" />
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}

function useHideOnScroll(threshold = 80) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;

    const update = () => {
      const y = window.scrollY;
      if (y < threshold) setHidden(false);
      else if (y > lastY) setHidden(true);
      else if (y < lastY) setHidden(false);
      lastY = y;
      ticking = false;
    };

    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);

  return hidden;
}

function NavLink({
  href,
  active = false,
  children,
}: {
  href: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "transition-colors",
        active ? "text-orange-500" : "text-zinc-500 hover:text-zinc-950"
      )}
    >
      <Text
        as="span"
        variant="body-default"
        className="font-mono font-normal leading-[1.35] tracking-normal"
      >
        {children}
      </Text>
    </Link>
  );
}

function Divider({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("h-[22px] w-[0.5px] shrink-0 bg-zinc-200", className)}
    />
  );
}
