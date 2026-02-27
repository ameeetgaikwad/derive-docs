"use client";

import { useEffect, useCallback, useRef } from "react";
import { useAccount, useWalletClient, useSwitchChain } from "wagmi";
import { privateKeyToAccount } from "viem/accounts";
import { getAddress, encodeFunctionData } from "viem";
import { useAccountStore } from "@/stores/account";
import { DeriveApiError } from "@/lib/derive/client";
import type { Subaccount, SessionKey } from "@/lib/derive/types";
import {
  generateSessionKey,
  loadSessionKey,
  saveSessionKey,
  clearSessionKey,
  isSessionKeyValid,
  saveDeriveWallet,
  loadDeriveWallet,
} from "@/lib/derive/session";
import { getSharedRestClient, getSharedWsClient } from "./useDeriveAuth";
import { getWsLoginParams } from "@/lib/derive/auth";
import { resolveDeriveSCW } from "@/lib/derive/utils";
import { getConfig } from "@/lib/derive/constants";
import { buildOnboardingActions } from "@/lib/derive/scw-actions";
import { sendSponsoredUserOp } from "@/lib/derive/paymaster";

const client = getSharedRestClient();

/**
 * Create a Derive account via our Vercel API proxy.
 * Browser can't call Derive directly due to CORS.
 */
const createdAccounts = new Set<string>();

async function createDeriveAccount(scwAddress: `0x${string}`) {
  // Skip if we already created this account in this session
  if (createdAccounts.has(scwAddress)) {
    console.log("[Auth] Account already created this session, skipping...");
    return;
  }

  const res = await fetch("/api/create-account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: scwAddress }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.warn("[Auth] create-account response:", res.status, text);
    // 409/duplicate/429 rate-limit are fine — account already exists
    if (res.status === 409 || res.status === 429 || text.includes("already exists")) {
      console.log("[Auth] Account already exists, continuing...");
      createdAccounts.add(scwAddress);
      return;
    }
    throw new Error(`Create account failed (${res.status}): ${text}`);
  }

  createdAccounts.add(scwAddress);
  console.log("[Auth] Account created via create-account endpoint");
}

