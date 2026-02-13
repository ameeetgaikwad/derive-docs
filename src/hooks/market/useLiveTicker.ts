"use client";

import { useEffect, useState } from "react";
import { useDerive } from "@/providers/DeriveProvider";
import { useTicker } from "./useTicker";
import type { Ticker, WsTickerSlimData } from "@/lib/derive/types";

/** Partial ticker data from WS — price fields + stats + greeks */
export interface LiveTickerData {
  best_bid_price: string;
  best_bid_amount: string;
  best_ask_price: string;
  best_ask_amount: string;
  mark_price: string;
  index_price: string;
  timestamp: number;
  stats: {
    contract_volume: string;
    num_trades: string;
    open_interest: string;
    high: string;
    low: string;
    percent_change: string;
  };
  option_pricing: {
    delta?: string;
    gamma?: string;
    vega?: string;
    theta?: string;
    rho?: string;
    iv?: string;
  } | null;
}

function mapSlimToLiveTicker(slim: WsTickerSlimData): LiveTickerData {
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

export function useLiveTicker(instrumentName: string | null) {
  const { wsClient } = useDerive();
  const { data: restTicker, isLoading } = useTicker(instrumentName);
  const [wsLive, setWsLive] = useState<LiveTickerData | null>(null);

  useEffect(() => {
    if (!instrumentName || !wsClient.isConnected) return;

    const channel = `ticker_slim.${instrumentName}.1000`;
    const unsubscribe = wsClient.subscribe(channel, (data) => {
      setWsLive(mapSlimToLiveTicker(data as WsTickerSlimData));
    });

    return () => {
      unsubscribe();
      setWsLive(null);
    };
  }, [instrumentName, wsClient, wsClient.isConnected]);

  // Merge: REST ticker as base, WS live data overlaid
  let merged: Ticker | null = null;
  if (restTicker) {
    merged = { ...restTicker };
    if (wsLive) {
      merged.best_bid_price = wsLive.best_bid_price;
      merged.best_bid_amount = wsLive.best_bid_amount;
      merged.best_ask_price = wsLive.best_ask_price;
      merged.best_ask_amount = wsLive.best_ask_amount;
      merged.mark_price = wsLive.mark_price;
      merged.index_price = wsLive.index_price;
      merged.timestamp = wsLive.timestamp;
      merged.stats = { ...restTicker.stats, ...wsLive.stats };
      if (restTicker.option_pricing && wsLive.option_pricing) {
        merged.option_pricing = { ...restTicker.option_pricing, ...wsLive.option_pricing };
      }
    }
  }

  return {
    ticker: merged,
    isLoading,
    isLive: wsLive !== null,
  };
}
