"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useDeriveAccount } from "@/hooks/account/useDeriveAccount";
import { useDeriveAuth } from "@/hooks/account/useDeriveAuth";
import { useAccountStore } from "@/stores/account";
import { getWsLoginParams } from "@/lib/derive/auth";
import type { DeriveRestClient } from "@/lib/derive/client";
import type { DeriveWebSocket } from "@/lib/derive/ws";
import type { OnboardingStatus } from "@/stores/account";

interface DeriveContextValue {
  status: OnboardingStatus;
  isReady: boolean;
  isOnboarding: boolean;
  needsAccount: boolean;
  needsAuth: boolean;
  error: string | null;
  subaccountId: number | null;
  deriveWallet: `0x${string}` | null;
  restClient: DeriveRestClient;
  wsClient: DeriveWebSocket;
  isAuthenticated: boolean;
  authenticate: () => Promise<void>;
}

const DeriveContext = createContext<DeriveContextValue | null>(null);

export function DeriveProvider({ children }: { children: ReactNode }) {
  const account = useDeriveAccount();
  const auth = useDeriveAuth();
  const { sessionKey, deriveWallet } = useAccountStore();

  // Always connect WebSocket for public channels (orderbook, tickers)
  useEffect(() => {
    auth.wsClient.connect();
    return () => {
      auth.wsClient.disconnect();
    };
  }, []);

  // When WS reconnects and we have a session key, auto-login for private channels
  useEffect(() => {
    if (!sessionKey || !deriveWallet) return;

    const unsub = auth.wsClient.onStatus(async (status) => {
      if (status === "connected" && sessionKey && deriveWallet) {
        try {
          const loginParams = await getWsLoginParams(sessionKey.private_key, deriveWallet);
          await auth.wsClient.login(loginParams.wallet, loginParams.timestamp, loginParams.signature);
        } catch (err) {
          console.warn("WS auto-login failed:", err);
        }
      }
    });

    return unsub;
  }, [sessionKey, deriveWallet]);

  const value: DeriveContextValue = {
    status: account.status,
    isReady: account.isReady,
    isOnboarding: account.isOnboarding,
    needsAccount: account.needsAccount,
    needsAuth: account.needsAuth,
    error: account.error,
    subaccountId: auth.subaccountId ?? account.activeSubaccountId,
    deriveWallet: account.deriveWallet,
    restClient: auth.restClient,
    wsClient: auth.wsClient,
    isAuthenticated: auth.isAuthenticated,
    authenticate: account.authenticate,
  };

  return (
    <DeriveContext.Provider value={value}>{children}</DeriveContext.Provider>
  );
}

export function useDerive() {
  const ctx = useContext(DeriveContext);
  if (!ctx) {
    throw new Error("useDerive must be used within a DeriveProvider");
  }
  return ctx;
}
