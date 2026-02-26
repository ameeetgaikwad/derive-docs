"use client";

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
      <div className="py-10 text-center font-mono text-sm" style={{ color: "#6b7280" }}>
        No strikes available for this expiry
      </div>
    );
  }

  return (
    <div className="flex gap-2 overflow-x-auto pb-2 pt-3 scrollbar-thin" style={{ scrollbarWidth: "thin", WebkitOverflowScrolling: "touch" }}>
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
            className="relative flex flex-shrink-0 flex-col items-center pt-5 pb-3 transition-all"
            style={{ minWidth: 100 }}
          >
            {/* APR badge */}
            <div
              className="absolute -top-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-2.5 py-0.5 font-mono text-[10px] font-semibold"
              style={{
                background: `rgba(34, 197, 94, ${intensity * 0.15})`,
                color: `rgba(34, 197, 94, ${intensity})`,
                border: `1px solid rgba(34, 197, 94, ${intensity * 0.3})`,
              }}
            >
              {s.apr.toFixed(0)}% APR
            </div>
            {/* Card body */}
            <div
              className="flex h-16 w-full flex-col items-center justify-center rounded-lg border font-mono transition-all"
              style={{
                borderColor: selected ? "#22c55e" : "#1e293b",
                background: selected ? "rgba(34, 197, 94, 0.08)" : "#111827",
                color: selected ? "#22c55e" : "#e5e7eb",
                boxShadow: selected ? "0 0 0 1px rgba(34, 197, 94, 0.2)" : "none",
              }}
            >
              <span className="text-sm font-semibold">${s.strike.toLocaleString()}</span>
              <span className="mt-0.5 text-[10px]" style={{ color: selected ? "rgba(34, 197, 94, 0.7)" : "#6b7280" }}>
                {premiumLabel}/contract
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
