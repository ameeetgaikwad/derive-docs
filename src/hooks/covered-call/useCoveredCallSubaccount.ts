"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDerive } from "@/providers/DeriveProvider";
import { useAccountStore } from "@/stores/account";
import { useCoveredCallStore } from "@/stores/covered-call";
import { useAccount, useWalletClient, useSwitchChain } from "wagmi";
import { useConfig as useWagmiConfig } from "wagmi";
import {
  encodeDepositData,
  encodeWithdrawData,
  toTokenAmount,
  signAction,
  generateNonce,
  getSignatureExpiry,
} from "@/lib/derive/signing";
import { getConfig, getAssetConfig, type SupportedAsset } from "@/lib/derive/constants";
import { toast } from "sonner";
import { createPublicClient, erc20Abi, encodeFunctionData, http } from "viem";
import { waitForTransactionReceipt } from "wagmi/actions";
import { getDeriveChain } from "@/lib/chain/derive";
import type { Hex } from "viem";
import type { WalletClient } from "viem";
import type { Config } from "wagmi";

/** BTC variants use 8 decimals on Derive chain */
const BTC_DECIMALS = 8;

/** Strip 0x prefix from signature — Derive API expects raw hex (130 chars, no prefix). */
function stripSigPrefix(sig: string): string {
  return sig.startsWith("0x") ? sig.slice(2) : sig;
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
 * Ensure the SCW has enough BTC tokens on Derive Chain for the deposit.
 * If the SCW already has sufficient balance, skip the EOA transfer.
 * Otherwise, transfer from EOA -> SCW.
 */
async function ensureScwHasBtc({
  walletClient,
  wagmiConfig,
  switchChainAsync,
  deriveWallet,
  amount,
  tokenAddress,
  assetName,
}: {
  walletClient: WalletClient;
  wagmiConfig: Config;
  switchChainAsync: ReturnType<typeof useSwitchChain>["switchChainAsync"];
  deriveWallet: `0x${string}`;
  amount: string;
  tokenAddress: `0x${string}`;
  assetName: string;
}): Promise<void> {
  const config = getConfig();
  const scaledAmount = toTokenAmount(amount, BTC_DECIMALS);

  if (walletClient.chain?.id !== config.chainId) {
    await switchChainAsync({ chainId: config.chainId });
  }

  const deriveEnv = (process.env.NEXT_PUBLIC_DERIVE_ENV as "testnet" | "mainnet") || "mainnet";
  const chain = getDeriveChain(deriveEnv);

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
    console.log(`[CoveredCall] SCW already has sufficient ${assetName}, skipping EOA transfer`);
    return;
  }

  const deficit = scaledAmount - scwBalance;
  const [account] = await walletClient.getAddresses();

  console.log(`[CoveredCall] Transferring ${deficit.toString()} ${assetName} units from EOA to SCW`);

  const txHash = await walletClient.writeContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "transfer",
    args: [deriveWallet, deficit],
    account,
    chain,
  });

  await waitForTransactionReceipt(wagmiConfig, { hash: txHash });
}

/**
 * Ensure the SCW has approved the deposit module to spend the BTC token.
 */
async function ensureScwBtcApprovals({
  walletClient,
  wagmiConfig,
  switchChainAsync,
  deriveWallet,
  tokenAddress,
  assetName,
}: {
  walletClient: WalletClient;
  wagmiConfig: Config;
  switchChainAsync: ReturnType<typeof useSwitchChain>["switchChainAsync"];
  deriveWallet: `0x${string}`;
  tokenAddress: `0x${string}`;
  assetName: string;
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

    console.log(`[CoveredCall] SCW needs ${assetName} approval for`, spender, "— sending via SCW.execute");

    const approveCalldata = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, maxUint256],
    });

    const executeCalldata = encodeFunctionData({
      abi: LIGHT_ACCOUNT_EXECUTE_ABI,
      functionName: "execute",
      args: [tokenAddress, 0n, approveCalldata],
    });

    const [account] = await walletClient.getAddresses();

    const txHash = await walletClient.sendTransaction({
      to: deriveWallet,
      data: executeCalldata,
      value: 0n,
      account,
      chain,
    });

    await waitForTransactionReceipt(wagmiConfig, { hash: txHash });
    console.log(`[CoveredCall] ${assetName} approval tx confirmed for`, spender);
  }
}

