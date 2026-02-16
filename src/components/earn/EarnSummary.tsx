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
    { label: "APR", value: apr > 0 ? `${apr.toFixed(2)}%` : "—" },
    { label: "Upfront Premium", value: outcome ? `${outcome.totalPremium.toFixed(4)} ${collateralLabel}` : "—" },
    { label: "Contracts", value: outcome ? outcome.contracts.toFixed(4) : "—" },
    { label: "Strike Price", value: strike ? `$${strike.toLocaleString()}` : "—" },
    { label: "Spot Price", value: spotPrice > 0 ? `$${spotPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—" },
    { label: "Collateral", value: amount > 0 ? `${amount} ${collateralLabel}` : "—" },
  ];

  return (
    <div className="rounded-lg border p-4" style={{ borderColor: "#d4cfc6", background: "#faf8f5" }}>
      <div className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#6b6560" }}>
        Order Summary
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between font-mono text-xs">
            <span style={{ color: "#9b9590" }}>{r.label}</span>
            <span className="font-medium" style={{ color: "#1a1a1a" }}>{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
