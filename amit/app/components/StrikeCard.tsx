"use client";

interface StrikeCardProps {
  strike: number;
  apr: number;
  selected: boolean;
  onClick: () => void;
}

export default function StrikeCard({
  strike,
  apr,
  selected,
  onClick,
}: StrikeCardProps) {
  // Color intensity based on APR (higher = more saturated)
  const aprClamped = Math.min(Math.max(apr, 0), 100);
  const intensity = 0.3 + (aprClamped / 100) * 0.7;

  return (
    <button
      onClick={onClick}
      className="relative flex flex-col items-center pt-5 pb-3 transition-all"
      style={{ minWidth: 90 }}
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
        APR {apr.toFixed(1)}%
      </div>

      {/* Card body */}
      <div
        className="flex h-16 w-full items-center justify-center rounded-lg border-2 font-mono text-sm font-semibold transition-all"
        style={{
          borderColor: selected ? "#d4a017" : "#d4cfc6",
          background: selected ? "rgba(212, 160, 23, 0.06)" : "#ffffff",
          color: "#1a1a1a",
          boxShadow: selected
            ? "0 0 0 1px rgba(212, 160, 23, 0.3)"
            : "0 1px 2px rgba(0,0,0,0.04)",
        }}
      >
        ${strike.toLocaleString()}
      </div>
    </button>
  );
}
