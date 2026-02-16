"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { getAddress } from "viem";
import { resolveDeriveSCW } from "@/lib/derive/utils";
import { getSharedRestClient } from "./useDeriveAuth";
import { saveDeriveWallet, loadDeriveWallet } from "@/lib/derive/session";

const client = getSharedRestClient();

/**
 * Simplified wallet auth — no session keys, no on-chain tx.
 * Uses the EOA wallet directly to sign REST API auth headers.
 * Manages its OWN state (not the shared account store) to avoid
 * conflicts with useDeriveAccount's session key flow.
 */
export function useWalletAuth() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const authInProgress = useRef(false);

  // Own state — independent from the account store
  const [isWalletAuthed, setIsWalletAuthed] = useState(false);
  const [walletSubaccountId, setWalletSubaccountId] = useState<number | null>(null);
  const [deriveWallet, setDeriveWallet] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Reset on disconnect
  useEffect(() => {
    if (!isConnected || !address) {
      setIsWalletAuthed(false);
      setWalletSubaccountId(null);
      setDeriveWallet(null);
      setError(null);
    }
  }, [isConnected, address]);

  const authenticate = useCallback(async () => {
    if (!address || !walletClient) {
      setError("Wallet not connected");
      return;
    }

    if (authInProgress.current) return;
    authInProgress.current = true;
    setIsAuthenticating(true);
    setError(null);

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
      setDeriveWallet(scw);

      // Step 2: Set REST client auth using EOA wallet signing
      client.setAuth(scw, async (message: string) => {
        return walletClient.signMessage({ message });
      });

      // Step 3: Fetch subaccounts
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
        setWalletSubaccountId(subId);
        setIsWalletAuthed(true);
        console.log("[WalletAuth] Done! SCW:", scw, "subaccount:", subId);
      } else {
        setError("No Derive subaccount found. Please create one on app.derive.xyz first.");
      }
    } catch (err) {
      console.error("[WalletAuth] Error:", err);
      setError(`Wallet auth failed: ${(err as Error).message}`);
    } finally {
      authInProgress.current = false;
      setIsAuthenticating(false);
    }
  }, [address, walletClient]);

  return {
    authenticate,
    isWalletAuthed,
    walletSubaccountId,
    deriveWallet,
    error,
    isAuthenticating,
  };
}