/**
 * Transfer an ERC-20 token from SCW -> EOA via SCW.execute.
 */
async function transferTokenFromScw({
  walletClient,
  wagmiConfig,
  switchChainAsync,
  deriveWallet,
  eoaAddress,
  tokenAddress,
  scaledAmount,
}: {
  walletClient: WalletClient;
  wagmiConfig: Config;
  switchChainAsync: ReturnType<typeof useSwitchChain>["switchChainAsync"];
  deriveWallet: `0x${string}`;
  eoaAddress: `0x${string}`;
  tokenAddress: `0x${string}`;
  scaledAmount: bigint;
}): Promise<Hex> {
  const config = getConfig();
  const deriveEnv = (process.env.NEXT_PUBLIC_DERIVE_ENV as "testnet" | "mainnet") || "mainnet";
  const chain = getDeriveChain(deriveEnv);

  if (walletClient.chain?.id !== config.chainId) {
    await switchChainAsync({ chainId: config.chainId });
  }

  const transferCalldata = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [eoaAddress, scaledAmount],
  });

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
    chain,
  });

  await waitForTransactionReceipt(wagmiConfig, { hash: txHash });
  return txHash;
}

interface CreateCoveredCallParams {
  amount: string; // BTC amount (human readable, e.g. "1.0" for 1 BTC)
  btcAsset?: SupportedAsset; // Which BTC variant to use (default: "CBBTC")
}

/**
 * Create a new covered call position:
 * 1. Create a PM2 subaccount via API (EOA signs)
 * 2. Transfer WBTC from EOA -> SCW if needed
 * 3. Approve deposit module for WBTC
 * 4. Deposit WBTC into the new subaccount (session key signs)
 * 5. Add position to store with status "deposited"
 */
export function useCreateCoveredCallPosition() {
  const { restClient, deriveWallet } = useDerive();
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const wagmiConfig = useWagmiConfig();
  const { sessionKey } = useAccountStore();
  const { addPosition } = useCoveredCallStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ amount, btcAsset = "CBBTC" }: CreateCoveredCallParams) => {
      if (!address || !walletClient || !deriveWallet || !sessionKey) {
        throw new Error("Wallet not connected or not authenticated");
      }

      const config = getConfig();
      const assetConfig = getAssetConfig(btcAsset);

      // Step 1: Create subaccount (session key signs)
      const createNonce = generateNonce();
      const createExpiry = getSignatureExpiry();

      const createDepositData = encodeDepositData({
        amount: 0n,
        asset: assetConfig.cashAsset,
        managerForNewAccount: config.standardManager,
      });

      const createSig = await signAction({
        subaccountId: 0n,
        nonce: BigInt(createNonce),
        module: config.depositModule,
        data: createDepositData,
        expiry: BigInt(createExpiry),
        owner: deriveWallet,
        sessionPrivateKey: sessionKey.private_key,
      });

      const createResult = await restClient.createSubaccount({
        wallet: deriveWallet,
        amount: "0",
        asset_name: btcAsset,
        nonce: createNonce,
        signature_expiry_sec: createExpiry,
        signer: sessionKey.public_key,
        signature: stripSigPrefix(createSig),
        margin_type: "SM",
      });

      const newSubaccountId = createResult.subaccount_id;
      console.log(`[CoveredCall] Created SM subaccount: ${newSubaccountId} (${btcAsset})`);

      // Step 2: Transfer BTC from EOA -> SCW if needed
      await ensureScwHasBtc({
        walletClient,
        wagmiConfig,
        switchChainAsync,
        deriveWallet,
        amount,
        tokenAddress: assetConfig.tokenAddress,
        assetName: btcAsset,
      });

      // Step 3: Approve deposit module for BTC token
      await ensureScwBtcApprovals({
        walletClient,
        wagmiConfig,
        switchChainAsync,
        deriveWallet,
        tokenAddress: assetConfig.tokenAddress,
        assetName: btcAsset,
      });

      // Step 4: Deposit BTC into the new subaccount (session key signs)
      const depositNonce = generateNonce();
      const depositExpiry = getSignatureExpiry();
      const scaledAmount = toTokenAmount(amount, BTC_DECIMALS);

      const depositData = encodeDepositData({
        amount: scaledAmount,
        asset: assetConfig.cashAsset,
        managerForNewAccount: config.standardManager,
      });

      const depositSig = await signAction({
        subaccountId: BigInt(newSubaccountId),
        nonce: BigInt(depositNonce),
        module: config.depositModule,
        data: depositData,
        expiry: BigInt(depositExpiry),
        owner: deriveWallet,
        sessionPrivateKey: sessionKey.private_key,
      });

      await restClient.deposit({
        subaccount_id: newSubaccountId,
        amount,
        asset_name: btcAsset,
        nonce: depositNonce,
        signature_expiry_sec: depositExpiry,
        signer: sessionKey.public_key,
        signature: stripSigPrefix(depositSig),
      });

      console.log(`[CoveredCall] Deposited ${amount} ${btcAsset} into subaccount ${newSubaccountId}`);

      // Step 5: Add position to store
      addPosition({
        subaccountId: newSubaccountId,
        asset: btcAsset,
        amount,
        instrumentName: null,
        strike: null,
        expiry: null,
        premiumUsdc: null,
        status: "deposited",
      });

      queryClient.invalidateQueries({ queryKey: ["collaterals"] });

      return { subaccountId: newSubaccountId };
    },
    onSuccess: ({ subaccountId }) => {
      toast.success(`Covered call position created (subaccount ${subaccountId})`);
    },
    onError: (error) => {
      toast.error(`Failed to create covered call position: ${error.message}`);
    },
  });
}

