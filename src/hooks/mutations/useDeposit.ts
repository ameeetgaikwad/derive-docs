"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDerive } from "@/providers/DeriveProvider";
import { useAccountStore } from "@/stores/account";
import { useAccount, useWalletClient } from "wagmi";
import {
  encodeDepositData,
  encodeWithdrawData,
  toTokenAmount,
  signAction,
  signActionWithWallet,
  getActionHash,
  toTypedDataHash,
  getDomainSeparator,
  generateNonce,
  getSignatureExpiry,
} from "@/lib/derive/signing";
import { getConfig, USDC_DECIMALS } from "@/lib/derive/constants";
import { keccak256 } from "viem";
import type { Hex } from "viem";
import { toast } from "sonner";

/** Strip 0x prefix from signature — Derive API expects raw hex (130 chars, no prefix). */
function stripSigPrefix(sig: string): string {
  return sig.startsWith("0x") ? sig.slice(2) : sig;
}

interface DepositParams {
  amount: string; // USDC amount (human readable, e.g. "100")
}

/**
 * Create a new subaccount with initial deposit.
 * Uses EOA wallet signing (signTypedData) since no session key exists yet.
 */
export function useCreateSubaccount() {
  const { restClient, deriveWallet } = useDerive();
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const store = useAccountStore();

  return useMutation({
    mutationFn: async ({ amount }: DepositParams) => {
      if (!address || !walletClient || !deriveWallet) {
        throw new Error("Wallet not connected or Derive wallet not resolved");
      }

      const config = getConfig();
      const nonce = generateNonce();
      const signatureExpiry = getSignatureExpiry();

      // Deposit module uses CashAsset wrapper address, NOT raw USDC ERC-20
      const depositData = encodeDepositData({
        amount: toTokenAmount(amount, USDC_DECIMALS),
        asset: config.usdcCashAsset,
        managerForNewAccount: config.standardManager,
      });

      // Sign with wallet (EOA) via EIP-712 signTypedData
      // No session key exists yet, so EOA must sign directly
      const signature = await signActionWithWallet({
        subaccountId: 0n, // 0 for new account creation
        nonce: BigInt(nonce),
        module: config.depositModule,
        data: depositData,
        expiry: BigInt(signatureExpiry),
        owner: deriveWallet,
        signer: address,
        signTypedData: (args) =>
          walletClient.signTypedData(args) as Promise<Hex>,
      });

      const result = await restClient.createSubaccount({
        wallet: deriveWallet,
        amount,
        asset_name: "USDC",
        nonce,
        signature_expiry_sec: signatureExpiry,
        signer: address,
        signature: stripSigPrefix(signature),
        margin_type: "SM",
      });

      return result;
    },
    onSuccess: (result) => {
      store.setActiveSubaccountId(result.subaccount_id);
      toast.success("Account created successfully!");
    },
    onError: (error) => {
      toast.error(`Account creation failed: ${error.message}`);
    },
  });
}

/**
 * Deposit to an existing subaccount.
 * Uses session key signing (same as order submission).
 */
