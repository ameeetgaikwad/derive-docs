"use client";

import { useEffect, useRef, useState } from "react";
import { useDerive } from "@/providers/DeriveProvider";

export function WsStatusBanner() {
  const { wsClient } = useDerive();
  const [status, setStatus] = useState<string>(wsClient.isConnected ? "connected" : "disconnected");
  const wasConnected = useRef(wsClient.isConnected);

  useEffect(() => {
    const unsub = wsClient.onStatus((s) => {
      if (s === "connected") wasConnected.current = true;
      setStatus(s);
    });
    return unsub;
  }, [wsClient]);

  // Only show banner on RE-connections (after having been connected at least once)
  if (!wasConnected.current || status === "connected") return null;

  const isReconnecting = status === "connecting" || status === "disconnected";

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-md border-2 border-border bg-card px-4 py-2 font-mono text-sm shadow-lg">
      <div className="h-2 w-2 rounded-full bg-warning animate-pulse" />
      <span className="text-muted-foreground">
        {isReconnecting ? "Reconnecting to live data..." : "Connection error"}
      </span>
    </div>
  );
}
