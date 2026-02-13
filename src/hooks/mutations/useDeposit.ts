"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDerive } from "@/providers/DeriveProvider";
import { useAccountStore } from "@/stores/account";
import { useAccount, useWalletClient, useSwitchChain } from "wagmi";
import {
  encodeDepositData,
  encodeWithdrawData,
  toTokenAmount,
  signAction,
  signActionWithWallet,
  generateNonce,
  getSignatureExpiry,
} from "@/lib/derive/signing";
import { getConfig, USDC_DECIMALS } from "@/lib/derive/constants";
import type { Hex, WalletClient } from "viem";
import { erc20Abi, encodeFunctionData } from "viem";
import { waitForTransactionReceipt } from "wagmi/actions";
import { useConfig as useWagmiConfig } from "wagmi";
import type { Config } from "wagmi";
import { toast } from "sonner";
import { useState } from "react";

/** Strip 0x prefix from signature — Derive API expects raw hex (130 chars, no prefix). */
function stripSigPrefix(sig: string): string {
  return sig.startsWith("0x") ? sig.slice(2) : sig;
}

/** Deposit step tracking for UI feedback */
export type DepositStep = "idle" | "transferring" | "signing" | "confirming" | "done";

/** Withdraw step tracking for UI feedback */
export type WithdrawStep = "idle" | "signing" | "confirming" | "transferring" | "done";

interface DepositParams {
  amount: string; // USDC amount (human readable, e.g. "100")
}

/**
 * Transfer USDC from EOA to SCW on Derive Chain via ERC-20 transfer.
 * Returns the transaction hash once confirmed.
 */
async function transferUsdcToScw({
  walletClient,
  wagmiConfig,
  switchChainAsync,
  deriveWallet,
  amount,
}: {
  walletClient: WalletClient;
  wagmiConfig: Config;
  switchChainAsync: ReturnType<typeof useSwitchChain>["switchChainAsync"];
  deriveWallet: `0x${string}`;
  amount: string;
}): Promise<Hex> {
  const config = getConfig();
  const scaledAmount = toTokenAmount(amount, USDC_DECIMALS);

  // Ensure we're on Derive Chain
  if (walletClient.chain?.id !== config.chainId) {
    await switchChainAsync({ chainId: config.chainId });
  }

  const [account] = await walletClient.getAddresses();

  // ERC-20 transfer: EOA → SCW
  const txHash = await walletClient.writeContract({
    address: config.usdcAddress,
    abi: erc20Abi,
    functionName: "transfer",
    args: [deriveWallet, scaledAmount],
    account,
    chain: { id: config.chainId } as any,
  });

  // Wait for on-chain confirmation
  await waitForTransactionReceipt(wagmiConfig, { hash: txHash });

  return txHash;
}

/**
 * Create a new subaccount with initial deposit.
 * Uses EOA wallet signing (signTypedData) since no session key exists yet.
 * Transfers USDC from EOA → SCW first.
 */
