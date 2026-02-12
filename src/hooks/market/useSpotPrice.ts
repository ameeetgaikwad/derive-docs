"use client";

import { useEffect } from "react";
import { useTicker } from "./useTicker";
import { useDerive } from "@/providers/DeriveProvider";
import { useMarketsStore } from "@/stores/markets";

export function useSpotPrice() {
  const { wsClient } = useDerive();
  const { data: perpTicker } = useTicker("ETH-PERP");
  const { spotPrice, setSpotPrice } = useMarketsStore();

  // Update from REST ticker
  useEffect(() => {
    if (perpTicker?.index_price) {
      setSpotPrice(parseFloat(perpTicker.index_price));
    }
  }, [perpTicker?.index_price]);

  // Update from WebSocket (channel format: ticker-{instrument}-{interval})
  useEffect(() => {
    if (!wsClient.isConnected) return;

    const unsubscribe = wsClient.subscribe("ticker_slim.ETH-PERP.1000", (data) => {
      const ticker = data as { instrument_ticker?: { I?: string } };
      if (ticker.instrument_ticker?.I) {
        setSpotPrice(parseFloat(ticker.instrument_ticker.I));
      }
    });

    return unsubscribe;
  }, [wsClient, wsClient.isConnected]);

  return spotPrice;
}
