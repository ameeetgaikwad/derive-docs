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
import { getConfig, USDC_DECIMALS, getAssetConfig, type SupportedAsset, type MarginType } from "@/lib/derive/constants";
import type { Hex, WalletClient } from "viem";
import { createPublicClient, erc20Abi, encodeFunctionData, http } from "viem";
import { waitForTransactionReceipt } from "wagmi/actions";
import { getDeriveChain } from "@/lib/chain/derive";
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
  amount: string; // Token amount (human readable, e.g. "100")
  assetName?: SupportedAsset; // default "USDC"
}

/**
 * Ensure the SCW has enough of a given token on Derive Chain for the deposit.
 * If the SCW already has sufficient balance (e.g. from bridging), skip the EOA transfer.
 * Otherwise, transfer tokens from EOA → SCW.
 */
async function ensureScwHasToken({
  walletClient,
  wagmiConfig,
  switchChainAsync,
  deriveWallet,
  amount,
  tokenAddress,
  decimals,
}: {
  walletClient: WalletClient;
  wagmiConfig: Config;
  switchChainAsync: ReturnType<typeof useSwitchChain>["switchChainAsync"];
  deriveWallet: `0x${string}`;
  amount: string;
  tokenAddress: `0x${string}`;
  decimals: number;
}): Promise<void> {
  const config = getConfig();
  const scaledAmount = toTokenAmount(amount, decimals);

  // Ensure we're on Derive Chain
  if (walletClient.chain?.id !== config.chainId) {
    await switchChainAsync({ chainId: config.chainId });
  }

  const deriveEnv = (process.env.NEXT_PUBLIC_DERIVE_ENV as "testnet" | "mainnet") || "mainnet";
  const chain = getDeriveChain(deriveEnv);

  // Check SCW's on-chain token balance
  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  });

  const scwBalance = await publicClient.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [deriveWallet],
  });

  if (scwBalance >= scaledAmount) {
    console.log("[Deposit] SCW already has sufficient token balance, skipping EOA transfer");
    return;
  }

  // SCW needs more tokens — transfer from EOA
  const deficit = scaledAmount - scwBalance;
  const [account] = await walletClient.getAddresses();

  console.log("[Deposit] Transferring", deficit.toString(), "token units from EOA to SCW");

  const txHash = await walletClient.writeContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "transfer",
    args: [deriveWallet, deficit],
    account,
    chain: { id: config.chainId } as any,
  });

  await waitForTransactionReceipt(wagmiConfig, { hash: txHash });
}

const LIGHT_ACCOUNT_EXECUTE_ABI_INNER = [{
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
 * Ensure the SCW has approved the deposit module (and withdraw wrapper) to spend a token.
 * If allowance is insufficient, sends an approval tx via SCW.execute.
 */
async function ensureScwApprovals({
  walletClient,
  wagmiConfig,
  switchChainAsync,
  deriveWallet,
  tokenAddress,
}: {
  walletClient: WalletClient;
  wagmiConfig: Config;
  switchChainAsync: ReturnType<typeof useSwitchChain>["switchChainAsync"];
  deriveWallet: `0x${string}`;
  tokenAddress: `0x${string}`;
}): Promise<void> {
  const config = getConfig();
  const deriveEnv = (process.env.NEXT_PUBLIC_DERIVE_ENV as "testnet" | "mainnet") || "mainnet";
  const chain = getDeriveChain(deriveEnv);
  const maxUint256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

  if (walletClient.chain?.id !== config.chainId) {
    await switchChainAsync({ chainId: config.chainId });
  }

  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  });

  const spenders = [config.depositModule, config.withdrawWrapper];

  for (const spender of spenders) {
    const allowance = await publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "allowance",
      args: [deriveWallet, spender],
    });

    if (allowance > 0n) continue;

    console.log("[Deposit] SCW needs approval for", spender, "— sending via SCW.execute");

    const approveCalldata = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, maxUint256],
    });

    const executeCalldata = encodeFunctionData({
      abi: LIGHT_ACCOUNT_EXECUTE_ABI_INNER,
      functionName: "execute",
      args: [tokenAddress, 0n, approveCalldata],
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
    console.log("[Deposit] Approval tx confirmed for", spender);
  }
}

interface CreateSubaccountParams extends DepositParams {
  marginType?: MarginType; // default "SM"
}

/**
 * Create a new subaccount with initial deposit.
 * Uses EOA wallet signing (signTypedData) since no session key exists yet.
 * Transfers tokens from EOA → SCW first.
 */
