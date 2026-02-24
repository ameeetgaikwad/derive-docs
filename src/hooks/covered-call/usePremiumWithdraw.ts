"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDerive } from "@/providers/DeriveProvider";
import { useAccountStore } from "@/stores/account";
import { useAccount, useWalletClient, useSwitchChain } from "wagmi";
import { useConfig as useWagmiConfig } from "wagmi";
import {
  encodeWithdrawData,
  signAction,
  toTokenAmount,
  generateNonce,
  getSignatureExpiry,
} from "@/lib/derive/signing";
import { getConfig, USDC_DECIMALS } from "@/lib/derive/constants";
import { toast } from "sonner";
import { encodeFunctionData, erc20Abi, http, createPublicClient } from "viem";
import { waitForTransactionReceipt } from "wagmi/actions";
import { getDeriveChain } from "@/lib/chain/derive";
import type { Hex } from "viem";

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

interface PremiumWithdrawParams {
  subaccountId: number;
  amount: string; // USDC amount (human readable, e.g. "500")
}

/**
 * Withdraw USDC premium from a PM2 subaccount to the user's EOA.
 * 1. Sign withdraw from subaccount (session key)
 * 2. Submit to API
 * 3. Transfer USDC from SCW to EOA on-chain
 */
export function usePremiumWithdraw() {
  const { restClient, deriveWallet } = useDerive();
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const wagmiConfig = useWagmiConfig();
  const { sessionKey } = useAccountStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ subaccountId, amount }: PremiumWithdrawParams) => {
      if (!address || !walletClient || !deriveWallet || !sessionKey) {
        throw new Error("Wallet not connected or not authenticated");
      }

      const config = getConfig();

      // Step 1: Sign internal withdraw (subaccount -> SCW on Derive ledger)
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
      await restClient.withdraw({
        subaccount_id: subaccountId,
        amount,
        asset_name: "USDC",
        nonce,
        signature_expiry_sec: signatureExpiry,
        signer: sessionKey.public_key,
        signature: stripSigPrefix(signature),
      });

      // Step 3: Transfer USDC from SCW -> EOA on-chain
      if (walletClient.chain?.id !== config.chainId) {
        await switchChainAsync({ chainId: config.chainId });
      }

      const transferCalldata = encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [address, scaledAmount],
      });

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

      queryClient.invalidateQueries({ queryKey: ["collaterals"] });

      return { txHash };
    },
    onSuccess: () => {
      toast.success("Premium withdrawn to your wallet");
    },
    onError: (error) => {
      toast.error(`Premium withdrawal failed: ${error.message}`);
    },
  });
}