export function useDeposit() {
  const { restClient, subaccountId, deriveWallet } = useDerive();
  const { sessionKey } = useAccountStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ amount }: DepositParams) => {
      if (!subaccountId || !sessionKey || !deriveWallet) {
        throw new Error("Not authenticated");
      }

      const config = getConfig();
      const nonce = generateNonce();
      const signatureExpiry = getSignatureExpiry();

      const scaledAmount = toTokenAmount(amount, USDC_DECIMALS);
      // Deposit module also uses CashAsset wrapper address, NOT raw USDC ERC-20
      const depositData = encodeDepositData({
        amount: scaledAmount,
        asset: config.usdcCashAsset,
        managerForNewAccount: config.standardManager,
      });

      // === DEBUG: Log intermediate values ===
      const { privateKeyToAccount } = await import("viem/accounts");
      const signerAccount = privateKeyToAccount(sessionKey.private_key);
      const dataHash = keccak256(depositData);
      const actionHash = getActionHash({
        subaccountId: BigInt(subaccountId),
        nonce: BigInt(nonce),
        module: config.depositModule,
        data: depositData,
        expiry: BigInt(signatureExpiry),
        owner: deriveWallet,
        signer: signerAccount.address,
      });
      const domainSep = getDomainSeparator();
      const typedDataHash = toTypedDataHash(domainSep, actionHash);
      console.log("[Deposit DEBUG] === Our Values ===");
      console.log("[Deposit DEBUG] amount (scaled):", scaledAmount.toString());
      console.log("[Deposit DEBUG] asset:", config.usdcAddress);
      console.log("[Deposit DEBUG] manager:", config.standardManager);
      console.log("[Deposit DEBUG] depositModule:", config.depositModule);
      console.log("[Deposit DEBUG] encodedData:", depositData);
      console.log("[Deposit DEBUG] dataHash:", dataHash);
      console.log("[Deposit DEBUG] actionHash:", actionHash);
      console.log("[Deposit DEBUG] typedDataHash:", typedDataHash);

      try {
        const debugResult = await restClient.depositDebug({
          subaccount_id: subaccountId,
          amount,
          asset_name: "USDC",
          nonce,
          signature_expiry_sec: signatureExpiry,
          signer: sessionKey.public_key,
        });
        console.log("[Deposit DEBUG] === Server Values ===");
        console.log("[Deposit DEBUG] server encoded_data:", debugResult.encoded_data);
        console.log("[Deposit DEBUG] server encoded_data_hashed:", debugResult.encoded_data_hashed);
        console.log("[Deposit DEBUG] server action_hash:", debugResult.action_hash);
        console.log("[Deposit DEBUG] server typed_data_hash:", debugResult.typed_data_hash);
        console.log("[Deposit DEBUG] data match:", debugResult.encoded_data_hashed === dataHash);
        console.log("[Deposit DEBUG] action match:", debugResult.action_hash === actionHash);
        console.log("[Deposit DEBUG] typed_data match:", debugResult.typed_data_hash === typedDataHash);
      } catch (debugErr) {
        console.warn("[Deposit DEBUG] deposit_debug failed:", (debugErr as Error).message);
      }

      // Sign with session key (raw ECDSA) — same as order signing
      const signature = await signAction({
        subaccountId: BigInt(subaccountId),
        nonce: BigInt(nonce),
        module: config.depositModule,
        data: depositData,
        expiry: BigInt(signatureExpiry),
        owner: deriveWallet,
        sessionPrivateKey: sessionKey.private_key,
      });

      const result = await restClient.deposit({
        subaccount_id: subaccountId,
        amount,
        asset_name: "USDC",
        nonce,
        signature_expiry_sec: signatureExpiry,
        signer: sessionKey.public_key,
        signature: stripSigPrefix(signature),
      });

      return result;
    },
    onSuccess: () => {
      toast.success("Deposit successful!");
      queryClient.invalidateQueries({ queryKey: ["collaterals"] });
    },
    onError: (error) => {
      toast.error(`Deposit failed: ${error.message}`);
    },
  });
}

interface WithdrawParams {
  amount: string; // USDC amount (human readable, e.g. "100")
}

/**
 * Withdraw from an existing subaccount.
 * Uses session key signing (same as order submission).
 */
