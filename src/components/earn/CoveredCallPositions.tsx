"use client";

import { useCoveredCallStore } from "@/stores/covered-call";
import { usePositionMonitor } from "@/hooks/covered-call/usePositionMonitor";
import { useSettlementDetector } from "@/hooks/covered-call/useSettlementDetector";
import { useCloseCoveredCallPosition } from "@/hooks/covered-call/useCoveredCallSubaccount";
import type { CoveredCallPosition, CoveredCallStatus } from "@/lib/derive/types";
import { cn } from "@/lib/utils";

const statusColors: Record<CoveredCallStatus, string> = {
  deposited: "border-blue-500/25 bg-blue-500/10 text-blue-500",
  quoted: "border-purple-500/25 bg-purple-500/10 text-purple-500",
  active: "border-success/25 bg-success/10 text-success",
  expiring: "border-warning/25 bg-warning/10 text-warning",
  settled: "border-secondary-foreground/25 bg-secondary-foreground/10 text-secondary-foreground",
  closed: "border-muted-foreground/15 bg-muted-foreground/5 text-muted-foreground",
};

function PositionCard({ position }: { position: CoveredCallPosition }) {
  const closePosition = useCloseCoveredCallPosition();
  const { status: monitorStatus, btcCollateral, usdcCollateral } = usePositionMonitor(position.subaccountId);
  const settlement = useSettlementDetector({
    subaccountId: position.subaccountId,
    instrumentName: position.instrumentName,
    expiry: position.expiry,
    strike: position.strike,
  });

  const canClose = position.status === "settled" || position.status === "deposited";

  const expiryLabel = position.expiry
    ? new Date(position.expiry * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  return (
    <div className="rounded-[10px] border-[0.5px] border-border bg-card p-4 transition-colors hover:border-zinc-600">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">
            {position.instrumentName || `Subaccount #${position.subaccountId}`}
          </div>

          <div className="mt-1 flex flex-wrap gap-2 text-xs text-secondary-foreground">
            {position.strike && <span>Strike ${position.strike.toLocaleString()}</span>}
            {expiryLabel && <span>· Exp {expiryLabel}</span>}
          </div>

          <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>{position.amount} WBTC deposited</span>
            {position.premiumUsdc && (
              <span className="text-success">
                +${parseFloat(position.premiumUsdc).toLocaleString(undefined, { maximumFractionDigits: 2 })} premium
              </span>
            )}
          </div>

          {monitorStatus !== "loading" && (btcCollateral || usdcCollateral) && (
            <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
              {btcCollateral && <span>WBTC: {parseFloat(btcCollateral.amount).toFixed(6)}</span>}
              {usdcCollateral && <span>USDC: {parseFloat(usdcCollateral.amount).toFixed(2)}</span>}
            </div>
          )}

          {settlement.isNearExpiry && !settlement.isSettled && (
            <div className="mt-2 text-[10px] font-semibold uppercase text-warning">
              Expiring soon
            </div>
          )}
          {settlement.isSettled && settlement.outcome && (
            <div className={cn(
              "mt-2 text-[10px]",
              settlement.outcome === "otm" ? "text-success" : "text-secondary-foreground"
            )}>
              Settled {settlement.outcome === "otm" ? "OTM — BTC returned" : "ITM — settled in USDC"}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className={cn(
            "whitespace-nowrap rounded border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
            statusColors[position.status]
          )}>
            {position.status}
          </div>

          {canClose && (
            <button
              onClick={() => closePosition.mutate({ subaccountId: position.subaccountId })}
              disabled={closePosition.isPending}
              className="rounded-md border-[0.5px] border-border bg-background px-3 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:border-secondary-foreground hover:text-foreground disabled:opacity-40"
            >
              {closePosition.isPending ? "Closing..." : "Withdraw & Close"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function CoveredCallPositions() {
  const { positions } = useCoveredCallStore();

  const activePositions = positions.filter((p) => p.status !== "closed");
  const closedPositions = positions.filter((p) => p.status === "closed");

  if (positions.length === 0) return null;

  return (
    <div className="mx-auto max-w-6xl px-6 pb-6">
      {activePositions.length > 0 && (
        <div>
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Active Positions
          </div>
          <div className="space-y-3">
            {activePositions.map((p) => (
              <PositionCard key={p.subaccountId} position={p} />
            ))}
          </div>
        </div>
      )}

      {closedPositions.length > 0 && (
        <div className={activePositions.length > 0 ? "mt-6" : ""}>
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
            Closed Positions
          </div>
          <div className="space-y-3">
            {closedPositions.map((p) => (
              <PositionCard key={p.subaccountId} position={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
