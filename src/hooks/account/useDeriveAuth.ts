"use client";

import { useMemo } from "react";
import { useAccountStore } from "@/stores/account";
import { DeriveRestClient } from "@/lib/derive/client";
import { DeriveWebSocket } from "@/lib/derive/ws";

// Singleton instances shared across the entire app
let restClientInstance: DeriveRestClient | null = null;
let wsClientInstance: DeriveWebSocket | null = null;

/** Get the singleton REST client. Used by useDeriveAccount and useDeriveAuth. */
export function getSharedRestClient(): DeriveRestClient {
  if (!restClientInstance) {
    restClientInstance = new DeriveRestClient();
  }
  return restClientInstance;
}

/** Get the singleton WS client. */
export function getSharedWsClient(): DeriveWebSocket {
  if (!wsClientInstance) {
    wsClientInstance = new DeriveWebSocket();
  }
  return wsClientInstance;
}

export function useDeriveAuth() {
  const { sessionKey, status } = useAccountStore();

  const restClient = useMemo(() => getSharedRestClient(), [sessionKey]);

  const wsClient = useMemo(() => getSharedWsClient(), []);

  return {
    restClient,
    wsClient,
    isAuthenticated: status === "ready",
    subaccountId: sessionKey?.subaccount_id ?? null,
  };
}
