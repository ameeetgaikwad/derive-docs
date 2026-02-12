"use client";

import type { StrategyId } from "@/lib/strategies/types";

interface PayoffDiagramProps {
  strategyId: StrategyId;
  strikePrice: number;
  premium: number;
  spotPrice: number;
  width?: number;
  height?: number;
}

export function PayoffDiagram({
  strategyId,
  strikePrice,
  premium,
  spotPrice,
  width = 240,
  height = 120,
}: PayoffDiagramProps) {
  const pad = 20;
  const w = width - pad * 2;
  const h = height - pad * 2;

  // Price range: spot +/- 30%
  const minPrice = spotPrice * 0.7;
  const maxPrice = spotPrice * 1.3;

  const priceToX = (price: number) =>
    pad + ((price - minPrice) / (maxPrice - minPrice)) * w;

  const pnlToY = (pnl: number) => {
    const maxPnl = premium * 3;
    const minPnl = -premium * 2;
    const range = maxPnl - minPnl;
    return pad + h - ((pnl - minPnl) / range) * h;
  };

  const zeroY = pnlToY(0);
  const strikeX = priceToX(strikePrice);
  const spotX = priceToX(spotPrice);

  // Build payoff path points
  const points: string[] = [];
  const steps = 50;

  for (let i = 0; i <= steps; i++) {
    const price = minPrice + (i / steps) * (maxPrice - minPrice);
    let pnl: number;

    switch (strategyId) {
      case "bullish_bet": // Long call
        pnl = Math.max(price - strikePrice, 0) - premium;
        break;
      case "downside_protection": // Long put
        pnl = Math.max(strikePrice - price, 0) - premium;
        break;
      case "earn_sideways": // Short call
        pnl = premium - Math.max(price - strikePrice, 0);
        break;
    }

    points.push(`${priceToX(price)},${pnlToY(pnl)}`);
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      style={{ maxWidth: width }}
    >
      {/* Zero line */}
      <line
        x1={pad}
        y1={zeroY}
        x2={width - pad}
        y2={zeroY}
        stroke="var(--muted-foreground)"
        strokeWidth={1}
        strokeDasharray="3,3"
      />

      {/* Strike price vertical */}
      <line
        x1={strikeX}
        y1={pad}
        x2={strikeX}
        y2={height - pad}
        stroke="var(--muted-foreground)"
        strokeWidth={1}
        strokeDasharray="2,2"
        opacity={0.5}
      />

      {/* Spot price marker */}
      <line
        x1={spotX}
        y1={pad}
        x2={spotX}
        y2={height - pad}
        stroke="var(--foreground)"
        strokeWidth={1}
        opacity={0.5}
      />

      {/* Payoff line */}
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="var(--foreground)"
        strokeWidth={2}
      />

      {/* Labels */}
      <text
        x={strikeX}
        y={height - 4}
        textAnchor="middle"
        fontSize={9}
        fill="var(--muted-foreground)"
        fontFamily="var(--font-mono), monospace"
      >
        Strike
      </text>
      <text
        x={spotX}
        y={pad - 4}
        textAnchor="middle"
        fontSize={9}
        fill="var(--foreground)"
        fontFamily="var(--font-mono), monospace"
      >
        Spot
      </text>
      <text
        x={pad - 2}
        y={zeroY - 4}
        textAnchor="start"
        fontSize={8}
        fill="var(--muted-foreground)"
        fontFamily="var(--font-mono), monospace"
      >
        $0
      </text>
    </svg>
  );
}
