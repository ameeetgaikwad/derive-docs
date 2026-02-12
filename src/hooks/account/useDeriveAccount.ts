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

const client = getSharedRestClient();

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

      // Verify in background (uses session key → no popup)
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
   * Register session key on-chain via sendTransaction.
   *
   * Flow:
   * 1. build_register_session_key_tx (public, no auth needed)
   * 2. Switch to Derive Chain
   * 3. sendTransaction — broadcasts tx on-chain (1 wallet popup)
   * 4. Poll until Derive backend recognizes the session key
   *
   * This is the most reliable browser path since all wallets support sendTransaction.
   * No REST auth is needed — the tx itself proves ownership on-chain.
   */
  async function registerSessionKeyOnChain(
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
    console.log("[Auth] Tx params:", JSON.stringify(txParams));

    // Switch to Derive Chain
    console.log("[Auth] Switching to Derive Chain (chainId:", config.chainId, ")...");
    await switchChainAsync({ chainId: config.chainId });

    // CRITICAL: The API returns tx params with `to: matching_contract` and `from: SCW`.
    // But sendTransaction sends from the EOA, so msg.sender = EOA, not SCW.
    // The matching contract registers the session key for msg.sender.
    // We must route through the SCW's execute() function so msg.sender = SCW.
    //
    // LightAccount.execute(address dest, uint256 value, bytes calldata func)
    // The EOA is the owner and can call execute() directly.
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

    console.log("[Auth] Wrapping call through SCW.execute()");
    console.log("[Auth] SCW:", deriveWallet, "→ matching:", matchingAddress);

    const txRequest = {
      to: deriveWallet, // Send to SCW, not matching contract
      data: executeCalldata, // SCW.execute(matching, 0, registerSessionKey_data)
      value: 0n,
      gas: BigInt(txParams.gas || txParams.gasLimit || 1000000),
      maxFeePerGas: txParams.maxFeePerGas ? BigInt(txParams.maxFeePerGas) : undefined,
      maxPriorityFeePerGas: txParams.maxPriorityFeePerGas ? BigInt(txParams.maxPriorityFeePerGas) : undefined,
      account: walletClient.account,
      chain: null,
    };

    console.log("[Auth] Sending SCW.execute() tx via sendTransaction... [1 wallet popup]");
    const txHash = await walletClient.sendTransaction(txRequest);
    console.log("[Auth] Tx broadcast:", txHash, "— polling for backend recognition...");

    // Set session key auth for polling — once Derive sees the on-chain registration,
    // private API calls with this session key will start working
    const sessionAccount = privateKeyToAccount(sessionKey.private_key);
    client.setAuth(deriveWallet, async (msg) => {
      return sessionAccount.signMessage({ message: msg });
    });

    const pollTimeout = 60_000;
    const pollInterval = 3_000;
    const pollStart = Date.now();

    while (Date.now() - pollStart < pollTimeout) {
      await new Promise((r) => setTimeout(r, pollInterval));
      try {
        await client.getAccount(deriveWallet);
        console.log("[Auth] Session key recognized after", Math.round((Date.now() - pollStart) / 1000), "s");
        return;
      } catch (pollErr) {
        const elapsed = Math.round((Date.now() - pollStart) / 1000);
        // 403 = signature not yet recognized, 14000 = "Account not found" (auth works!)
        const errMsg = (pollErr as Error).message || "";
        if (errMsg.includes("14000") || errMsg.includes("Account not found")) {
          console.log("[Auth] Session key auth works! (account not found yet — that's OK)", elapsed, "s");
          return;
        }
        console.log("[Auth] Not yet recognized...", elapsed, "s —", errMsg.slice(0, 80));
      }
    }

    // Even if polling timed out, the tx was broadcast — continue anyway
    console.warn("[Auth] Polling timed out, continuing anyway (tx:", txHash, ")");
  }

  /**
   * Authenticate with Derive.
   *
   * Registration strategy:
   * 1. On-chain registration (public endpoint — works for bootstrapping first session key)
   * 2. Scoped registration (private endpoint — works if EOA auth is accepted)
   *
   * Wallet popups: 1 popup total (signTransaction or sendTransaction)
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

      // === Step 1: Resolve Derive SCW (no popup) ===
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
      console.log("[Auth] EOA:", address, "→ Derive SCW:", deriveWallet);

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

      // === Step 3: Register new session key if needed ===
      if (!sessionKey) {
        store.setStatus("generating_session_key");
        sessionKey = generateSessionKey(0);
        console.log("[Auth] Generated session key:", sessionKey.public_key);

        store.setStatus("registering_session_key");

        // On-chain registration via sendTransaction — the only reliable browser path.
        // This uses public endpoints only (no REST auth needed) and broadcasts the
        // registration tx on-chain. The user gets 1 wallet popup for the tx.
        try {
          console.log("[Auth] === On-chain session key registration ===");
          await registerSessionKeyOnChain(deriveWallet, sessionKey);
          console.log("[Auth] On-chain registration succeeded!");
        } catch (onChainErr) {
          const msg = (onChainErr as Error).message;
          console.error("[Auth] On-chain registration failed:", msg);
          store.setError(`Session key registration failed: ${msg}`);
          return;
        }

        // registerSessionKeyOnChain already set session key auth + polled for recognition
        console.log("[Auth] Session key auth is active");
        saveSessionKey(sessionKey);
      }

      // === Step 4: Fetch subaccounts (session key auth — no popup) ===
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
      store.status === "registering_session_key",
    needsAccount: store.status === "no_account",
    needsAuth: isConnected && store.status === "disconnected" && !store.sessionKey,
  };
}
