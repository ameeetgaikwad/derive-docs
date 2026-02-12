"use client";

import { formatInstrumentName, formatUsd, formatAmount } from "@/lib/derive/utils";
import { Button } from "@/components/ui/button";
import type { Position } from "@/lib/derive/types";
import { cn } from "@/lib/utils";

interface PositionsTableProps {
  positions: Position[];
  onClose?: (instrumentName: string) => void;
}

export function PositionsTable({ positions, onClose }: PositionsTableProps) {
  if (positions.length === 0) {
    return (
      <div className="py-8 text-center font-mono text-sm text-muted-foreground">
        No open positions
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full font-mono text-sm">
        <thead>
          <tr className="border-b-2 border-border text-xs text-muted-foreground">
            <th className="pb-2 text-left font-medium">Instrument</th>
            <th className="pb-2 text-left font-medium">Side</th>
            <th className="pb-2 text-right font-medium">Size</th>
            <th className="pb-2 text-right font-medium">Entry</th>
            <th className="pb-2 text-right font-medium">Mark</th>
            <th className="pb-2 text-right font-medium">PnL</th>
            <th className="pb-2 text-right font-medium">Delta</th>
            <th className="pb-2 text-right font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {positions.map((pos) => {
            const pnl = parseFloat(pos.unrealized_pnl || "0");
            const isLong = pos.direction === "buy";

            return (
              <tr
                key={pos.instrument_name}
                className="border-b border-border/30 transition-colors hover:bg-secondary/50"
              >
                <td className="py-3 font-medium">
                  {formatInstrumentName(pos.instrument_name)}
                </td>
                <td className="py-3">
                  <span
                    className={cn(
                      "rounded border px-1.5 py-0.5 text-xs font-medium",
                      isLong
                        ? "border-success/30 bg-success/5 text-success"
                        : "border-destructive/30 bg-destructive/5 text-destructive"
                    )}
                  >
                    {isLong ? "LONG" : "SHORT"}
                  </span>
                </td>
                <td className="py-3 text-right">
                  {formatAmount(pos.amount)}
                </td>
                <td className="py-3 text-right">
                  {formatUsd(pos.average_price)}
                </td>
                <td className="py-3 text-right">
                  {formatUsd(pos.mark_price)}
                </td>
                <td
                  className={cn(
                    "py-3 text-right font-medium",
                    pnl >= 0 ? "text-success" : "text-destructive"
                  )}
                >
                  {pnl >= 0 ? "+" : ""}
                  {formatUsd(pnl)}
                </td>
                <td className="py-3 text-right text-muted-foreground">
                  {pos.greeks?.delta
                    ? parseFloat(pos.greeks.delta).toFixed(3)
                    : "-"}
                </td>
                <td className="py-3 text-right">
                  {onClose && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-muted-foreground hover:text-destructive"
                      onClick={() => onClose(pos.instrument_name)}
                    >
                      Close
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
