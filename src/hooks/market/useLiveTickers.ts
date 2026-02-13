"use client";

import { useEffect, useRef, useCallback, useSyncExternalStore } from "react";
import { useDerive } from "@/providers/DeriveProvider";
import { useTickers } from "./useTickers";
import type {
  Ticker,
  TickerStats,
  OptionPricing,
  WsTickerSlimData,
} from "@/lib/derive/types";

/** Live data extracted from WS ticker_slim */
interface WsLiveData {
  best_bid_price: string;
  best_bid_amount: string;
  best_ask_price: string;
  best_ask_amount: string;
  mark_price: string;
  index_price: string;
  timestamp: number;
  stats: Partial<TickerStats>;
  option_pricing: Partial<OptionPricing> | null;
}

function mapSlimToLive(slim: WsTickerSlimData): WsLiveData {
  const t = slim.instrument_ticker;
  return {
    best_bid_price: t.b,
    best_bid_amount: t.B,
    best_ask_price: t.a,
    best_ask_amount: t.A,
    mark_price: t.M,
    index_price: t.I,
    timestamp: t.t,
    stats: {
      contract_volume: t.stats.c,
      num_trades: String(t.stats.n),
      open_interest: t.stats.oi,
      high: t.stats.h,
      low: t.stats.l,
      percent_change: t.stats.p,
    },
    option_pricing: t.option_pricing
      ? {
          ...(t.option_pricing.d !== undefined && { delta: t.option_pricing.d }),
          ...(t.option_pricing.g !== undefined && { gamma: t.option_pricing.g }),
          ...(t.option_pricing.v !== undefined && { vega: t.option_pricing.v }),
          ...(t.option_pricing.th !== undefined && { theta: t.option_pricing.th }),
          ...(t.option_pricing.r !== undefined && { rho: t.option_pricing.r }),
          ...(t.option_pricing.iv !== undefined && { iv: t.option_pricing.iv }),
        }
      : null,
  };
}

function mergeTicker(rest: Ticker, ws: WsLiveData): Ticker {
  return {
    ...rest,
    best_bid_price: ws.best_bid_price,
    best_bid_amount: ws.best_bid_amount,
    best_ask_price: ws.best_ask_price,
    best_ask_amount: ws.best_ask_amount,
    mark_price: ws.mark_price,
    index_price: ws.index_price,
    timestamp: ws.timestamp,
    stats: { ...rest.stats, ...ws.stats },
    option_pricing: rest.option_pricing
      ? { ...rest.option_pricing, ...ws.option_pricing }
      : ws.option_pricing
        ? (ws.option_pricing as OptionPricing)
        : null,
  };
}

/**
 * Subscribe to ticker_slim WS channels for multiple instruments.
 * Merges live WS prices, stats, and greeks on top of REST ticker data.
 * Returns a Map<instrumentName, Ticker> that updates in real-time (~1s).
 */
export function useLiveTickers(instrumentNames: string[]) {
  const { wsClient } = useDerive();
  const restQueries = useTickers(instrumentNames);

  // Store WS live data in a ref + manual subscribers for efficient updates
  const wsDataRef = useRef(new Map<string, WsLiveData>());
  const listenersRef = useRef(new Set<() => void>());
  const versionRef = useRef(0);

  const subscribe = useCallback((listener: () => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const getSnapshot = useCallback(() => versionRef.current, []);

  // Force re-render when WS data changes
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Stable key for effect dependency
  const namesKey = instrumentNames.join(",");

  useEffect(() => {
    if (!wsClient.isConnected || instrumentNames.length === 0) return;

    const unsubs: (() => void)[] = [];

    for (const name of instrumentNames) {
      const channel = `ticker_slim.${name}.1000`;
      const unsub = wsClient.subscribe(channel, (data) => {
        wsDataRef.current.set(name, mapSlimToLive(data as WsTickerSlimData));
        versionRef.current++;
        for (const listener of listenersRef.current) listener();
      });
      unsubs.push(unsub);
    }

    return () => {
      for (const unsub of unsubs) unsub();
      wsDataRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey, wsClient, wsClient.isConnected]);

  // Build merged ticker map: REST base + WS overlay
  const tickerMap = new Map<string, Ticker>();
  restQueries.forEach((q, idx) => {
    const name = instrumentNames[idx];
    if (!q.data) return;
    const wsLive = wsDataRef.current.get(name);
    tickerMap.set(name, wsLive ? mergeTicker(q.data, wsLive) : q.data);
  });

  const isLoading = restQueries.some((q) => q.isLoading);

  return { tickerMap, isLoading };
}