interface CloseCoveredCallParams {
  subaccountId: number;
}

/**
 * Close a covered call position:
 * 1. Withdraw remaining BTC collateral from the subaccount
 * 2. Withdraw remaining USDC from the subaccount
 * 3. Transfer assets from SCW -> EOA on-chain
 * 4. Update position status to "closed"
 */
export function useCloseCoveredCallPosition() {
  const { restClient, deriveWallet } = useDerive();
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const wagmiConfig = useWagmiConfig();
  const { sessionKey } = useAccountStore();
  const { updatePosition } = useCoveredCallStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ subaccountId }: CloseCoveredCallParams) => {
      if (!address || !walletClient || !deriveWallet || !sessionKey) {
        throw new Error("Wallet not connected or not authenticated");
      }

      const config = getConfig();
      const deriveEnv = (process.env.NEXT_PUBLIC_DERIVE_ENV as "testnet" | "mainnet") || "mainnet";
      const chain = getDeriveChain(deriveEnv);

      const publicClient = createPublicClient({
        chain,
        transport: http(config.rpcUrl),
      });

      // Step 1: Withdraw remaining BTC collateral from subaccount
      const collaterals = await restClient.getCollaterals(subaccountId);
      // Find any BTC variant in the subaccount
      const btcCollateral = collaterals.find((c) =>
        ["WBTC", "CBBTC", "LBTC", "BTC"].includes(c.asset_name)
      );
      const usdcCollateral = collaterals.find((c) => c.asset_name === "USDC");

      if (btcCollateral && parseFloat(btcCollateral.amount) > 0) {
        const btcAssetName = btcCollateral.asset_name as SupportedAsset;
        const btcAssetConfig = (btcAssetName === "CBBTC" || btcAssetName === "WBTC")
          ? getAssetConfig(btcAssetName)
          : getAssetConfig("CBBTC"); // fallback

        const btcNonce = generateNonce();
        const btcExpiry = getSignatureExpiry();
        const btcScaled = toTokenAmount(btcCollateral.amount, BTC_DECIMALS);

        const btcWithdrawData = encodeWithdrawData({
          amount: btcScaled,
          asset: btcAssetConfig.cashAsset,
        });

        const btcSig = await signAction({
          subaccountId: BigInt(subaccountId),
          nonce: BigInt(btcNonce),
          module: config.withdrawalModule,
          data: btcWithdrawData,
          expiry: BigInt(btcExpiry),
          owner: deriveWallet,
          sessionPrivateKey: sessionKey.private_key,
        });

        await restClient.withdraw({
          subaccount_id: subaccountId,
          amount: btcCollateral.amount,
          asset_name: btcCollateral.asset_name,
          nonce: btcNonce,
          signature_expiry_sec: btcExpiry,
          signer: sessionKey.public_key,
          signature: stripSigPrefix(btcSig),
        });

        console.log(`[CoveredCall] Withdrew ${btcCollateral.amount} ${btcCollateral.asset_name} from subaccount ${subaccountId}`);
      }

      // Step 2: Withdraw remaining USDC from subaccount
      const USDC_DECIMALS = 6;

      if (usdcCollateral && parseFloat(usdcCollateral.amount) > 0) {
        const usdcNonce = generateNonce();
        const usdcExpiry = getSignatureExpiry();
        const usdcScaled = toTokenAmount(usdcCollateral.amount, USDC_DECIMALS);

        const usdcWithdrawData = encodeWithdrawData({
          amount: usdcScaled,
          asset: config.usdcCashAsset,
        });

        const usdcSig = await signAction({
          subaccountId: BigInt(subaccountId),
          nonce: BigInt(usdcNonce),
          module: config.withdrawalModule,
          data: usdcWithdrawData,
          expiry: BigInt(usdcExpiry),
          owner: deriveWallet,
          sessionPrivateKey: sessionKey.private_key,
        });

        await restClient.withdraw({
          subaccount_id: subaccountId,
          amount: usdcCollateral.amount,
          asset_name: "USDC",
          nonce: usdcNonce,
          signature_expiry_sec: usdcExpiry,
          signer: sessionKey.public_key,
          signature: stripSigPrefix(usdcSig),
        });

        console.log(`[CoveredCall] Withdrew ${usdcCollateral.amount} USDC from subaccount ${subaccountId}`);
      }

      // Step 3: Transfer assets from SCW -> EOA on-chain
      // Check SCW balances for all BTC variants and transfer whatever is there
      const btcTokenAddresses = [config.cbbtcAddress, config.wbtcAddress];
      for (const tokenAddr of btcTokenAddresses) {
        if (tokenAddr === "0x0000000000000000000000000000000000000000") continue;
        const scwBtcBalance = await publicClient.readContract({
          address: tokenAddr,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [deriveWallet],
        });
        if (scwBtcBalance > 0n) {
          await transferTokenFromScw({
            walletClient,
            wagmiConfig,
            switchChainAsync,
            deriveWallet,
            eoaAddress: address,
            tokenAddress: tokenAddr,
            scaledAmount: scwBtcBalance,
          });
          console.log(`[CoveredCall] Transferred BTC tokens from SCW to EOA (${tokenAddr})`);
        }
      }

      const scwUsdcBalance = await publicClient.readContract({
        address: config.usdcAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [deriveWallet],
      });

      if (scwUsdcBalance > 0n) {
        await transferTokenFromScw({
          walletClient,
          wagmiConfig,
          switchChainAsync,
          deriveWallet,
          eoaAddress: address,
          tokenAddress: config.usdcAddress,
          scaledAmount: scwUsdcBalance,
        });
        console.log("[CoveredCall] Transferred USDC from SCW to EOA");
      }

      // Step 4: Update position status
      updatePosition(subaccountId, { status: "closed" });

      queryClient.invalidateQueries({ queryKey: ["collaterals"] });

      return { subaccountId };
    },
    onSuccess: ({ subaccountId }) => {
      toast.success(`Covered call position closed (subaccount ${subaccountId})`);
    },
    onError: (error) => {
      toast.error(`Failed to close covered call position: ${error.message}`);
    },
  });
}
