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
 * Create a Derive account via the privileged create-account endpoint.
 * Called directly from browser (Vercel serverless/edge IPs blocked by Derive's Cloudflare).
 * The API key only authorizes account creation + gas sponsorship, not fund access.
 */
async function createDeriveAccount(scwAddress: `0x${string}`) {
  const deriveApiKey = process.env.NEXT_PUBLIC_DERIVE_API_KEY || "";
  const res = await fetch("https://app.derive.xyz/api/public/create-account", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${deriveApiKey}`,
    },
    body: JSON.stringify({ address: scwAddress }),
  });

  if (!res.ok) {
    const text = await res.text();
    // 409/duplicate is fine — account already exists
    if (res.status === 409 || text.includes("already exists")) {
      console.log("[Auth] Account already exists, continuing...");
      return;
    }
    throw new Error(`Create account failed (${res.status}): ${text}`);
  }

  console.log("[Auth] Account created via create-account endpoint");
}

export function useDeriveAccount() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const store = useAccountStore();
  const authInProgress = useRef(false);

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
  ) {
    if (!walletClient) throw new Error("Wallet client not available");
    const config = getConfig();

    // Switch to Derive Chain first
    console.log("[Auth] Switching to Derive Chain (chainId:", config.chainId, ")...");
    await switchChainAsync({ chainId: config.chainId });

    // Build the bundle of onboarding actions
    const actions = buildOnboardingActions(eoaAddress);
    console.log("[Auth] Built", actions.length, "onboarding actions, submitting via paymaster...");

    // Send as a sponsored UserOperation (1 wallet popup for signing)
    const txHash = await sendSponsoredUserOp(walletClient, actions);
    console.log("[Auth] Sponsored onboarding tx mined:", txHash);
    return txHash;
  }

  /**
   * Fallback: register session key via direct sendTransaction (user pays gas).
   * Used when paymaster is unavailable.
   */
  async function registerSessionKeyDirect(
    deriveWallet: `0x${string}`,
    sessionKey: SessionKey,
  ) {
    if (!walletClient) throw new Error("Wallet client not available");
    const config = getConfig();

    console.log("[Auth] Building register session key tx...");
    const buildResult = await client.buildRegisterSessionKeyTx({
      wallet: deriveWallet,
      public_session_key: sessionKey.public_key,
      expiry_sec: sessionKey.expiry,
    });
    const txParams = buildResult.tx_params;

    console.log("[Auth] Switching to Derive Chain...");
    await switchChainAsync({ chainId: config.chainId });

    const matchingAddress = txParams.to as `0x${string}`;
    const registerCalldata = txParams.data as `0x${string}`;

    const executeCalldata = encodeFunctionData({
      abi: [{
        name: "execute",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
          { name: "dest", type: "address" },
          { name: "value", type: "uint256" },
          { name: "func", type: "bytes" },
        ],
        outputs: [],
      }],
      functionName: "execute",
      args: [matchingAddress, 0n, registerCalldata],
    });

    const txHash = await walletClient.sendTransaction({
      to: deriveWallet,
      data: executeCalldata,
      value: 0n,
      gas: BigInt(txParams.gas || txParams.gasLimit || 1000000),
      maxFeePerGas: txParams.maxFeePerGas ? BigInt(txParams.maxFeePerGas) : undefined,
      maxPriorityFeePerGas: txParams.maxPriorityFeePerGas ? BigInt(txParams.maxPriorityFeePerGas) : undefined,
      account: walletClient.account,
      chain: null,
    });

    console.log("[Auth] Direct tx broadcast:", txHash);

    // Set session key auth for polling
    const sessionAccount = privateKeyToAccount(sessionKey.private_key);
    client.setAuth(deriveWallet, async (msg) => {
      return sessionAccount.signMessage({ message: msg });
    });

    // Poll until backend recognizes the session key
    const pollTimeout = 60_000;
    const pollInterval = 3_000;
    const pollStart = Date.now();

    while (Date.now() - pollStart < pollTimeout) {
      await new Promise((r) => setTimeout(r, pollInterval));
      try {
        await client.getAccount(deriveWallet);
        console.log("[Auth] Session key recognized");
        return;
      } catch (pollErr) {
        const errMsg = (pollErr as Error).message || "";
        if (errMsg.includes("14000") || errMsg.includes("Account not found")) {
          console.log("[Auth] Session key auth works (account not found — OK)");
          return;
        }
      }
    }
    console.warn("[Auth] Polling timed out, continuing anyway");
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
    if (!address || !walletClient) {
      store.setError("Wallet not connected");
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
          console.warn("[Auth] create-account failed (may already exist):", err);
        }

        // 3c. Sponsored onboarding: registerSessionKey + approvals + createSubaccount
        // in a single gas-free UserOperation via Derive's paymaster.
        // Sponsored onboarding: registerSessionKey + approvals + createSubaccount
        // in a single gas-free UserOperation via Derive's paymaster.
        store.setStatus("sponsoring_setup");
        try {
          await performSponsoredOnboarding(deriveWallet, sessionKey.public_key);
          console.log("[Auth] Sponsored onboarding complete");

          // Set up REST client auth with the new session key
          const sessionAccount = privateKeyToAccount(sessionKey.private_key);
          client.setAuth(deriveWallet, async (msg) => {
            return sessionAccount.signMessage({ message: msg });
          });
        } catch (sponsoredErr) {
          console.error("[Auth] ❌ Sponsored onboarding failed:", sponsoredErr);
          console.error("[Auth] ❌ Error details:", (sponsoredErr as Error).message);
          console.error("[Auth] ❌ Full error:", JSON.stringify(sponsoredErr, Object.getOwnPropertyNames(sponsoredErr as Error)));
          // Surface the actual paymaster error instead of silently falling back
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
