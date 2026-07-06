"use client";

import { usePositions, type OptionPosition, type PositionStatus } from "@/hooks/protocol/usePositionMonitor";
import { explorerTxUrl } from "@/lib/protocol/deployments";
import { cn } from "@/lib/utils";

const statusStyle: Record<PositionStatus, string> = {
  open: "border-success/25 bg-success/10 text-success",
  expired: "border-warning/25 bg-warning/10 text-warning",
  settled: "border-secondary-foreground/25 bg-secondary-foreground/10 text-secondary-foreground",
};

const statusLabel: Record<PositionStatus, string> = {
  open: "active",
  expired: "awaiting settlement",
  settled: "settled",
};

function PositionCard({ position }: { position: OptionPosition }) {
  const expiryLabel = new Date(position.expiry * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <div className="rounded-[10px] border-[0.5px] border-border bg-card p-4 transition-colors hover:border-zinc-600">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">
            {position.instrumentName}
          </div>

          <div className="mt-1 flex flex-wrap gap-2 text-xs text-secondary-foreground">
            <span>Strike ${position.strike.toLocaleString()}</span>
            <span>· Exp {expiryLabel} 08:00 UTC</span>
            <span>
              · {Math.abs(position.balance)} contract
              {Math.abs(position.balance) === 1 ? "" : "s"} short
            </span>
          </div>

          {position.trade && (
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="text-success">
                +$
                {parseFloat(position.trade.premium).toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}{" "}
                premium earned
              </span>
              <a
                href={explorerTxUrl(position.trade.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline-offset-2 hover:underline"
              >
                tx ↗
              </a>
            </div>
          )}

          {position.status === "settled" && position.settlementPrice !== null && (
            <div
              className={cn(
                "mt-2 text-[10px]",
                position.settledItm ? "text-secondary-foreground" : "text-success"
              )}
            >
              Settled at ${position.settlementPrice.toLocaleString()} —{" "}
              {position.settledItm
                ? "ITM, settled in USDT"
                : "OTM, kept BTCB + premium"}
            </div>
          )}
        </div>

        <div
          className={cn(
            "whitespace-nowrap rounded border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
            statusStyle[position.status]
          )}
        >
          {statusLabel[position.status]}
        </div>
      </div>
    </div>
  );
}

/**
 * On-chain positions of the covered-call subaccount: short options (decoded
 * from SubAccounts balances), plus the BTCB collateral and USDT cash
 * (premiums land here) backing them.
 */
export function CoveredCallPositions() {
  const { subaccountId, cash, btcb, options, isLoading } = usePositions();

  if (subaccountId === null) return null;

  return (
    <div className="mx-auto max-w-6xl px-6 pb-10">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Positions · Subaccount #{subaccountId.toString()}
        </div>
        <div className="flex-1" />
        <div className="rounded-md border-[0.5px] border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
          BTCB collateral:{" "}
          <span className="font-semibold text-foreground">{btcb.toFixed(6)}</span>
        </div>
        <div className="rounded-md border-[0.5px] border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
          USDT cash:{" "}
          <span
            className={cn(
              "font-semibold",
              cash < 0 ? "text-warning" : "text-foreground"
            )}
          >
            {cash.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>

      {isLoading ? (
        <div className="py-6 text-center text-xs text-muted-foreground">
          Loading positions…
        </div>
      ) : options.length === 0 ? (
        <div className="rounded-[10px] border-[0.5px] border-border bg-card p-4 text-center text-xs text-muted-foreground">
          No open option positions
        </div>
      ) : (
        <div className="space-y-3">
          {options.map((p) => (
            <PositionCard key={p.subId.toString()} position={p} />
          ))}
        </div>
      )}
    </div>
  );
}
