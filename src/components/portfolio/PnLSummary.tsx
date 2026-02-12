"use client";

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { formatUsd } from "@/lib/derive/utils";
import type { Position } from "@/lib/derive/types";
import { cn } from "@/lib/utils";

interface PnLSummaryProps {
  positions: Position[];
}

export function PnLSummary({ positions }: PnLSummaryProps) {
  const stats = useMemo(() => {
    let unrealizedPnl = 0;
    let realizedPnl = 0;
    let netDelta = 0;
    let portfolioValue = 0;

    for (const pos of positions) {
      unrealizedPnl += parseFloat(pos.unrealized_pnl || "0");
      realizedPnl += parseFloat(pos.realized_pnl || "0");
      netDelta += parseFloat(pos.greeks?.delta || "0") * parseFloat(pos.amount);
      portfolioValue +=
        parseFloat(pos.mark_price || "0") * parseFloat(pos.amount);
    }

    return { unrealizedPnl, realizedPnl, netDelta, portfolioValue };
  }, [positions]);

  const cards = [
    {
      label: "Portfolio Value",
      value: formatUsd(stats.portfolioValue),
      color: "text-foreground",
    },
    {
      label: "Unrealized PnL",
      value: formatUsd(stats.unrealizedPnl),
      color:
        stats.unrealizedPnl >= 0 ? "text-success" : "text-destructive",
    },
    {
      label: "Realized PnL",
      value: formatUsd(stats.realizedPnl),
      color:
        stats.realizedPnl >= 0 ? "text-success" : "text-destructive",
    },
    {
      label: "Net Delta",
      value: stats.netDelta.toFixed(4),
      color: "text-foreground",
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label} className="py-4">
          <p className="text-xs text-muted-foreground">{card.label}</p>
          <p className={cn("mt-1 text-xl font-bold", card.color)}>
            {card.value}
          </p>
        </Card>
      ))}
    </div>
  );
}
