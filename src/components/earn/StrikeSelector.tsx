"use client";

interface StrikeOption {
  strike: number;
  apr: number;
  instrumentName: string;
}

interface StrikeSelectorProps {
  strikes: StrikeOption[];
  selectedStrike: number | null;
  onSelect: (strike: number) => void;
}

export function StrikeSelector({ strikes, selectedStrike, onSelect }: StrikeSelectorProps) {
  if (strikes.length === 0) {
    return (
      <div className="py-10 text-center font-mono text-sm" style={{ color: "#9b9590" }}>
        No strikes available for this expiry
      </div>
    );
  }

  return (
    <div className="flex gap-2 overflow-x-auto pb-2 pt-3 scrollbar-thin" style={{ scrollbarWidth: "thin", WebkitOverflowScrolling: "touch" }}>
      {strikes.map((s) => {
        const selected = s.strike === selectedStrike;
        const aprClamped = Math.min(Math.max(s.apr, 0), 100);
        const intensity = 0.3 + (aprClamped / 100) * 0.7;

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
                color: `rgba(22, 163, 74, ${intensity})`,
                border: `1px solid rgba(34, 197, 94, ${intensity * 0.4})`,
              }}
            >
              APR {s.apr.toFixed(1)}%
            </div>
            {/* Card body */}
            <div
              className="flex h-16 w-full items-center justify-center rounded-lg border-2 font-mono text-sm font-semibold transition-all"
              style={{
                borderColor: selected ? "#d4a017" : "#d4cfc6",
                background: selected ? "rgba(212, 160, 23, 0.06)" : "#ffffff",
                color: "#1a1a1a",
                boxShadow: selected ? "0 0 0 1px rgba(212, 160, 23, 0.3)" : "0 1px 2px rgba(0,0,0,0.04)",
              }}
            >
              ${s.strike.toLocaleString()}
            </div>
          </button>
        );
      })}
    </div>
  );
}
