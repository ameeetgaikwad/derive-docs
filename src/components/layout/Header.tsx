"use client";

import Link from "next/link";
import Image from "next/image";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { useBtcbBalance, useMintBtcb } from "@/hooks/protocol/useBtcb";
import { TBNB_FAUCET_URL } from "@/lib/protocol/chain";

export function Header() {
  const { isConnected } = useAccount();
  const { balanceNumber } = useBtcbBalance();
  const mintBtcb = useMintBtcb();

  return (
    <header className="sticky top-0 z-50 border-b-[0.5px] border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-[58px] max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center" aria-label="Hedge home">
            <Image
              src="/hedge-logo.svg"
              alt="Hedge"
              width={1500}
              height={318}
              priority
              className="h-7 w-auto"
            />
          </Link>
          <span className="rounded-sm border-[0.5px] border-orange-200 bg-orange-50 px-2 py-1 font-mono text-[10px] font-medium uppercase text-orange-700">
            BSC testnet
          </span>
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
              <button
                onClick={() => mintBtcb.mutate()}
                disabled={mintBtcb.isPending}
                title="Mint 1 mock BTCB to your wallet (testnet faucet)"
                className="rounded-sm border-[0.5px] border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-700 transition-colors hover:bg-orange-100 disabled:opacity-50"
              >
                {mintBtcb.isPending ? "Minting..." : "Get test BTCB"}
              </button>
              <a
                href={TBNB_FAUCET_URL}
                target="_blank"
                rel="noopener noreferrer"
                title="BNB Chain testnet faucet for gas (tBNB)"
                className="hidden rounded-md border-[0.5px] border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground sm:inline"
              >
                tBNB faucet
              </a>
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
