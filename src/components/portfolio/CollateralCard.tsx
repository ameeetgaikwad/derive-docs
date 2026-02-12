"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { formatUsd } from "@/lib/derive/utils";
import type { Collateral } from "@/lib/derive/types";

interface CollateralCardProps {
  collaterals: Collateral[];
}

export function CollateralCard({ collaterals }: CollateralCardProps) {
  const totalValue = collaterals.reduce(
    (sum, c) => sum + parseFloat(c.mark_value || "0"),
    0
  );

  return (
    <Card terminalPath="~/portfolio/collateral">
      <CardHeader>
        <CardTitle className="text-base">Collateral</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-mono text-sm text-muted-foreground">Total Value</span>
          <span className="font-mono text-lg font-bold">{formatUsd(totalValue)}</span>
        </div>

        {collaterals.length > 0 ? (
          <div className="space-y-2">
            {collaterals.map((c) => (
              <div
                key={c.asset_name}
                className="flex items-center justify-between font-mono text-sm"
              >
                <span className="text-muted-foreground">{c.asset_name}</span>
                <div className="text-right">
                  <span>{parseFloat(c.amount).toFixed(4)}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({formatUsd(c.mark_value)})
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="font-mono text-sm text-muted-foreground">No collateral deposited</p>
        )}
      </CardContent>
    </Card>
  );
}
