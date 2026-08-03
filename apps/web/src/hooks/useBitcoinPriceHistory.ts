"use client";

import { useQuery } from "@tanstack/react-query";
import type { BitcoinPriceHistoryPoint } from "@/lib/market/bitcoin-history";

type BitcoinPriceHistoryResponse = {
  success: boolean;
  points?: BitcoinPriceHistoryPoint[];
  error?: string;
};

async function fetchBitcoinPriceHistory(): Promise<BitcoinPriceHistoryPoint[]> {
  const response = await fetch("/api/bitcoin-price?history=30d");
  const payload = (await response.json()) as BitcoinPriceHistoryResponse;

  if (!response.ok || !payload.success || !Array.isArray(payload.points)) {
    throw new Error(payload.error || "Failed to fetch BTC price history");
  }

  return payload.points.filter(
    (point) =>
      Number.isFinite(point.time) &&
      point.time > 0 &&
      Number.isFinite(point.value) &&
      point.value > 0,
  );
}

export function useBitcoinPriceHistory() {
  return useQuery({
    queryKey: ["btc-price-history", "30d"],
    queryFn: fetchBitcoinPriceHistory,
    refetchInterval: 5 * 60 * 1_000,
    staleTime: 5 * 60 * 1_000,
    retry: 1,
    refetchOnMount: true,
  });
}