export function useCreateSubaccount() {
  const { restClient, deriveWallet } = useDerive();
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const wagmiConfig = useWagmiConfig();
  const store = useAccountStore();

  return useMutation({
    mutationFn: async ({ amount, assetName, marginType }: CreateSubaccountParams) => {
      if (!address || !walletClient || !deriveWallet) {
        throw new Error("Wallet not connected or Derive wallet not resolved");
      }

      const asset = assetName ?? "USDC";
      const margin = marginType ?? "SM";
      const assetConfig = getAssetConfig(asset);

      // Step 1: Transfer tokens from EOA → SCW
      await ensureScwHasToken({
        walletClient,
        wagmiConfig,
        switchChainAsync,
        deriveWallet,
        amount,
        tokenAddress: assetConfig.tokenAddress,
        decimals: assetConfig.decimals,
      });

      // Step 2: Sign deposit action with wallet
      const config = getConfig();
      const nonce = generateNonce();
      const signatureExpiry = getSignatureExpiry();
      const managerForNewAccount = margin === "PM2" ? config.portfolioManager : config.standardManager;

      const depositData = encodeDepositData({
        amount: toTokenAmount(amount, assetConfig.decimals),
        asset: assetConfig.cashAsset,
        managerForNewAccount,
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
        asset_name: asset,
        nonce,
        signature_expiry_sec: signatureExpiry,
        signer: address,
        signature: stripSigPrefix(signature),
        margin_type: margin,
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
 * Transfers tokens from EOA → SCW first, then signs internal deposit.
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
    mutationFn: async ({ amount, assetName }: DepositParams) => {
      if (!subaccountId || !sessionKey || !deriveWallet || !walletClient) {
        throw new Error("Not authenticated or wallet not connected");
      }

      const asset = assetName ?? "USDC";
      const assetConfig = getAssetConfig(asset);

      // Step 1: Ensure SCW has tokens and approvals
      setDepositStep("transferring");
      await ensureScwHasToken({
        walletClient,
        wagmiConfig,
        switchChainAsync,
        deriveWallet,
        amount,
        tokenAddress: assetConfig.tokenAddress,
        decimals: assetConfig.decimals,
      });
      await ensureScwApprovals({
        walletClient,
        wagmiConfig,
        switchChainAsync,
        deriveWallet,
        tokenAddress: assetConfig.tokenAddress,
      });

      // Step 2: Sign internal deposit (SCW → subaccount)
      setDepositStep("signing");
      const config = getConfig();
      const nonce = generateNonce();
      const signatureExpiry = getSignatureExpiry();

      const scaledAmount = toTokenAmount(amount, assetConfig.decimals);
      const depositData = encodeDepositData({
        amount: scaledAmount,
        asset: assetConfig.cashAsset,
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
        asset_name: asset,
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
  amount: string; // Token amount (human readable, e.g. "100")
  assetName?: SupportedAsset; // default "USDC"
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
 * Transfer tokens from SCW → EOA via SCW.execute(token, 0, transfer(eoa, amount)).
 * EOA calls SCW.execute so msg.sender = EOA (the owner), which LightAccount allows.
 */
async function transferTokenFromScw({
  walletClient,
  wagmiConfig,
  switchChainAsync,
  deriveWallet,
  eoaAddress,
  amount,
  tokenAddress,
  decimals,
}: {
  walletClient: WalletClient;
  wagmiConfig: Config;
  switchChainAsync: ReturnType<typeof useSwitchChain>["switchChainAsync"];
  deriveWallet: `0x${string}`;
  eoaAddress: `0x${string}`;
  amount: string;
  tokenAddress: `0x${string}`;
  decimals: number;
}): Promise<Hex> {
  const config = getConfig();
  const scaledAmount = toTokenAmount(amount, decimals);

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

  // Outer call: SCW.execute(tokenAddress, 0, transferCalldata)
  const executeCalldata = encodeFunctionData({
    abi: LIGHT_ACCOUNT_EXECUTE_ABI,
    functionName: "execute",
    args: [tokenAddress, 0n, transferCalldata],
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
 * Signs internal withdraw (subaccount → SCW), then transfers tokens from SCW → EOA on-chain.
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
    mutationFn: async ({ amount, assetName }: WithdrawParams) => {
      if (!subaccountId || !sessionKey || !deriveWallet || !walletClient || !address) {
        throw new Error("Not authenticated or wallet not connected");
      }

      const asset = assetName ?? "USDC";
      const assetConfig = getAssetConfig(asset);

      // Step 1: Sign internal withdraw (subaccount → SCW on Derive ledger)
      setWithdrawStep("signing");
      const config = getConfig();
      const nonce = generateNonce();
      const signatureExpiry = getSignatureExpiry();
      const scaledAmount = toTokenAmount(amount, assetConfig.decimals);

      const withdrawData = encodeWithdrawData({
        amount: scaledAmount,
        asset: assetConfig.cashAsset,
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
        asset_name: asset,
        nonce,
        signature_expiry_sec: signatureExpiry,
        signer: sessionKey.public_key,
        signature: stripSigPrefix(signature),
      });

      // Step 3: Transfer tokens from SCW → EOA on-chain
      setWithdrawStep("transferring");
      await transferTokenFromScw({
        walletClient,
        wagmiConfig,
        switchChainAsync,
        deriveWallet,
        eoaAddress: address,
        amount,
        tokenAddress: assetConfig.tokenAddress,
        decimals: assetConfig.decimals,
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
