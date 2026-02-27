"use client";

import { cn } from "@/lib/utils";

interface StrikeOption {
  strike: number;
  apr: number;
  premium: number;
  instrumentName: string;
  otmPercent: number;
}

interface StrikeSelectorProps {
  strikes: StrikeOption[];
  selectedStrike: number | null;
  onSelect: (strike: number) => void;
}

export function StrikeSelector({ strikes, selectedStrike, onSelect }: StrikeSelectorProps) {
  if (strikes.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        No strikes available for this expiry
      </div>
    );
  }

  return (
    <div className="flex gap-2 overflow-x-auto pb-2 pt-3" style={{ scrollbarWidth: "thin", WebkitOverflowScrolling: "touch" }}>
      {strikes.map((s) => {
        const selected = s.strike === selectedStrike;
        const aprClamped = Math.min(Math.max(s.apr, 0), 100);
        const intensity = 0.4 + (aprClamped / 100) * 0.6;

        const premiumLabel = s.premium >= 1
          ? `$${s.premium.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
          : `$${s.premium.toFixed(2)}`;

        return (
          <button
            key={s.strike}
            onClick={() => onSelect(s.strike)}
            className="relative flex flex-shrink-0 flex-col items-center pb-3 pt-5 transition-all"
            style={{ minWidth: 100 }}
          >
            {/* APR badge */}
            <div
              className="absolute -top-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[10px] font-semibold"
              style={{
                background: `rgba(251, 146, 60, ${intensity * 0.15})`,
                color: `rgba(251, 146, 60, ${intensity})`,
                border: `1px solid rgba(251, 146, 60, ${intensity * 0.3})`,
              }}
            >
              {s.apr.toFixed(0)}% APR
            </div>
            {/* Card body */}
            <div
              className={cn(
                "flex h-16 w-full flex-col items-center justify-center rounded-[10px] border-[0.5px] transition-all",
                selected
                  ? "border-accent bg-accent/10 text-accent shadow-[0_0_0_1px_rgba(251,146,60,0.2)]"
                  : "border-border bg-card text-foreground"
              )}
            >
              <span className="text-sm font-semibold">${s.strike.toLocaleString()}</span>
              <span className={cn(
                "mt-0.5 text-[10px]",
                selected ? "text-accent/70" : "text-muted-foreground"
              )}>
                {premiumLabel}/contract
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