export function useDeriveAccount() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const store = useAccountStore();
  const authInProgress = useRef(false);
  const walletClientRef = useRef(walletClient);
  walletClientRef.current = walletClient;

  // On wallet connect, try to restore session key (no wallet prompts)
  useEffect(() => {
    if (!isConnected || !address) {
      store.reset();
      client.clearAuth();
      return;
    }

    const existingSession = loadSessionKey();
    const cachedDeriveWallet = loadDeriveWallet(address);

    if (existingSession && isSessionKeyValid(existingSession) && cachedDeriveWallet) {
      console.log("[Auth] Restoring session key from localStorage");
      const sessionAccount = privateKeyToAccount(existingSession.private_key);
      client.setAuth(cachedDeriveWallet, async (msg) => {
        return sessionAccount.signMessage({ message: msg });
      });
      store.setSessionKey(existingSession);
      store.setDeriveWallet(cachedDeriveWallet);
      store.setActiveSubaccountId(existingSession.subaccount_id);
      store.setStatus("ready");

      // Verify in background (uses session key -> no popup)
      client.getSubaccounts(cachedDeriveWallet).then(
        (subs) => {
          console.log("[Auth] Session key verified, subaccounts:", subs.length);
          store.setSubaccounts(subs);
          loginWs(existingSession.private_key, cachedDeriveWallet);
        },
        (err) => {
          console.warn("[Auth] Session key expired or invalid:", err);
          clearSessionKey();
          store.setSessionKey(null);
          store.setStatus("disconnected");
          client.clearAuth();
        }
      );
    } else {
      store.setStatus("disconnected");
    }
  }, [isConnected, address]);

  async function loginWs(sessionPrivateKey: `0x${string}`, deriveWallet: `0x${string}`) {
    try {
      const wsClient = getSharedWsClient();
      if (!wsClient.isConnected) return;
      const loginParams = await getWsLoginParams(sessionPrivateKey, deriveWallet);
      await wsClient.login(loginParams.wallet, loginParams.timestamp, loginParams.signature);
      console.log("[Auth] WS login succeeded");
    } catch (err) {
      console.warn("[Auth] WS login failed:", err);
    }
  }

  /** Resolve Derive SCW — always returns checksummed address */
  async function resolveDeriveWallet(eoa: `0x${string}`): Promise<`0x${string}`> {
    const cached = loadDeriveWallet(eoa);
    if (cached) {
      console.log("[Auth] Using cached Derive wallet:", cached);
      return cached;
    }
    console.log("[Auth] Resolving Derive wallet for EOA:", eoa);
    const deriveWallet = await resolveDeriveSCW(eoa);
    console.log("[Auth] Derive wallet resolved:", deriveWallet);
    saveDeriveWallet(eoa, deriveWallet);
    return deriveWallet;
  }

  /**
   * Perform onboarding SCW actions via paymaster (gas-sponsored).
   * Bundles: registerSessionKey + token approvals + createSubaccount
   * into a single UserOperation that the user signs once.
   */
  async function performSponsoredOnboarding(
    deriveWallet: `0x${string}`,
    eoaAddress: `0x${string}`,
    wc: NonNullable<typeof walletClient>,
  ) {
    const config = getConfig();

    // Switch to Derive Chain first
    console.log("[Auth] Switching to Derive Chain (chainId:", config.chainId, ")...");
    await switchChainAsync({ chainId: config.chainId });

    // Build the bundle of onboarding actions
    const actions = buildOnboardingActions(eoaAddress);
    console.log("[Auth] Built", actions.length, "onboarding actions, submitting via paymaster...");

    // Send as a sponsored UserOperation (1 wallet popup for signing)
    const txHash = await sendSponsoredUserOp(wc, actions);
    console.log("[Auth] Sponsored onboarding tx mined:", txHash);
    return txHash;
  }

  /**
   * Full authentication flow:
   *
   * 1. Resolve SCW address (deterministic, no tx)
   * 2. Create account via privileged endpoint
   * 3. Paymaster-sponsored onboarding (registerSessionKey + approvals + createSubaccount)
   * 4. Register local session key for REST/WS auth
   * 5. Fetch subaccounts -> ready
   */
  const authenticate = useCallback(async () => {
    if (!address) {
      store.setError("Wallet not connected");
      return;
    }

    // walletClient can be undefined briefly while wagmi initializes it,
    // even though the wallet IS connected. Use the ref to get the latest
    // value and retry a few times if needed.
    let wc = walletClient ?? walletClientRef.current;
    if (!wc && isConnected) {
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 500));
        wc = walletClientRef.current;
        if (wc) break;
      }
    }
    if (!wc) {
      store.setError("Wallet client not ready — please try again");
      return;
    }

    if (authInProgress.current) return;
    authInProgress.current = true;

    try {
      store.setStatus("checking_account");
      store.setError(null);

      // === Step 1: Resolve Derive SCW ===
      let deriveWallet: `0x${string}`;
      try {
        deriveWallet = await resolveDeriveWallet(address);
        deriveWallet = getAddress(deriveWallet);
      } catch (err) {
        console.error("[Auth] Failed to resolve Derive wallet:", err);
        store.setError(`Failed to resolve Derive wallet: ${(err as Error).message}`);
        return;
      }
      store.setDeriveWallet(deriveWallet);
      saveDeriveWallet(address, deriveWallet);
      console.log("[Auth] EOA:", address, "-> Derive SCW:", deriveWallet);

      // === Step 2: Check for existing valid session key ===
      let sessionKey = loadSessionKey();
      const existingDeriveWallet = sessionKey ? loadDeriveWallet(address) : null;

      if (sessionKey && isSessionKeyValid(sessionKey) && existingDeriveWallet === deriveWallet) {
        console.log("[Auth] Found existing session key, verifying...");
        const sessionAccount = privateKeyToAccount(sessionKey.private_key);
        client.setAuth(deriveWallet, async (msg) => {
          return sessionAccount.signMessage({ message: msg });
        });

        try {
          await client.getSubaccounts(deriveWallet);
          console.log("[Auth] Existing session key still valid");
        } catch {
          console.warn("[Auth] Existing session key rejected, re-registering...");
          clearSessionKey();
          sessionKey = null;
        }
      } else {
        sessionKey = null;
      }

      // === Step 3: New onboarding flow if no valid session key ===
      if (!sessionKey) {
        // 3a. Generate session key
        store.setStatus("generating_session_key");
        sessionKey = generateSessionKey(0);
        console.log("[Auth] Generated session key:", sessionKey.public_key);

        // 3b. Create account via privileged endpoint (idempotent)
        store.setStatus("creating_account");
        try {
          await createDeriveAccount(deriveWallet);
        } catch (err) {
          console.error("[Auth] create-account failed:", (err as Error).message, err);
        }

        // 3c. Sponsored onboarding: registerSessionKey + approvals + createSubaccount
        // in a single gas-free UserOperation via Derive's paymaster.
        store.setStatus("sponsoring_setup");
        try {
          await performSponsoredOnboarding(deriveWallet, sessionKey.public_key, wc);
          console.log("[Auth] Sponsored onboarding complete");

          // Set up REST client auth with the new session key
          const sessionAccount = privateKeyToAccount(sessionKey.private_key);
          client.setAuth(deriveWallet, async (msg) => {
            return sessionAccount.signMessage({ message: msg });
          });
        } catch (sponsoredErr) {
          console.error("[Auth] Sponsored onboarding failed:", sponsoredErr);
          console.error("[Auth] Error details:", (sponsoredErr as Error).message);
          store.setError(`Paymaster sponsorship failed: ${(sponsoredErr as Error).message}`);
          return;
        }

        saveSessionKey(sessionKey);
      }

      // === Step 4: Fetch subaccounts ===
      store.setStatus("checking_account");
      let subaccounts: Subaccount[] = [];

      try {
        const account = await client.getAccount(deriveWallet);
        console.log("[Auth] get_account OK:", JSON.stringify(account));
        if (account.subaccount_ids?.length) {
          subaccounts = account.subaccount_ids.map((id) => ({
            subaccount_id: id,
            label: "",
            manager: "",
            margin_type: "",
            portfolio_value: "0",
            initial_margin: "0",
            maintenance_margin: "0",
          })) as Subaccount[];
        }
      } catch {
        try {
          subaccounts = await client.getSubaccounts(deriveWallet);
          console.log("[Auth] get_subaccounts OK:", subaccounts.length);
        } catch (err2) {
          console.warn("[Auth] No subaccounts found:", err2);
          store.setStatus("no_account");
          store.setSessionKey(sessionKey);
          saveSessionKey(sessionKey);
          return;
        }
      }

      // === Step 5: Finalize ===
      if (subaccounts.length > 0) {
        store.setSubaccounts(subaccounts);
        const subaccountId = subaccounts[0].subaccount_id;
        store.setActiveSubaccountId(subaccountId);
        sessionKey.subaccount_id = subaccountId;
      }

      saveSessionKey(sessionKey);
      store.setSessionKey(sessionKey);
      await loginWs(sessionKey.private_key, deriveWallet);
      store.setStatus(subaccounts.length > 0 ? "ready" : "no_account");
      console.log("[Auth] Done! Status:", subaccounts.length > 0 ? "ready" : "no_account");
    } catch (err) {
      console.error("[Auth] Unexpected error:", err);
      const message = err instanceof DeriveApiError
        ? `API error ${err.code}: ${err.message}`
        : (err as Error).message;
      store.setError(`Authentication failed: ${message}`);
    } finally {
      authInProgress.current = false;
    }
  }, [address, walletClient, switchChainAsync]);

  return {
    ...store,
    authenticate,
    client,
    isReady: store.status === "ready",
    isOnboarding:
      store.status === "checking_account" ||
      store.status === "creating_account" ||
      store.status === "generating_session_key" ||
      store.status === "registering_session_key" ||
      store.status === "sponsoring_setup",
    needsAccount: store.status === "no_account",
    needsAuth: isConnected && store.status === "disconnected" && !store.sessionKey,
  };
}
