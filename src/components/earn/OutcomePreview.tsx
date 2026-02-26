"use client";

import type { StrategyType, OutcomeResult } from "@/lib/derive/apr";

interface OutcomePreviewProps {
  asset: string;
  strike: number;
  apr: number;
  outcome: OutcomeResult;
  expiryLabel: string;
  strategyType: StrategyType;
  collateralLabel: string;
}

export function OutcomePreview({
  asset,
  strike,
  apr,
  outcome,
  expiryLabel,
  strategyType,
  collateralLabel,
}: OutcomePreviewProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {/* Now card */}
      <div className="rounded-lg border p-4" style={{ borderColor: "#1e293b", background: "#111827" }}>
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wider" style={{ color: "#6b7280" }}>Now</div>
        <div className="mb-0.5 font-mono text-lg font-bold" style={{ color: "#22c55e" }}>
          APR {apr.toFixed(1)}%
        </div>
        <div className="font-mono text-xs" style={{ color: "#9ca3af" }}>
          Upfront premium:{" "}
          <span className="font-medium" style={{ color: "#e5e7eb" }}>
            {outcome.totalPremium.toFixed(4)} {collateralLabel}
            {outcome.totalPremiumUsd != null && (
              <span style={{ color: "#6b7280" }}> (${outcome.totalPremiumUsd.toFixed(2)})</span>
            )}
          </span>
        </div>
      </div>

      {/* On expiry card */}
      <div className="rounded-lg border p-4" style={{ borderColor: "#1e293b", background: "#111827" }}>
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wider" style={{ color: "#6b7280" }}>
          On {expiryLabel}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="font-mono text-[10px]" style={{ color: "#6b7280" }}>
              If {asset} {strategyType === "cash_secured_put" ? "BELOW" : "ABOVE"} ${strike.toLocaleString()}
            </div>
            <div className="mt-0.5 font-mono text-xs font-medium" style={{ color: "#e5e7eb" }}>
              {strategyType === "cash_secured_put"
                ? `Receive ${outcome.ifBelow.value.toFixed(4)} ${asset}`
                : `Sold at $${outcome.ifAbove.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
            </div>
          </div>
          <div>
            <div className="font-mono text-[10px]" style={{ color: "#6b7280" }}>
              If {asset} {strategyType === "cash_secured_put" ? "ABOVE" : "BELOW"} ${strike.toLocaleString()}
            </div>
            <div className="mt-0.5 font-mono text-xs font-medium" style={{ color: "#e5e7eb" }}>
              {strategyType === "cash_secured_put"
                ? `Get $${outcome.ifAbove.value.toLocaleString(undefined, { maximumFractionDigits: 2 })} back`
                : `Keep ${outcome.ifBelow.value.toFixed(4)} ${asset}`}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
