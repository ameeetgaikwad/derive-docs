"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { getAddress } from "viem";
import { resolveDeriveSCW } from "@/lib/derive/utils";
import { getSharedRestClient } from "./useDeriveAuth";
import { saveDeriveWallet, loadDeriveWallet } from "@/lib/derive/session";

const client = getSharedRestClient();

// ─── Shared module-level state (singleton across all components) ───

interface WalletAuthState {
  isWalletAuthed: boolean;
  walletSubaccountId: number | null;
  deriveWallet: `0x${string}` | null;
  error: string | null;
  isAuthenticating: boolean;
  authedAddress: string | null; // track which address is authed
}

let state: WalletAuthState = {
  isWalletAuthed: false,
  walletSubaccountId: null,
  deriveWallet: null,
  error: null,
  isAuthenticating: false,
  authedAddress: null,
};

let authInProgress = false;
const listeners = new Set<() => void>();

function getState() { return state; }
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
function setState(partial: Partial<WalletAuthState>) {
  state = { ...state, ...partial };
  listeners.forEach((cb) => cb());
}

/**
 * Simplified wallet auth — no session keys, no on-chain tx.
 * Shared state: all components calling useWalletAuth() see the same state.
 */
export function useWalletAuth() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const current = useSyncExternalStore(subscribe, getState, getState);

  // Reset on disconnect or address change
  useEffect(() => {
    if (!isConnected || !address) {
      setState({
        isWalletAuthed: false,
        walletSubaccountId: null,
        deriveWallet: null,
        error: null,
        isAuthenticating: false,
        authedAddress: null,
      });
      authInProgress = false;
    } else if (address !== current.authedAddress && current.isWalletAuthed) {
      // Address changed — reset
      setState({
        isWalletAuthed: false,
        walletSubaccountId: null,
        deriveWallet: null,
        error: null,
        authedAddress: null,
      });
    }
  }, [isConnected, address]);

  const authenticate = useCallback(async () => {
    if (!address || !walletClient) {
      setState({ error: "Wallet not connected" });
      return;
    }

    // Already authed for this address
    if (state.isWalletAuthed && state.authedAddress === address) return;
    if (authInProgress) return;
    authInProgress = true;
    setState({ isAuthenticating: true, error: null });

    try {
      // Step 1: Resolve Derive SCW (no popup, deterministic)
      let scw: `0x${string}`;
      const cached = loadDeriveWallet(address);
      if (cached) {
        scw = cached;
      } else {
        scw = await resolveDeriveSCW(address);
        scw = getAddress(scw);
        saveDeriveWallet(address, scw);
      }
      setState({ deriveWallet: scw });

      // Step 2: Set REST client auth using EOA wallet signing
      client.setAuth(scw, async (message: string) => {
        return walletClient.signMessage({ message });
      });

      // Step 3: Fetch subaccounts (public-ish — uses auth headers but no popup)
      let subId: number | null = null;

      try {
        const account = await client.getAccount(scw);
        if (account.subaccount_ids?.length) {
          subId = account.subaccount_ids[0];
        }
      } catch {
        try {
          const subs = await client.getSubaccounts(scw);
          if (subs.length > 0) {
            subId = subs[0].subaccount_id;
          }
        } catch (err) {
          console.warn("[WalletAuth] No subaccounts:", err);
        }
      }

      if (subId) {
        setState({
          walletSubaccountId: subId,
          isWalletAuthed: true,
          authedAddress: address,
        });
        console.log("[WalletAuth] Done! SCW:", scw, "subaccount:", subId);
      } else {
        setState({ error: "No Derive subaccount found. Create one on app.derive.xyz first." });
      }
    } catch (err) {
      console.error("[WalletAuth] Error:", err);
      setState({ error: `Wallet auth failed: ${(err as Error).message}` });
    } finally {
      authInProgress = false;
      setState({ isAuthenticating: false });
    }
  }, [address, walletClient]);

  return {
    authenticate,
    isWalletAuthed: current.isWalletAuthed,
    walletSubaccountId: current.walletSubaccountId,
    deriveWallet: current.deriveWallet,
    error: current.error,
    isAuthenticating: current.isAuthenticating,
  };
}
