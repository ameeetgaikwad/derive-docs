"use client";

import { formatInstrumentName, formatUsd, formatAmount } from "@/lib/derive/utils";
import { Button } from "@/components/ui/button";
import { useCancelOrder } from "@/hooks/mutations/useCancelOrder";
import type { Order } from "@/lib/derive/types";
import { cn } from "@/lib/utils";

interface OpenOrdersTableProps {
  orders: Order[];
}

export function OpenOrdersTable({ orders }: OpenOrdersTableProps) {
  const cancelOrder = useCancelOrder();

  if (orders.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No open orders
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th className="pb-2 text-left font-medium">Instrument</th>
            <th className="pb-2 text-left font-medium">Side</th>
            <th className="pb-2 text-right font-medium">Size</th>
            <th className="pb-2 text-right font-medium">Filled</th>
            <th className="pb-2 text-right font-medium">Price</th>
            <th className="pb-2 text-right font-medium">Status</th>
            <th className="pb-2 text-right font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const isBuy = order.direction === "buy";
            return (
              <tr
                key={order.order_id}
                className="border-b border-border/50 transition-colors hover:bg-secondary/50"
              >
                <td className="py-3 font-medium">
                  {formatInstrumentName(order.instrument_name)}
                </td>
                <td className="py-3">
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-xs font-medium",
                      isBuy
                        ? "bg-success/10 text-success"
                        : "bg-destructive/10 text-destructive"
                    )}
                  >
                    {isBuy ? "BUY" : "SELL"}
                  </span>
                </td>
                <td className="py-3 text-right font-mono">
                  {formatAmount(order.amount)}
                </td>
                <td className="py-3 text-right font-mono text-muted-foreground">
                  {formatAmount(order.filled_amount)}
                </td>
                <td className="py-3 text-right font-mono">
                  {formatUsd(order.limit_price)}
                </td>
                <td className="py-3 text-right">
                  <span className="rounded bg-warning/10 px-1.5 py-0.5 text-xs text-warning">
                    {order.status}
                  </span>
                </td>
                <td className="py-3 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => cancelOrder.mutate({ orderId: order.order_id, instrumentName: order.instrument_name })}
                    disabled={cancelOrder.isPending}
                  >
                    Cancel
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
