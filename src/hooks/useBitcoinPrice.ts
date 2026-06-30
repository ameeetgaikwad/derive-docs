"use client";

import { useQuery } from "@tanstack/react-query";

export type BitcoinPriceSnapshot = {
  price: number;
  symbol: string;
  requestedAt?: string;
};

type BitcoinPriceResponse = {
  success: boolean;
  price?: number;
  symbol?: string;
  requestedAt?: string;
  error?: string;
  details?: string;
};

type BitcoinPriceHistoryResponse = {
  success: boolean;
  symbol?: string;
  points?: BitcoinPriceHistoryPoint[];
  error?: string;
};

async function fetchBitcoinPrice(): Promise<BitcoinPriceSnapshot> {
  const response = await fetch("/api/bitcoin-price");

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = (await response.json()) as BitcoinPriceResponse;

  if (!data.success || !data.price || !data.symbol) {
    throw new Error(data.error || "Failed to fetch BTC price");
  }

  return {
    price: data.price,
    symbol: data.symbol,
    requestedAt: data.requestedAt,
  };
}

export function useBitcoinPrice(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["btc-price"],
    queryFn: fetchBitcoinPrice,
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 3,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    enabled: options?.enabled ?? true,
  });
}

export type BitcoinPriceHistoryPoint = {
  time: number;
  value: number;
};

async function fetchBitcoinPriceHistory(): Promise<BitcoinPriceHistoryPoint[]> {
  const response = await fetch("/api/bitcoin-price?history=30d");

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = (await response.json()) as BitcoinPriceHistoryResponse;
  if (!data.success || !Array.isArray(data.points)) {
    throw new Error(data.error || "Failed to fetch BTC price history");
  }

  return data.points.filter(
    (point) =>
      Number.isFinite(point.time) &&
      Number.isFinite(point.value) &&
      point.value > 0,
  );
}

export function useBitcoinPriceHistory(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["btc-price", { history: "30d", interval: "1d" }],
    queryFn: fetchBitcoinPriceHistory,
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 0,
    refetchOnMount: true,
    enabled: options?.enabled ?? true,
  });
}
