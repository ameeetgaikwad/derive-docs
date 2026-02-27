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
  encodeTradeData,
  toTokenAmount,
  signAction,
  generateNonce,
  getSignatureExpiry,
} from "@/lib/derive/signing";
import { getConfig, getAssetConfig, type SupportedAsset } from "@/lib/derive/constants";
import { sendSponsoredUserOp } from "@/lib/derive/paymaster";
import { encodeApprove, encodeCreateSubaccount, type ScwAction } from "@/lib/derive/scw-actions";
import { toBN } from "@/lib/derive/utils";
import { toast } from "sonner";
import { createPublicClient, erc20Abi, encodeFunctionData, formatUnits, http } from "viem";
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
 * Create a new covered call position (entirely gas-free):
 * 1. Withdraw BTC from main subaccount to SCW if needed (REST API, session key)
 * 2. Create SM subaccount on-chain via paymaster (bundles BTC approvals + subaccount creation)
 * 3. Get the newly created subaccount ID
 * 4. Deposit BTC into the new subaccount (REST API, session key)
 * 5. Add position to store with status "deposited"
 */
export function useCreateCoveredCallPosition() {
  const { restClient, deriveWallet, subaccountId: mainSubaccountId } = useDerive();
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
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
      const deriveEnv = (process.env.NEXT_PUBLIC_DERIVE_ENV as "testnet" | "mainnet") || "mainnet";
      const chain = getDeriveChain(deriveEnv);
      const scaledAmount = toTokenAmount(amount, BTC_DECIMALS);

      // Step 1: Ensure SCW has BTC for the deposit (gas-free via internal withdraw)
      const publicClient = createPublicClient({
        chain,
        transport: http(config.rpcUrl),
      });

      const scwBalance = await publicClient.readContract({
        address: assetConfig.tokenAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [deriveWallet],
      });

      if (scwBalance < scaledAmount) {
        if (!mainSubaccountId) {
          throw new Error("No main subaccount to withdraw BTC from");
        }

        const deficit = scaledAmount - scwBalance;
        const deficitStr = formatUnits(deficit, BTC_DECIMALS);

        const withdrawNonce = generateNonce();
        const withdrawExpiry = getSignatureExpiry();

        const withdrawData = encodeWithdrawData({
          amount: deficit,
          asset: assetConfig.cashAsset,
        });

        const withdrawSig = await signAction({
          subaccountId: BigInt(mainSubaccountId),
          nonce: BigInt(withdrawNonce),
          module: config.withdrawalModule,
          data: withdrawData,
          expiry: BigInt(withdrawExpiry),
          owner: deriveWallet,
          sessionPrivateKey: sessionKey.private_key,
        });

        await restClient.withdraw({
          subaccount_id: mainSubaccountId,
          amount: deficitStr,
          asset_name: btcAsset,
          nonce: withdrawNonce,
          signature_expiry_sec: withdrawExpiry,
          signer: sessionKey.public_key,
          signature: stripSigPrefix(withdrawSig),
        });

        console.log(`[CoveredCall] Withdrew ${deficitStr} ${btcAsset} from main subaccount to SCW`);

        // Wait for SCW to receive the tokens on-chain
        for (let i = 0; i < 20; i++) {
          const balance = await publicClient.readContract({
            address: assetConfig.tokenAddress,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [deriveWallet],
          });
          if (balance >= scaledAmount) break;
          await new Promise((r) => setTimeout(r, 1500));
        }
      } else {
        console.log(`[CoveredCall] SCW already has sufficient ${btcAsset}, skipping withdraw`);
      }

      // Step 2: Create subaccount on-chain via paymaster (gas-free)
      // Bundle BTC token approvals + subaccount creation in a single UserOp
      const existingAccount = await restClient.getAccount(deriveWallet);
      const existingIds = new Set(existingAccount.subaccount_ids || []);

      const actions: ScwAction[] = [
        encodeApprove(assetConfig.tokenAddress, config.depositModule),
        encodeApprove(assetConfig.tokenAddress, config.withdrawWrapper),
        encodeCreateSubaccount(),
      ];

      if (walletClient.chain?.id !== config.chainId) {
        await switchChainAsync({ chainId: config.chainId });
      }

      await sendSponsoredUserOp(walletClient, actions);

      // Step 3: Get the newly created subaccount ID
      let newSubaccountId: number | null = null;
      for (let i = 0; i < 10; i++) {
        const updatedAccount = await restClient.getAccount(deriveWallet);
        const newId = (updatedAccount.subaccount_ids || []).find(
          (id) => !existingIds.has(id)
        );
        if (newId !== undefined) {
          newSubaccountId = newId;
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }

      if (newSubaccountId === null) {
        throw new Error("Could not find newly created subaccount after on-chain creation");
      }

      console.log(`[CoveredCall] Created SM subaccount on-chain: ${newSubaccountId} (${btcAsset})`);

      // Step 4: Deposit BTC into the new subaccount (session key signs, gas-free)
      const depositNonce = generateNonce();
      const depositExpiry = getSignatureExpiry();

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

interface SellCallParams {
  subaccountId: number;
  instrumentName: string;
  amount: string; // human-readable e.g. "0.1"
  limitPrice: string; // USD price per option e.g. "1234.56"
  baseAssetAddress: string;
  baseAssetSubId: string;
  amountStep: string;
  minimumAmount: string;
  tickSize: string;
}

/** Round a value down to the nearest step increment. */
function roundToStep(value: number, step: number): string {
  if (step <= 0) return value.toString();
  const decimals = step.toString().split(".")[1]?.length ?? 0;
  const rounded = Math.floor(value / step) * step;
  return rounded.toFixed(decimals);
}

/**
 * Sell a call option directly into the orderbook.
 * Uses the covered-call subaccount's session key to sign a limit sell order.
 */
export function useSellCall() {
  const { restClient, deriveWallet } = useDerive();
  const { sessionKey } = useAccountStore();
  const { updatePosition } = useCoveredCallStore();

  return useMutation({
    mutationFn: async (params: SellCallParams) => {
      if (!sessionKey || !deriveWallet) {
        throw new Error("Not authenticated");
      }

      // Wait for deposit to settle — poll until subaccount has BTC collateral
      for (let i = 0; i < 15; i++) {
        const collaterals = await restClient.getCollaterals(params.subaccountId);
        const btc = collaterals.find((c) =>
          ["WBTC", "CBBTC", "LBTC", "BTC"].includes(c.asset_name)
        );
        if (btc && parseFloat(btc.amount) > 0) break;
        await new Promise((r) => setTimeout(r, 1500));
      }

      // Round amount and price to instrument constraints
      const amountStep = parseFloat(params.amountStep) || 0.01;
      const tickSize = parseFloat(params.tickSize) || 0.01;
      const minAmount = parseFloat(params.minimumAmount) || 0.01;

      const rawAmount = parseFloat(params.amount);
      const roundedAmount = roundToStep(rawAmount, amountStep);
      if (parseFloat(roundedAmount) < minAmount) {
        throw new Error(`Amount ${roundedAmount} is below minimum ${params.minimumAmount}`);
      }

      const rawPrice = parseFloat(params.limitPrice);
      const roundedPrice = roundToStep(rawPrice, tickSize);

      console.log(`[SellCall] amount: ${params.amount} -> ${roundedAmount} (step=${amountStep}), price: ${params.limitPrice} -> ${roundedPrice} (tick=${tickSize})`);

      const config = getConfig();

      // Retry logic: deposit may not be fully settled in matching engine yet
      const MAX_RETRIES = 4;
      const RETRY_DELAYS = [3000, 5000, 8000, 10000];

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          // Generate fresh nonce/expiry each attempt
          const nonce = generateNonce();
          const signatureExpiry = getSignatureExpiry();

          const amountBN = toBN(roundedAmount);
          const limitPriceBN = toBN(roundedPrice);
          const maxFeeBN = toBN("10000");

          const tradeData = encodeTradeData({
            assetAddress: params.baseAssetAddress as Hex,
            subId: BigInt(params.baseAssetSubId),
            limitPrice: limitPriceBN,
            amount: amountBN,
            maxFee: maxFeeBN,
            subaccountId: BigInt(params.subaccountId),
            isBid: false, // selling
          });

          const signature = await signAction({
            subaccountId: BigInt(params.subaccountId),
            nonce: BigInt(nonce),
            module: config.tradeModule,
            data: tradeData,
            expiry: BigInt(signatureExpiry),
            owner: deriveWallet,
            sessionPrivateKey: sessionKey.private_key,
          });

          const result = await restClient.submitOrder({
            instrument_name: params.instrumentName,
            direction: "sell",
            order_type: "limit",
            amount: roundedAmount,
            limit_price: roundedPrice,
            time_in_force: "gtc",
            subaccount_id: params.subaccountId,
            nonce,
            signature_expiry_sec: signatureExpiry,
            signer: sessionKey.public_key,
            signature: stripSigPrefix(signature),
            max_fee: "10000",
          });

          return result;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const isTransient = msg.includes("Invalid amount") || msg.includes("invalid amount") || msg.includes("Insufficient funds") || msg.includes("insufficient funds");

          if (isTransient && attempt < MAX_RETRIES) {
            console.log(`[SellCall] Attempt ${attempt + 1} failed: ${msg}. Retrying in ${RETRY_DELAYS[attempt]}ms...`);
            await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
            continue;
          }
          throw err;
        }
      }

      throw new Error("Sell order failed after retries");
    },
    onSuccess: (result, params) => {
      const fills = result.trades.length;
      if (fills > 0) {
        const totalPremium = result.trades.reduce(
          (sum, t) => sum + parseFloat(t.price) * parseFloat(t.amount),
          0
        );
        toast.success(`Call sold! Earned $${totalPremium.toFixed(2)} premium`);
        updatePosition(params.subaccountId, {
          premiumUsdc: totalPremium.toFixed(2),
          status: "active",
        });
      } else {
        toast.success("Sell order placed on book");
        updatePosition(params.subaccountId, { status: "quoted" });
      }
    },
    onError: (error) => {
      toast.error(`Failed to sell call: ${error.message}`);
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
