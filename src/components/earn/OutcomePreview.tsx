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

const hatching = "repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(0,0,0,0.015) 8px, rgba(0,0,0,0.015) 16px)";

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
      <div className="rounded-lg border p-4" style={{ borderColor: "#d4cfc6", background: hatching }}>
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wider" style={{ color: "#9b9590" }}>Now</div>
        <div className="mb-0.5 font-mono text-lg font-bold" style={{ color: "#16a34a" }}>
          APR {apr.toFixed(1)}%
        </div>
        <div className="font-mono text-xs" style={{ color: "#6b6560" }}>
          Upfront premium:{" "}
          <span className="font-medium" style={{ color: "#1a1a1a" }}>
            {outcome.totalPremium.toFixed(4)} {collateralLabel}
          </span>
        </div>
      </div>

      {/* On expiry card */}
      <div className="rounded-lg border p-4" style={{ borderColor: "#d4cfc6", background: hatching }}>
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wider" style={{ color: "#9b9590" }}>
          On {expiryLabel}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="font-mono text-[10px]" style={{ color: "#9b9590" }}>
              If {asset} {strategyType === "cash_secured_put" ? "BELOW" : "ABOVE"} ${strike.toLocaleString()}
            </div>
            <div className="mt-0.5 font-mono text-xs font-medium" style={{ color: "#1a1a1a" }}>
              {strategyType === "cash_secured_put"
                ? `Receive ${outcome.ifBelow.value.toFixed(4)} ${asset}`
                : `Sold at $${outcome.ifAbove.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
            </div>
          </div>
          <div>
            <div className="font-mono text-[10px]" style={{ color: "#9b9590" }}>
              If {asset} {strategyType === "cash_secured_put" ? "ABOVE" : "BELOW"} ${strike.toLocaleString()}
            </div>
            <div className="mt-0.5 font-mono text-xs font-medium" style={{ color: "#1a1a1a" }}>
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
