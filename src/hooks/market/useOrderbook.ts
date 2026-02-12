"use client";

import { useEffect, useState, useCallback } from "react";
import { useDerive } from "@/providers/DeriveProvider";
import type { WsOrderbookData } from "@/lib/derive/types";

export function useOrderbook(instrumentName: string | null) {
  const { wsClient, isAuthenticated } = useDerive();
  const [orderbook, setOrderbook] = useState<WsOrderbookData | null>(null);

  useEffect(() => {
    if (!instrumentName || !wsClient.isConnected) return;

    const channel = `orderbook.${instrumentName}.1.20`;
    const unsubscribe = wsClient.subscribe(channel, (data) => {
      setOrderbook(data as WsOrderbookData);
    });

    return () => {
      unsubscribe();
      setOrderbook(null);
    };
  }, [instrumentName, wsClient, wsClient.isConnected]);

  return orderbook;
}
