"use client";

import { STRATEGIES } from "@/lib/strategies/definitions";
import { StrategyCard } from "@/components/strategies/StrategyCard";
import { useSpotPrice } from "@/hooks/market/useSpotPrice";
import { formatUsd } from "@/lib/derive/utils";

export default function StrategiesContent() {
  const spotPrice = useSpotPrice();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Strategies</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick a strategy. We pick the best option for you.
          </p>
        </div>
        {spotPrice && (
          <div className="text-right">
            <p className="text-sm text-muted-foreground">ETH Spot</p>
            <p className="text-xl font-bold">{formatUsd(spotPrice)}</p>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-1">
        {STRATEGIES.map((strategy) => (
          <StrategyCard key={strategy.id} strategy={strategy} />
        ))}
      </div>
    </div>
  );
}
