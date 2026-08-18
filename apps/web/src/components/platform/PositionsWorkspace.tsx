"use client";

import Link from "next/link";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { ArrowRight } from "lucide-react";
import { useAccount } from "wagmi";
import { CoveredCallPositions } from "@/components/earn/CoveredCallPositions";
import { SubaccountSelector } from "@/components/shared/SubaccountSelector";
import { usePositions } from "@/hooks/protocol/usePositionMonitor";

export function PositionsWorkspace() {
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { subaccountId, isLoading } = usePositions();

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] text-zinc-500">BTCB / POSITIONS</p>
        <h1 className="mt-2 font-heading text-3xl font-bold tracking-[-0.035em] text-zinc-950 sm:text-4xl">Covered-call positions.</h1>
        <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-zinc-500 sm:text-base">Collateral, moneyness, expiry, settlement status, and execution receipts.</p>
      </div>

      {isConnected && <SubaccountSelector />}

      {!isConnected ? (
        <EmptyState title="Connect your wallet to load positions" text="Position balances and settlement status are read from the connected wallet’s on-chain covered-call account." action={<button type="button" onClick={openConnectModal} className="inline-flex min-h-11 items-center gap-2 rounded-[5px] bg-zinc-950 px-5 text-sm font-semibold text-white">Connect wallet <ArrowRight className="size-4" /></button>} />
      ) : !isLoading && subaccountId === null ? (
        <EmptyState
          title="Choose a trading subaccount"
          text="Select one of your validated on-chain accounts above, or create another account."
          action={
            <Link href="/app" className="inline-flex min-h-11 items-center gap-2 rounded-[5px] bg-zinc-950 px-5 text-sm font-semibold text-white">Start a covered call <ArrowRight className="size-4" /></Link>
          }
        />
      ) : (
        <CoveredCallPositions />
      )}
    </div>
  );
}

function EmptyState({ title, text, action }: { title: string; text: string; action: React.ReactNode }) {
  return <section className="flex min-h-[320px] items-center border-y-[0.5px] border-zinc-200 py-12"><div className="max-w-lg"><span className="block size-2 rotate-45 bg-orange-500" /><h2 className="mt-5 font-heading text-xl font-bold tracking-[-0.035em] text-zinc-950">{title}</h2><p className="mt-2 text-sm font-medium leading-6 text-zinc-500">{text}</p><div className="mt-6">{action}</div></div></section>;
}
