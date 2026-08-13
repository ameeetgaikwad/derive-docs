"use client";

import { useState } from "react";
import Link from "next/link";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "wagmi";
import { CoveredCallPositions } from "@/components/earn/CoveredCallPositions";
import { useCoveredCallSubaccount } from "@/hooks/protocol/useCoveredCallSubaccount";
import { usePositions } from "@/hooks/protocol/usePositionMonitor";

export function PositionsWorkspace() {
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { subaccountId, isLoading } = usePositions();
  const { adoptSubaccount } = useCoveredCallSubaccount();
  const [restoreId, setRestoreId] = useState("");
  const [restoring, setRestoring] = useState(false);

  const restoreAccount = async () => {
    try {
      const id = BigInt(restoreId.trim());
      if (id <= 0n) throw new Error("Enter a valid subaccount number");
      setRestoring(true);
      await adoptSubaccount(id);
      toast.success(`Covered-call account #${id.toString()} linked to this browser`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] text-zinc-500">BTCB / POSITIONS</p>
        <h1 className="mt-2 font-heading text-3xl font-bold tracking-[-0.035em] text-zinc-950 sm:text-4xl">Covered-call positions.</h1>
        <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-zinc-500 sm:text-base">Collateral, moneyness, expiry, settlement status, and execution receipts.</p>
      </div>

      {!isConnected ? (
        <EmptyState title="Connect your wallet to load positions" text="Position balances and settlement status are read from the connected wallet’s on-chain covered-call account." action={<button type="button" onClick={openConnectModal} className="inline-flex min-h-11 items-center gap-2 rounded-[5px] bg-zinc-950 px-5 text-sm font-semibold text-white">Connect wallet <ArrowRight className="size-4" /></button>} />
      ) : !isLoading && subaccountId === null ? (
        <EmptyState
          title="No local account linked"
          text="This browser has no saved covered-call account for this wallet. Start a new trade, or re-link an account you created elsewhere."
          action={
            <div className="flex flex-col items-start gap-4">
              <Link href="/app" className="inline-flex min-h-11 items-center gap-2 rounded-[5px] bg-zinc-950 px-5 text-sm font-semibold text-white">Start a covered call <ArrowRight className="size-4" /></Link>
              <details className="group w-full max-w-sm border-t-[0.5px] border-zinc-200 pt-3">
                <summary className="cursor-pointer list-none font-mono text-[11px] text-zinc-600 marker:hidden hover:text-zinc-950">
                  Re-link an existing account <span className="ml-1 inline-block group-open:rotate-45">+</span>
                </summary>
                <div className="mt-4 flex items-end gap-3">
                  <label className="min-w-0 flex-1 text-sm font-medium text-zinc-700">
                    Subaccount number
                    <input
                      value={restoreId}
                      onChange={(event) => setRestoreId(event.target.value.replace(/\D/g, ""))}
                      inputMode="numeric"
                      placeholder="e.g. 42"
                      className="mt-2 h-11 w-full border-b border-zinc-300 bg-transparent font-mono text-sm text-zinc-950 outline-none focus:border-orange-500"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={restoring || restoreId.length === 0}
                    onClick={() => void restoreAccount()}
                    className="min-h-11 shrink-0 font-mono text-[11px] font-medium uppercase text-orange-700 disabled:text-zinc-300"
                  >
                    {restoring ? "Checking…" : "Link"}
                  </button>
                </div>
                <p className="mt-3 text-xs leading-5 text-zinc-500">The account is verified on-chain against this wallet before it is saved locally.</p>
              </details>
            </div>
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
