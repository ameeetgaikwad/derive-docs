"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { OptionChain } from "@/components/trade/OptionChain";
import { TradePanel } from "@/components/trade/TradePanel";
import { OrderbookDisplay } from "@/components/trade/OrderbookDisplay";
import { useMarketsStore } from "@/stores/markets";
import { useTradeStore } from "@/stores/trade";
import { useSpotPrice } from "@/hooks/market/useSpotPrice";
import { formatUsd } from "@/lib/derive/utils";
import type { OrderDirection } from "@/lib/derive/types";

function TradeInner() {
  const searchParams = useSearchParams();
  const { selectedInstrument, setSelectedInstrument, setSelectedExpiry } =
    useMarketsStore();
  const { setDirection } = useTradeStore();
  const spotPrice = useSpotPrice();

  useEffect(() => {
    const expiry = searchParams.get("expiry");
    if (expiry) {
      setSelectedExpiry(Number(expiry));
    }
  }, [searchParams]);

  const handleSelectInstrument = (
    instrumentName: string,
    direction: OrderDirection
  ) => {
    setSelectedInstrument(instrumentName);
    setDirection(direction);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Trade</h1>
        {spotPrice && (
          <div className="text-right">
            <span className="text-sm text-muted-foreground">ETH </span>
            <span className="text-lg font-bold">{formatUsd(spotPrice)}</span>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px_300px]">
        <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card p-4">
          <OptionChain onSelectInstrument={handleSelectInstrument} />
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <OrderbookDisplay instrumentName={selectedInstrument} />
        </div>
        <div>
          <TradePanel />
        </div>
      </div>
    </div>
  );
}

export default function TradeContent() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <h1 className="text-2xl font-bold">Trade</h1>
          <div className="h-96 animate-pulse rounded-lg bg-muted" />
        </div>
      }
    >
      <TradeInner />
    </Suspense>
  );
}