export function useWithdraw() {
  const { restClient, subaccountId, deriveWallet } = useDerive();
  const { sessionKey } = useAccountStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ amount }: WithdrawParams) => {
      if (!subaccountId || !sessionKey || !deriveWallet) {
        throw new Error("Not authenticated");
      }

      const config = getConfig();
      const nonce = generateNonce();
      const signatureExpiry = getSignatureExpiry();
      const scaledAmount = toTokenAmount(amount, USDC_DECIMALS);

      // Withdrawal uses CashAsset wrapper address, NOT the raw USDC ERC-20 address
      const withdrawData = encodeWithdrawData({
        amount: scaledAmount,
        asset: config.usdcCashAsset,
      });

      // === DEBUG: Log all intermediate values ===
      const { privateKeyToAccount } = await import("viem/accounts");
      const signerAccount = privateKeyToAccount(sessionKey.private_key);
      const dataHash = keccak256(withdrawData);
      const actionHash = getActionHash({
        subaccountId: BigInt(subaccountId),
        nonce: BigInt(nonce),
        module: config.withdrawalModule,
        data: withdrawData,
        expiry: BigInt(signatureExpiry),
        owner: deriveWallet,
        signer: signerAccount.address,
      });
      const domainSep = getDomainSeparator();
      const typedDataHash = toTypedDataHash(domainSep, actionHash);
      console.log("[Withdraw DEBUG] === Intermediate Hash Values ===");
      console.log("[Withdraw DEBUG] amount (human):", amount);
      console.log("[Withdraw DEBUG] amount (scaled):", scaledAmount.toString());
      console.log("[Withdraw DEBUG] USDC address:", config.usdcAddress);
      console.log("[Withdraw DEBUG] withdrawalModule:", config.withdrawalModule);
      console.log("[Withdraw DEBUG] subaccountId:", subaccountId);
      console.log("[Withdraw DEBUG] nonce:", nonce);
      console.log("[Withdraw DEBUG] signatureExpiry:", signatureExpiry);
      console.log("[Withdraw DEBUG] owner (deriveWallet):", deriveWallet);
      console.log("[Withdraw DEBUG] signer (from privkey):", signerAccount.address);
      console.log("[Withdraw DEBUG] signer (stored pubkey):", sessionKey.public_key);
      console.log("[Withdraw DEBUG] signer match:", signerAccount.address === sessionKey.public_key);
      console.log("[Withdraw DEBUG] encodedData:", withdrawData);
      console.log("[Withdraw DEBUG] dataHash:", dataHash);
      console.log("[Withdraw DEBUG] actionHash:", actionHash);
      console.log("[Withdraw DEBUG] domainSeparator:", domainSep);
      console.log("[Withdraw DEBUG] typedDataHash:", typedDataHash);

      // === Try calling withdraw_debug endpoint ===
      try {
        const debugResult = await restClient.withdrawDebug({
          subaccount_id: subaccountId,
          amount,
          asset_name: "USDC",
          nonce,
          signature_expiry_sec: signatureExpiry,
          signer: sessionKey.public_key,
        });
        console.log("[Withdraw DEBUG] === Server Debug Values ===");
        console.log("[Withdraw DEBUG] server encoded_data:", debugResult.encoded_data);
        console.log("[Withdraw DEBUG] server encoded_data_hashed:", debugResult.encoded_data_hashed);
        console.log("[Withdraw DEBUG] server action_hash:", debugResult.action_hash);
        console.log("[Withdraw DEBUG] server typed_data_hash:", debugResult.typed_data_hash);
        console.log("[Withdraw DEBUG] === Comparison ===");
        console.log("[Withdraw DEBUG] data match:", debugResult.encoded_data_hashed === dataHash);
        console.log("[Withdraw DEBUG] action match:", debugResult.action_hash === actionHash);
        console.log("[Withdraw DEBUG] typed_data match:", debugResult.typed_data_hash === typedDataHash);
      } catch (debugErr) {
        console.warn("[Withdraw DEBUG] withdraw_debug failed:", (debugErr as Error).message);
      }

      // Sign with session key (raw ECDSA) — same as order signing
      const signature = await signAction({
        subaccountId: BigInt(subaccountId),
        nonce: BigInt(nonce),
        module: config.withdrawalModule,
        data: withdrawData,
        expiry: BigInt(signatureExpiry),
        owner: deriveWallet,
        sessionPrivateKey: sessionKey.private_key,
      });

      console.log("[Withdraw DEBUG] signature (raw):", signature);
      console.log("[Withdraw DEBUG] signature (stripped):", stripSigPrefix(signature));
      console.log("[Withdraw DEBUG] signature length:", stripSigPrefix(signature).length);

      const result = await restClient.withdraw({
        subaccount_id: subaccountId,
        amount,
        asset_name: "USDC",
        nonce,
        signature_expiry_sec: signatureExpiry,
        signer: sessionKey.public_key,
        signature: stripSigPrefix(signature),
      });

      return result;
    },
    onSuccess: () => {
      toast.success("Withdrawal successful!");
      queryClient.invalidateQueries({ queryKey: ["collaterals"] });
    },
    onError: (error) => {
      toast.error(`Withdrawal failed: ${error.message}`);
    },
  });
}
