"use client";

import { useMemo } from "react";
import { useInstruments } from "@/hooks/market/useInstruments";
import { useTicker } from "@/hooks/market/useTicker";
import { useSpotPrice } from "@/hooks/market/useSpotPrice";
import { resolveStrategy } from "@/lib/strategies/resolver";
import type { StrategyDefinition, StrategyPreview } from "@/lib/strategies/types";

export function useStrategyPreview(
  strategy: StrategyDefinition
): { preview: StrategyPreview | null; isLoading: boolean } {
  const { data: instruments, isLoading: instLoading } = useInstruments("ETH", "option");
  const spotPrice = useSpotPrice();

  const resolvedInstrument = useMemo(() => {
    if (!instruments || !spotPrice) return null;
    return resolveStrategy(strategy, instruments, spotPrice);
  }, [instruments, spotPrice, strategy]);

  const { data: ticker, isLoading: tickerLoading } = useTicker(
    resolvedInstrument?.instrument_name ?? null
  );

  const preview = useMemo((): StrategyPreview | null => {
    if (!resolvedInstrument || !spotPrice) return null;

    const strikePrice = parseFloat(resolvedInstrument.option_details?.strike ?? "0");
    const askPrice = ticker ? parseFloat(ticker.best_ask_price) : 0;
    const bidPrice = ticker ? parseFloat(ticker.best_bid_price) : 0;

    // For buying strategies, cost is the ask; for selling, income is the bid
    const isBuying = strategy.direction === "buy";
    const premium = isBuying ? askPrice : bidPrice;

    let breakeven: number;
    let maxLoss: number;
    let maxGain: number | null;

    if (strategy.id === "bullish_bet") {
      breakeven = strikePrice + premium;
      maxLoss = premium;
      maxGain = null; // unlimited
    } else if (strategy.id === "downside_protection") {
      breakeven = strikePrice - premium;
      maxLoss = premium;
      maxGain = strikePrice - premium;
    } else {
      // earn_sideways (sell call)
      breakeven = strikePrice + premium;
      maxLoss = -1; // technically unlimited
      maxGain = premium;
    }

    return {
      strategy,
      instrument: resolvedInstrument,
      ticker: ticker ?? null,
      estimatedCost: premium,
      breakeven,
      maxLoss,
      maxGain,
      spotPrice,
      strikePrice,
    };
  }, [resolvedInstrument, ticker, spotPrice, strategy]);

  return {
    preview,
    isLoading: instLoading || tickerLoading,
  };
}