export function useCreateSubaccount() {
  const { restClient, deriveWallet } = useDerive();
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const wagmiConfig = useWagmiConfig();
  const store = useAccountStore();

  return useMutation({
    mutationFn: async ({ amount }: DepositParams) => {
      if (!address || !walletClient || !deriveWallet) {
        throw new Error("Wallet not connected or Derive wallet not resolved");
      }

      // Step 1: Transfer USDC from EOA → SCW
      await transferUsdcToScw({
        walletClient,
        wagmiConfig,
        switchChainAsync,
        deriveWallet,
        amount,
      });

      // Step 2: Sign deposit action with wallet
      const config = getConfig();
      const nonce = generateNonce();
      const signatureExpiry = getSignatureExpiry();

      const depositData = encodeDepositData({
        amount: toTokenAmount(amount, USDC_DECIMALS),
        asset: config.usdcCashAsset,
        managerForNewAccount: config.standardManager,
      });

      const signature = await signActionWithWallet({
        subaccountId: 0n,
        nonce: BigInt(nonce),
        module: config.depositModule,
        data: depositData,
        expiry: BigInt(signatureExpiry),
        owner: deriveWallet,
        signer: address,
        signTypedData: (args) =>
          walletClient.signTypedData(args) as Promise<Hex>,
      });

      // Step 3: Submit to Derive API
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
 * Transfers USDC from EOA → SCW first, then signs internal deposit.
 */
export function useDeposit() {
  const { restClient, subaccountId, deriveWallet } = useDerive();
  const { sessionKey } = useAccountStore();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const wagmiConfig = useWagmiConfig();
  const queryClient = useQueryClient();
  const [depositStep, setDepositStep] = useState<DepositStep>("idle");

  const mutation = useMutation({
    mutationFn: async ({ amount }: DepositParams) => {
      if (!subaccountId || !sessionKey || !deriveWallet || !walletClient) {
        throw new Error("Not authenticated or wallet not connected");
      }

      // Step 1: Transfer USDC from EOA → SCW on Derive Chain
      setDepositStep("transferring");
      await transferUsdcToScw({
        walletClient,
        wagmiConfig,
        switchChainAsync,
        deriveWallet,
        amount,
      });

      // Step 2: Sign internal deposit (SCW → subaccount)
      setDepositStep("signing");
      const config = getConfig();
      const nonce = generateNonce();
      const signatureExpiry = getSignatureExpiry();

      const scaledAmount = toTokenAmount(amount, USDC_DECIMALS);
      const depositData = encodeDepositData({
        amount: scaledAmount,
        asset: config.usdcCashAsset,
        managerForNewAccount: config.standardManager,
      });

      const signature = await signAction({
        subaccountId: BigInt(subaccountId),
        nonce: BigInt(nonce),
        module: config.depositModule,
        data: depositData,
        expiry: BigInt(signatureExpiry),
        owner: deriveWallet,
        sessionPrivateKey: sessionKey.private_key,
      });

      // Step 3: Submit deposit to Derive API
      setDepositStep("confirming");
      const result = await restClient.deposit({
        subaccount_id: subaccountId,
        amount,
        asset_name: "USDC",
        nonce,
        signature_expiry_sec: signatureExpiry,
        signer: sessionKey.public_key,
        signature: stripSigPrefix(signature),
      });

      setDepositStep("done");
      return result;
    },
    onSuccess: () => {
      toast.success("Deposit successful!");
      queryClient.invalidateQueries({ queryKey: ["collaterals"] });
      setDepositStep("idle");
    },
    onError: (error) => {
      toast.error(`Deposit failed: ${error.message}`);
      setDepositStep("idle");
    },
  });

  return { ...mutation, depositStep };
}

interface WithdrawParams {
  amount: string; // USDC amount (human readable, e.g. "100")
}

const LIGHT_ACCOUNT_EXECUTE_ABI = [{
  name: "execute",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [
    { name: "dest", type: "address" },
    { name: "value", type: "uint256" },
    { name: "func", type: "bytes" },
  ],
  outputs: [],
}] as const;

/**
 * Transfer USDC from SCW → EOA via SCW.execute(usdc, 0, transfer(eoa, amount)).
 * EOA calls SCW.execute so msg.sender = EOA (the owner), which LightAccount allows.
 */
async function transferUsdcFromScw({
  walletClient,
  wagmiConfig,
  switchChainAsync,
  deriveWallet,
  eoaAddress,
  amount,
}: {
  walletClient: WalletClient;
  wagmiConfig: Config;
  switchChainAsync: ReturnType<typeof useSwitchChain>["switchChainAsync"];
  deriveWallet: `0x${string}`;
  eoaAddress: `0x${string}`;
  amount: string;
}): Promise<Hex> {
  const config = getConfig();
  const scaledAmount = toTokenAmount(amount, USDC_DECIMALS);

  // Ensure we're on Derive Chain
  if (walletClient.chain?.id !== config.chainId) {
    await switchChainAsync({ chainId: config.chainId });
  }

  // Inner call: ERC-20 transfer(eoa, amount)
  const transferCalldata = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [eoaAddress, scaledAmount],
  });

  // Outer call: SCW.execute(usdcAddress, 0, transferCalldata)
  const executeCalldata = encodeFunctionData({
    abi: LIGHT_ACCOUNT_EXECUTE_ABI,
    functionName: "execute",
    args: [config.usdcAddress, 0n, transferCalldata],
  });

  const [account] = await walletClient.getAddresses();

  const txHash = await walletClient.sendTransaction({
    to: deriveWallet,
    data: executeCalldata,
    value: 0n,
    account,
    chain: { id: config.chainId } as any,
  });

  await waitForTransactionReceipt(wagmiConfig, { hash: txHash });

  return txHash;
}

/**
 * Withdraw from an existing subaccount.
 * Signs internal withdraw (subaccount → SCW), then transfers USDC from SCW → EOA on-chain.
 */
export function useWithdraw() {
  const { restClient, subaccountId, deriveWallet } = useDerive();
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const wagmiConfig = useWagmiConfig();
  const { sessionKey } = useAccountStore();
  const queryClient = useQueryClient();
  const [withdrawStep, setWithdrawStep] = useState<WithdrawStep>("idle");

  const mutation = useMutation({
    mutationFn: async ({ amount }: WithdrawParams) => {
      if (!subaccountId || !sessionKey || !deriveWallet || !walletClient || !address) {
        throw new Error("Not authenticated or wallet not connected");
      }

      // Step 1: Sign internal withdraw (subaccount → SCW on Derive ledger)
      setWithdrawStep("signing");
      const config = getConfig();
      const nonce = generateNonce();
      const signatureExpiry = getSignatureExpiry();
      const scaledAmount = toTokenAmount(amount, USDC_DECIMALS);

      const withdrawData = encodeWithdrawData({
        amount: scaledAmount,
        asset: config.usdcCashAsset,
      });

      const signature = await signAction({
        subaccountId: BigInt(subaccountId),
        nonce: BigInt(nonce),
        module: config.withdrawalModule,
        data: withdrawData,
        expiry: BigInt(signatureExpiry),
        owner: deriveWallet,
        sessionPrivateKey: sessionKey.private_key,
      });

      // Step 2: Submit withdraw to Derive API
      setWithdrawStep("confirming");
      const result = await restClient.withdraw({
        subaccount_id: subaccountId,
        amount,
        asset_name: "USDC",
        nonce,
        signature_expiry_sec: signatureExpiry,
        signer: sessionKey.public_key,
        signature: stripSigPrefix(signature),
      });

      // Step 3: Transfer USDC from SCW → EOA on-chain
      setWithdrawStep("transferring");
      await transferUsdcFromScw({
        walletClient,
        wagmiConfig,
        switchChainAsync,
        deriveWallet,
        eoaAddress: address,
        amount,
      });

      setWithdrawStep("done");
      return result;
    },
    onSuccess: () => {
      toast.success("Withdrawal successful!");
      queryClient.invalidateQueries({ queryKey: ["collaterals"] });
      setWithdrawStep("idle");
    },
    onError: (error) => {
      toast.error(`Withdrawal failed: ${error.message}`);
      setWithdrawStep("idle");
    },
  });

  return { ...mutation, withdrawStep };
}
