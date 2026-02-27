"use client";

import type { OutcomeResult } from "@/lib/derive/apr";

interface EarnSummaryProps {
  outcome: OutcomeResult | null;
  strike: number | null;
  spotPrice: number;
  amount: number;
  collateralLabel: string;
  apr: number;
}

export function EarnSummary({ outcome, strike, spotPrice, amount, collateralLabel, apr }: EarnSummaryProps) {
  const rows = [
    { label: "APR", value: apr > 0 ? `${apr.toFixed(2)}%` : "—", highlight: apr > 0 },
    { label: "Upfront Premium", value: outcome ? `${outcome.totalPremium.toFixed(4)} ${collateralLabel}` : "—" },
    { label: "Contracts", value: outcome ? outcome.contracts.toFixed(4) : "—" },
    { label: "Strike Price", value: strike ? `$${strike.toLocaleString()}` : "—" },
    { label: "Spot Price", value: spotPrice > 0 ? `$${spotPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—" },
    { label: "Collateral", value: amount > 0 ? `${amount} ${collateralLabel}` : "—" },
  ];

  return (
    <div className="rounded-[10px] border-[0.5px] border-border bg-card p-4">
      <div className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Order Summary
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{r.label}</span>
            <span className={r.highlight ? "font-medium text-accent" : "font-medium text-foreground"}>{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
