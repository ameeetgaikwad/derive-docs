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
  authedAddress: string | null;
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
 * Try to fetch subaccounts from Derive API using pre-signed auth headers.
 * Uses the Next.js API proxy to avoid CORS.
 */
async function tryGetSubaccounts(
  wallet: string,
  timestamp: string,
  signature: string
): Promise<{ ok: boolean; ids: number[] }> {
  try {
    // Strip 0x prefix from signature — Derive expects raw hex
    const sigNoPrefix = signature.startsWith("0x") ? signature.slice(2) : signature;

    const res = await fetch("/api/derive/private/get_subaccounts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-LyraWallet": wallet,
        "X-LyraTimestamp": timestamp,
        "X-LyraSignature": sigNoPrefix,
      },
      body: JSON.stringify({ wallet }),
    });
    const data = await res.json();
    console.log("[WalletAuth] get_subaccounts response for", wallet, ":", JSON.stringify(data).slice(0, 200));

    if (data.error) return { ok: false, ids: [] };

    // Response can be { result: { subaccount_ids: [...] } } or { result: [...] }
    const ids: number[] = data.result?.subaccount_ids ?? data.result ?? [];
    if (Array.isArray(ids) && ids.length > 0) {
      return { ok: true, ids };
    }
    return { ok: false, ids: [] };
  } catch (err) {
    console.warn("[WalletAuth] tryGetSubaccounts error:", err);
    return { ok: false, ids: [] };
  }
}

/**
 * Simplified wallet auth — no session keys, no on-chain tx.
 * Signs ONE message (timestamp), then reuses the signature for API calls.
 * Tries: EOA as wallet → SCW as wallet → saved Derive wallet.
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

    if (state.isWalletAuthed && state.authedAddress === address) return;
    if (authInProgress) return;
    authInProgress = true;
    setState({ isAuthenticating: true, error: null });

    try {
      // Step 1: Sign timestamp ONCE (one MetaMask popup)
      const timestamp = Date.now().toString();
      const signature = await walletClient.signMessage({
        message: timestamp,
        account: walletClient.account,
      });
      console.log("[WalletAuth] Signed timestamp. EOA:", address);

      // Step 2: Try EOA as wallet (some accounts are under EOA directly)
      console.log("[WalletAuth] Trying EOA as wallet...");
      const eoaResult = await tryGetSubaccounts(address, timestamp, signature);
      if (eoaResult.ok) {
        console.log("[WalletAuth] EOA account found! subaccounts:", eoaResult.ids);
        const walletAddr = getAddress(address);
        // Set REST client auth with cached signature for future calls
        client.setAuth(walletAddr, async (msg) => {
          // For subsequent calls, re-sign with wallet
          return walletClient.signMessage({ message: msg });
        });
        setState({
          deriveWallet: walletAddr,
          walletSubaccountId: eoaResult.ids[0],
          isWalletAuthed: true,
          authedAddress: address,
        });
        return;
      }

      // Step 3: Try SCW as wallet
      console.log("[WalletAuth] Trying SCW as wallet...");
      let scw: `0x${string}`;
      const cached = loadDeriveWallet(address);
      if (cached) {
        scw = cached;
      } else {
        scw = getAddress(await resolveDeriveSCW(address));
        saveDeriveWallet(address, scw);
      }
      console.log("[WalletAuth] Resolved SCW:", scw);

      const scwResult = await tryGetSubaccounts(scw, timestamp, signature);
      if (scwResult.ok) {
        console.log("[WalletAuth] SCW account found! subaccounts:", scwResult.ids);
        client.setAuth(scw, async (msg) => {
          return walletClient.signMessage({ message: msg });
        });
        setState({
          deriveWallet: scw,
          walletSubaccountId: scwResult.ids[0],
          isWalletAuthed: true,
          authedAddress: address,
        });
        return;
      }

      // Step 4: Check localStorage for previously saved Derive wallet
      const savedWallet = localStorage.getItem(`derive_wallet_${address}`);
      if (savedWallet && savedWallet !== address && savedWallet !== scw) {
        console.log("[WalletAuth] Trying saved Derive wallet:", savedWallet);
        const savedResult = await tryGetSubaccounts(savedWallet, timestamp, signature);
        if (savedResult.ok) {
          console.log("[WalletAuth] Saved wallet account found! subaccounts:", savedResult.ids);
          client.setAuth(savedWallet as `0x${string}`, async (msg) => {
            return walletClient.signMessage({ message: msg });
          });
          setState({
            deriveWallet: savedWallet as `0x${string}`,
            walletSubaccountId: savedResult.ids[0],
            isWalletAuthed: true,
            authedAddress: address,
          });
          return;
        }
      }

      // All methods failed
      console.warn("[WalletAuth] No account found. EOA:", address, "SCW:", scw);
      setState({
        deriveWallet: scw,
        error: "No Derive account found. Please create one on app.derive.xyz first, then try again.",
      });
    } catch (err) {
      console.error("[WalletAuth] Error:", err);
      setState({ error: `Auth failed: ${(err as Error).message}` });
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
