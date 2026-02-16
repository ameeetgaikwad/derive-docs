"use client";

import { useCallback, useRef } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { getAddress } from "viem";
import { useAccountStore } from "@/stores/account";
import { resolveDeriveSCW } from "@/lib/derive/utils";
import { getSharedRestClient } from "./useDeriveAuth";
import { saveDeriveWallet, loadDeriveWallet } from "@/lib/derive/session";

const client = getSharedRestClient();

/**
 * Simplified wallet auth — no session keys, no on-chain tx.
 * Uses the EOA wallet directly to sign REST API auth headers.
 * Each private API call will use walletClient.signMessage (but these are
 * just timestamp signatures for auth, not trade signatures).
 */
export function useWalletAuth() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const store = useAccountStore();
  const authInProgress = useRef(false);

  const authenticate = useCallback(async () => {
    if (!address || !walletClient) {
      store.setError("Wallet not connected");
      return;
    }

    if (authInProgress.current) return;
    authInProgress.current = true;

    try {
      store.setStatus("checking_account");
      store.setError(null);

      // Step 1: Resolve Derive SCW (no popup)
      let deriveWallet: `0x${string}`;
      const cached = loadDeriveWallet(address);
      if (cached) {
        deriveWallet = cached;
      } else {
        deriveWallet = await resolveDeriveSCW(address);
        deriveWallet = getAddress(deriveWallet);
        saveDeriveWallet(address, deriveWallet);
      }
      store.setDeriveWallet(deriveWallet);

      // Step 2: Set REST client auth using EOA wallet signing
      // The EOA owns the SCW, so Derive accepts its signatures
      client.setAuth(deriveWallet, async (message: string) => {
        return walletClient.signMessage({ message });
      });

      // Step 3: Fetch subaccounts
      store.setStatus("checking_account");
      let subaccountId: number | null = null;

      try {
        const account = await client.getAccount(deriveWallet);
        if (account.subaccount_ids?.length) {
          subaccountId = account.subaccount_ids[0];
          const subaccounts = account.subaccount_ids.map((id) => ({
            subaccount_id: id,
            label: "",
            manager: "",
            margin_type: "",
            portfolio_value: "0",
            initial_margin: "0",
            maintenance_margin: "0",
          }));
          store.setSubaccounts(subaccounts as any);
        }
      } catch {
        try {
          const subs = await client.getSubaccounts(deriveWallet);
          if (subs.length > 0) {
            subaccountId = subs[0].subaccount_id;
            store.setSubaccounts(subs);
          }
        } catch (err) {
          console.warn("[WalletAuth] No subaccounts:", err);
          store.setStatus("no_account");
          return;
        }
      }

      if (subaccountId) {
        store.setActiveSubaccountId(subaccountId);
        store.setStatus("ready");
      } else {
        store.setStatus("no_account");
      }

      console.log("[WalletAuth] Done! SCW:", deriveWallet, "subaccount:", subaccountId);
    } catch (err) {
      console.error("[WalletAuth] Error:", err);
      store.setError(`Wallet auth failed: ${(err as Error).message}`);
    } finally {
      authInProgress.current = false;
    }
  }, [address, walletClient]);

  return {
    authenticate,
    walletSubaccountId: store.activeSubaccountId,
  };
}
