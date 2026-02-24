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
  signActionWithWallet,
  generateNonce,
  getSignatureExpiry,
} from "@/lib/derive/signing";
import { getConfig } from "@/lib/derive/constants";
import { toast } from "sonner";
import { createPublicClient, erc20Abi, encodeFunctionData, http } from "viem";
import { waitForTransactionReceipt } from "wagmi/actions";
import { getDeriveChain } from "@/lib/chain/derive";
import type { Hex } from "viem";
import type { WalletClient } from "viem";
import type { Config } from "wagmi";

/** WBTC uses 8 decimals on Derive chain */
const WBTC_DECIMALS = 8;

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
 * Ensure the SCW has enough WBTC on Derive Chain for the deposit.
 * If the SCW already has sufficient balance, skip the EOA transfer.
 * Otherwise, transfer WBTC from EOA -> SCW.
 */
async function ensureScwHasWbtc({
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
}): Promise<void> {
  const config = getConfig();
  const scaledAmount = toTokenAmount(amount, WBTC_DECIMALS);

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
    address: config.wbtcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [deriveWallet],
  });

  if (scwBalance >= scaledAmount) {
    console.log("[CoveredCall] SCW already has sufficient WBTC, skipping EOA transfer");
    return;
  }

  const deficit = scaledAmount - scwBalance;
  const [account] = await walletClient.getAddresses();

  console.log("[CoveredCall] Transferring", deficit.toString(), "WBTC units from EOA to SCW");

  const txHash = await walletClient.writeContract({
    address: config.wbtcAddress,
    abi: erc20Abi,
    functionName: "transfer",
    args: [deriveWallet, deficit],
    account,
    chain: { id: config.chainId } as any,
  });

  await waitForTransactionReceipt(wagmiConfig, { hash: txHash });
}

/**
 * Ensure the SCW has approved the deposit module to spend WBTC.
 */
async function ensureScwWbtcApprovals({
  walletClient,
  wagmiConfig,
  switchChainAsync,
  deriveWallet,
}: {
  walletClient: WalletClient;
  wagmiConfig: Config;
  switchChainAsync: ReturnType<typeof useSwitchChain>["switchChainAsync"];
  deriveWallet: `0x${string}`;
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
      address: config.wbtcAddress,
      abi: erc20Abi,
      functionName: "allowance",
      args: [deriveWallet, spender],
    });

    if (allowance > 0n) continue;

    console.log("[CoveredCall] SCW needs WBTC approval for", spender, "— sending via SCW.execute");

    const approveCalldata = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, maxUint256],
    });

    const executeCalldata = encodeFunctionData({
      abi: LIGHT_ACCOUNT_EXECUTE_ABI,
      functionName: "execute",
      args: [config.wbtcAddress, 0n, approveCalldata],
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
    console.log("[CoveredCall] WBTC approval tx confirmed for", spender);
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
    chain: { id: config.chainId } as any,
  });

  await waitForTransactionReceipt(wagmiConfig, { hash: txHash });
  return txHash;
}

