"use client";

import { usePositions } from "@/hooks/portfolio/usePositions";
import { useCollaterals } from "@/hooks/portfolio/useCollaterals";
import { useOpenOrders } from "@/hooks/portfolio/useOpenOrders";
import { useDerive } from "@/providers/DeriveProvider";
import { PnLSummary } from "@/components/portfolio/PnLSummary";
import { PositionsTable } from "@/components/portfolio/PositionsTable";
import { CollateralCard } from "@/components/portfolio/CollateralCard";
import { OpenOrdersTable } from "@/components/portfolio/OpenOrdersTable";
import { ExpiryTimeline } from "@/components/portfolio/ExpiryTimeline";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export default function PortfolioContent() {
  const { isAuthenticated } = useDerive();
  const { data: positions = [], isLoading: posLoading } = usePositions();
  const { data: collaterals = [], isLoading: colLoading } = useCollaterals();
  const { data: openOrders = [], isLoading: ordLoading } = useOpenOrders();

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
        <h1 className="text-2xl font-bold">Portfolio</h1>
        <p className="mt-2 text-muted-foreground">
          Connect your wallet to view your portfolio.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Portfolio</h1>
      <PnLSummary positions={positions} />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Open Positions</CardTitle>
        </CardHeader>
        <CardContent>
          {posLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-muted" />
              ))}
            </div>
          ) : (
            <PositionsTable positions={positions} />
          )}
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Open Orders</CardTitle>
          </CardHeader>
          <CardContent>
            {ordLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="h-10 animate-pulse rounded bg-muted" />
                ))}
              </div>
            ) : (
              <OpenOrdersTable orders={openOrders} />
            )}
          </CardContent>
        </Card>
        <div className="space-y-4">
          {colLoading ? (
            <Card className="animate-pulse">
              <div className="h-24" />
            </Card>
          ) : (
            <CollateralCard collaterals={collaterals} />
          )}
          <Card>
            <CardContent className="pt-4">
              <ExpiryTimeline positions={positions} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
