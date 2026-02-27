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
      <div className="rounded-[10px] border-[0.5px] border-border bg-card p-4">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Now</div>
        <div className="mb-0.5 text-lg font-bold text-accent font-heading tracking-[-0.03em]">
          APR {apr.toFixed(1)}%
        </div>
        <div className="text-xs text-secondary-foreground">
          Upfront premium:{" "}
          <span className="font-medium text-foreground">
            {outcome.totalPremium.toFixed(4)} {collateralLabel}
            {outcome.totalPremiumUsd != null && (
              <span className="text-muted-foreground"> (${outcome.totalPremiumUsd.toFixed(2)})</span>
            )}
          </span>
        </div>
      </div>

      {/* On expiry card */}
      <div className="rounded-[10px] border-[0.5px] border-border bg-card p-4">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          On {expiryLabel}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-[10px] text-muted-foreground">
              If {asset} {strategyType === "cash_secured_put" ? "BELOW" : "ABOVE"} ${strike.toLocaleString()}
            </div>
            <div className="mt-0.5 text-xs font-medium text-foreground">
              {strategyType === "cash_secured_put"
                ? `Receive ${outcome.ifBelow.value.toFixed(4)} ${asset}`
                : `Sold at $${outcome.ifAbove.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">
              If {asset} {strategyType === "cash_secured_put" ? "ABOVE" : "BELOW"} ${strike.toLocaleString()}
            </div>
            <div className="mt-0.5 text-xs font-medium text-foreground">
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
