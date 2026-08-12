"use client";

import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { HedgeLogo } from "@/components/ui/HedgeLogo";
import { useBtcbBalance, useMintBtcb } from "@/hooks/protocol/useBtcb";
import { useNetwork } from "@/hooks/protocol/useNetwork";
import { TBNB_FAUCET_URL } from "@/lib/protocol/chain";

function NetworkToggle() {
  return (
    <div
      className="flex items-center rounded-md border-[0.5px] border-border bg-background p-0.5"
      role="group"
      aria-label="Network"
    >
      <button
        type="button"
        aria-pressed="true"
        className="rounded bg-accent/15 px-2.5 py-1 text-xs font-semibold text-accent"
      >
        Testnet
      </button>
      <button
        type="button"
        disabled
        aria-disabled="true"
        title="Mainnet is not available yet"
        className="cursor-not-allowed rounded px-2.5 py-1 text-xs font-semibold text-muted-foreground opacity-50"
      >
        Mainnet
      </button>
    </div>
  );
}

export function Header() {
  const { isConnected } = useAccount();
  const { balanceNumber } = useBtcbBalance();
  const mintBtcb = useMintBtcb();
  const { isTestnet } = useNetwork();

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-card">
      <div className="mx-auto flex h-12 max-w-7xl items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center">
            <HedgeLogo size={18} className="text-foreground" />
          </Link>
          <NetworkToggle />
        </div>

        <div className="flex items-center gap-2">
          {isConnected && (
            <>
              <span className="hidden rounded-md border-[0.5px] border-border bg-background px-3 py-1.5 text-xs text-muted-foreground sm:inline">
                <span className="font-semibold text-foreground">
                  {balanceNumber.toFixed(4)}
                </span>{" "}
                BTCB
              </span>
              {isTestnet && (
                <>
                  <button
                    onClick={() => mintBtcb.mutate()}
                    disabled={mintBtcb.isPending}
                    title="Mint 1 mock BTCB to your wallet (testnet faucet)"
                    className="rounded-md border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
                  >
                    {mintBtcb.isPending ? "Minting…" : "Get test BTCB"}
                  </button>
                  <a
                    href={TBNB_FAUCET_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="BNB Chain testnet faucet for gas (tBNB)"
                    className="hidden rounded-md border-[0.5px] border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground sm:inline"
                  >
                    tBNB faucet ↗
                  </a>
                </>
              )}
            </>
          )}
          <ConnectButton
            showBalance={false}
            chainStatus="icon"
            accountStatus="address"
          />
        </div>
      </div>
    </header>
  );
}
