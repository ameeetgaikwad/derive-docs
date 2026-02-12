"use client";

import { useEffect, useState } from "react";
import { useDerive } from "@/providers/DeriveProvider";
import { useTicker } from "./useTicker";
import type { WsTickerSlimData } from "@/lib/derive/types";

/** Partial ticker data from WS — just the fields we need for display */
export interface LiveTickerData {
  best_bid_price: string;
  best_bid_amount: string;
  best_ask_price: string;
  best_ask_amount: string;
  mark_price: string;
  index_price: string;
  timestamp: number;
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
  const merged = restTicker
    ? {
        ...restTicker,
        ...(wsLive && {
          best_bid_price: wsLive.best_bid_price,
          best_bid_amount: wsLive.best_bid_amount,
          best_ask_price: wsLive.best_ask_price,
          best_ask_amount: wsLive.best_ask_amount,
          mark_price: wsLive.mark_price,
          index_price: wsLive.index_price,
          timestamp: wsLive.timestamp,
        }),
      }
    : null;

  return {
    ticker: merged,
    isLoading,
    isLive: wsLive !== null,
  };
}
