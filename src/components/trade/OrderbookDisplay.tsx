"use client";

import { useOrderbook } from "@/hooks/market/useOrderbook";
import { formatUsd, formatAmount } from "@/lib/derive/utils";
import { cn } from "@/lib/utils";

interface OrderbookDisplayProps {
  instrumentName: string | null;
}

export function OrderbookDisplay({ instrumentName }: OrderbookDisplayProps) {
  const orderbook = useOrderbook(instrumentName);

  if (!instrumentName) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select an instrument
      </div>
    );
  }

  const bids = orderbook?.bids?.slice(0, 10) ?? [];
  const asks = orderbook?.asks?.slice(0, 10)?.reverse() ?? [];

  const maxAmount = Math.max(
    ...bids.map(([, a]) => parseFloat(a)),
    ...asks.map(([, a]) => parseFloat(a)),
    0.001
  );

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-muted-foreground">Orderbook</h3>

      <div className="space-y-0.5 text-xs font-mono">
        {/* Header */}
        <div className="flex justify-between px-1 text-muted-foreground">
          <span>Price</span>
          <span>Size</span>
        </div>

        {/* Asks (sells) - shown in reverse so lowest ask is at bottom */}
        {asks.map(([price, amount], i) => {
          const pct = (parseFloat(amount) / maxAmount) * 100;
          return (
            <div
              key={`ask-${i}`}
              className="relative flex justify-between px-1 py-0.5"
            >
              <div
                className="absolute inset-y-0 right-0 bg-destructive/10"
                style={{ width: `${pct}%` }}
              />
              <span className="relative text-destructive">
                {formatUsd(price)}
              </span>
              <span className="relative text-muted-foreground">
                {formatAmount(amount)}
              </span>
            </div>
          );
        })}

        {/* Spread */}
        {bids.length > 0 && asks.length > 0 && (
          <div className="flex items-center justify-center py-1 text-muted-foreground">
            <span className="text-[10px]">
              Spread:{" "}
              {formatUsd(
                parseFloat(asks[asks.length - 1]?.[0] ?? "0") -
                  parseFloat(bids[0]?.[0] ?? "0")
              )}
            </span>
          </div>
        )}

        {/* Bids (buys) */}
        {bids.map(([price, amount], i) => {
          const pct = (parseFloat(amount) / maxAmount) * 100;
          return (
            <div
              key={`bid-${i}`}
              className="relative flex justify-between px-1 py-0.5"
            >
              <div
                className="absolute inset-y-0 right-0 bg-success/10"
                style={{ width: `${pct}%` }}
              />
              <span className="relative text-success">
                {formatUsd(price)}
              </span>
              <span className="relative text-muted-foreground">
                {formatAmount(amount)}
              </span>
            </div>
          );
        })}

        {bids.length === 0 && asks.length === 0 && (
          <div className="py-4 text-center text-muted-foreground">
            No orderbook data
          </div>
        )}
      </div>
    </div>
  );
}
