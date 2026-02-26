"use client";

import { useCoveredCallStore } from "@/stores/covered-call";
import { usePositionMonitor } from "@/hooks/covered-call/usePositionMonitor";
import { useSettlementDetector } from "@/hooks/covered-call/useSettlementDetector";
import { useCloseCoveredCallPosition } from "@/hooks/covered-call/useCoveredCallSubaccount";
import type { CoveredCallPosition, CoveredCallStatus } from "@/lib/derive/types";

const statusColors: Record<CoveredCallStatus, { bg: string; text: string; border: string }> = {
  deposited: { bg: "rgba(59, 130, 246, 0.1)", text: "#3b82f6", border: "rgba(59, 130, 246, 0.25)" },
  quoted: { bg: "rgba(168, 85, 247, 0.1)", text: "#a855f7", border: "rgba(168, 85, 247, 0.25)" },
  active: { bg: "rgba(34, 197, 94, 0.1)", text: "#22c55e", border: "rgba(34, 197, 94, 0.25)" },
  expiring: { bg: "rgba(234, 179, 8, 0.1)", text: "#eab308", border: "rgba(234, 179, 8, 0.25)" },
  settled: { bg: "rgba(107, 114, 128, 0.1)", text: "#9ca3af", border: "rgba(107, 114, 128, 0.25)" },
  closed: { bg: "rgba(107, 114, 128, 0.05)", text: "#6b7280", border: "rgba(107, 114, 128, 0.15)" },
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

  const colors = statusColors[position.status];
  const canClose = position.status === "settled" || position.status === "deposited";

  const expiryLabel = position.expiry
    ? new Date(position.expiry * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  return (
    <div className="rounded-lg border p-4 transition-colors hover:border-[#2d3a4d]" style={{ borderColor: "#1e293b", background: "#111827" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-sm font-semibold" style={{ color: "#e5e7eb" }}>
            {position.instrumentName || `Subaccount #${position.subaccountId}`}
          </div>

          <div className="mt-1 flex flex-wrap gap-2 font-mono text-xs" style={{ color: "#9ca3af" }}>
            {position.strike && <span>Strike ${position.strike.toLocaleString()}</span>}
            {expiryLabel && <span>· Exp {expiryLabel}</span>}
          </div>

          <div className="mt-2 flex flex-wrap gap-3 font-mono text-xs" style={{ color: "#6b7280" }}>
            <span>{position.amount} WBTC deposited</span>
            {position.premiumUsdc && (
              <span style={{ color: "#22c55e" }}>
                +${parseFloat(position.premiumUsdc).toLocaleString(undefined, { maximumFractionDigits: 2 })} premium
              </span>
            )}
          </div>

          {monitorStatus !== "loading" && (btcCollateral || usdcCollateral) && (
            <div className="mt-1 flex flex-wrap gap-3 font-mono text-[10px]" style={{ color: "#6b7280" }}>
              {btcCollateral && <span>WBTC: {parseFloat(btcCollateral.amount).toFixed(6)}</span>}
              {usdcCollateral && <span>USDC: {parseFloat(usdcCollateral.amount).toFixed(2)}</span>}
            </div>
          )}

          {settlement.isNearExpiry && !settlement.isSettled && (
            <div className="mt-2 font-mono text-[10px] font-semibold uppercase" style={{ color: "#eab308" }}>
              Expiring soon
            </div>
          )}
          {settlement.isSettled && settlement.outcome && (
            <div className="mt-2 font-mono text-[10px]" style={{ color: settlement.outcome === "otm" ? "#22c55e" : "#9ca3af" }}>
              Settled {settlement.outcome === "otm" ? "OTM — BTC returned" : "ITM — settled in USDC"}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-2">
          <div
            className="whitespace-nowrap rounded-full px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider"
            style={{ background: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}
          >
            {position.status}
          </div>

          {canClose && (
            <button
              onClick={() => closePosition.mutate({ subaccountId: position.subaccountId })}
              disabled={closePosition.isPending}
              className="rounded border px-3 py-1 font-mono text-[10px] font-medium transition-colors hover:border-[#9ca3af] hover:text-[#e5e7eb] disabled:opacity-40"
              style={{ borderColor: "#1e293b", color: "#6b7280", background: "#0b1018" }}
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
          <div className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#6b7280" }}>
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
          <div className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#4b5563" }}>
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