interface CreateCoveredCallParams {
  amount: string; // WBTC amount (human readable, e.g. "1.0" for 1 BTC)
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
    mutationFn: async ({ amount }: CreateCoveredCallParams) => {
      if (!address || !walletClient || !deriveWallet || !sessionKey) {
        throw new Error("Wallet not connected or not authenticated");
      }

      const config = getConfig();

      // Step 1: Create PM2 subaccount (EOA signs via signActionWithWallet)
      const createNonce = generateNonce();
      const createExpiry = getSignatureExpiry();

      const createDepositData = encodeDepositData({
        amount: 0n,
        asset: config.wbtcCashAsset,
        managerForNewAccount: config.portfolioManager,
      });

      const createSig = await signActionWithWallet({
        subaccountId: 0n,
        nonce: BigInt(createNonce),
        module: config.depositModule,
        data: createDepositData,
        expiry: BigInt(createExpiry),
        owner: deriveWallet,
        signer: address,
        signTypedData: (args) =>
          walletClient.signTypedData(args) as Promise<Hex>,
      });

      const createResult = await restClient.createSubaccount({
        wallet: deriveWallet,
        amount: "0",
        asset_name: "WBTC",
        nonce: createNonce,
        signature_expiry_sec: createExpiry,
        signer: address,
        signature: stripSigPrefix(createSig),
        margin_type: "PM2",
      });

      const newSubaccountId = createResult.subaccount_id;
      console.log("[CoveredCall] Created PM2 subaccount:", newSubaccountId);

      // Step 2: Transfer WBTC from EOA -> SCW if needed
      await ensureScwHasWbtc({
        walletClient,
        wagmiConfig,
        switchChainAsync,
        deriveWallet,
        amount,
      });

      // Step 3: Approve deposit module for WBTC
      await ensureScwWbtcApprovals({
        walletClient,
        wagmiConfig,
        switchChainAsync,
        deriveWallet,
      });

      // Step 4: Deposit WBTC into the new subaccount (session key signs)
      const depositNonce = generateNonce();
      const depositExpiry = getSignatureExpiry();
      const scaledAmount = toTokenAmount(amount, WBTC_DECIMALS);

      const depositData = encodeDepositData({
        amount: scaledAmount,
        asset: config.wbtcCashAsset,
        managerForNewAccount: config.portfolioManager,
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
        asset_name: "WBTC",
        nonce: depositNonce,
        signature_expiry_sec: depositExpiry,
        signer: sessionKey.public_key,
        signature: stripSigPrefix(depositSig),
      });

      console.log("[CoveredCall] Deposited", amount, "WBTC into subaccount", newSubaccountId);

      // Step 5: Add position to store
      addPosition({
        subaccountId: newSubaccountId,
        asset: "WBTC",
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
 * 1. Withdraw remaining WBTC from the subaccount
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

      // Step 1: Withdraw remaining WBTC from subaccount
      const collaterals = await restClient.getCollaterals(subaccountId);
      const wbtcCollateral = collaterals.find((c) => c.asset_name === "WBTC");
      const usdcCollateral = collaterals.find((c) => c.asset_name === "USDC");

      if (wbtcCollateral && parseFloat(wbtcCollateral.amount) > 0) {
        const wbtcNonce = generateNonce();
        const wbtcExpiry = getSignatureExpiry();
        const wbtcScaled = toTokenAmount(wbtcCollateral.amount, WBTC_DECIMALS);

        const wbtcWithdrawData = encodeWithdrawData({
          amount: wbtcScaled,
          asset: config.wbtcCashAsset,
        });

        const wbtcSig = await signAction({
          subaccountId: BigInt(subaccountId),
          nonce: BigInt(wbtcNonce),
          module: config.withdrawalModule,
          data: wbtcWithdrawData,
          expiry: BigInt(wbtcExpiry),
          owner: deriveWallet,
          sessionPrivateKey: sessionKey.private_key,
        });

        await restClient.withdraw({
          subaccount_id: subaccountId,
          amount: wbtcCollateral.amount,
          asset_name: "WBTC",
          nonce: wbtcNonce,
          signature_expiry_sec: wbtcExpiry,
          signer: sessionKey.public_key,
          signature: stripSigPrefix(wbtcSig),
        });

        console.log("[CoveredCall] Withdrew", wbtcCollateral.amount, "WBTC from subaccount", subaccountId);
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

        console.log("[CoveredCall] Withdrew", usdcCollateral.amount, "USDC from subaccount", subaccountId);
      }

      // Step 3: Transfer assets from SCW -> EOA on-chain
      // Check SCW balances and transfer whatever landed
      const scwWbtcBalance = await publicClient.readContract({
        address: config.wbtcAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [deriveWallet],
      });

      if (scwWbtcBalance > 0n) {
        await transferTokenFromScw({
          walletClient,
          wagmiConfig,
          switchChainAsync,
          deriveWallet,
          eoaAddress: address,
          tokenAddress: config.wbtcAddress,
          scaledAmount: scwWbtcBalance,
        });
        console.log("[CoveredCall] Transferred WBTC from SCW to EOA");
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
