"use client";

import { useMutation } from "@tanstack/react-query";
import { useDerive } from "@/providers/DeriveProvider";
import { useAccountStore } from "@/stores/account";
import { useAccount, useWalletClient } from "wagmi";
import {
  encodeDepositData,
  signActionWithWallet,
  generateNonce,
  getSignatureExpiry,
} from "@/lib/derive/signing";
import { getConfig } from "@/lib/derive/constants";
import { toBN } from "@/lib/derive/utils";
import type { Hex } from "viem";
import { toast } from "sonner";

interface DepositParams {
  amount: string; // USDC amount (human readable, e.g. "100")
}

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

      // Auth should already be set up by useDeriveAccount with the Derive wallet
      const config = getConfig();
      const nonce = generateNonce();
      const signatureExpiry = getSignatureExpiry();

      const depositData = encodeDepositData({
        amount: toBN(amount),
        asset: config.usdcAddress,
        managerForNewAccount: config.standardManager,
      });

      // Sign with wallet (EOA) — user will get a MetaMask popup
      // owner = Derive smart contract wallet, signer = EOA
      const signature = await signActionWithWallet({
        subaccountId: 0n, // 0 for new account creation
        nonce: BigInt(nonce),
        module: config.depositModule,
        data: depositData,
        expiry: BigInt(signatureExpiry),
        owner: deriveWallet,
        signer: address, // EOA signs directly
        signMessage: async (msg) => {
          return walletClient.signMessage({ message: msg }) as Promise<Hex>;
        },
      });

      // Submit to API — wallet = Derive smart contract wallet
      const result = await restClient.createSubaccount({
        wallet: deriveWallet,
        amount,
        asset_name: "USDC",
        nonce,
        signature_expiry_sec: signatureExpiry,
        signer: address,
        signature,
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

export function useDeposit() {
  const { restClient, subaccountId, deriveWallet } = useDerive();
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();

  return useMutation({
    mutationFn: async ({ amount }: DepositParams) => {
      if (!address || !walletClient || !subaccountId || !deriveWallet) {
        throw new Error("Not authenticated");
      }

      const config = getConfig();
      const nonce = generateNonce();
      const signatureExpiry = getSignatureExpiry();

      const depositData = encodeDepositData({
        amount: toBN(amount),
        asset: config.usdcAddress,
        managerForNewAccount: config.standardManager,
      });

      const signature = await signActionWithWallet({
        subaccountId: BigInt(subaccountId),
        nonce: BigInt(nonce),
        module: config.depositModule,
        data: depositData,
        expiry: BigInt(signatureExpiry),
        owner: deriveWallet,
        signer: address,
        signMessage: async (msg) => {
          return walletClient.signMessage({ message: msg }) as Promise<Hex>;
        },
      });

      const result = await restClient.deposit({
        subaccount_id: subaccountId,
        amount,
        asset_name: "USDC",
        nonce,
        signature_expiry_sec: signatureExpiry,
        signer: address,
        signature,
      });

      return result;
    },
    onSuccess: () => {
      toast.success("Deposit successful!");
    },
    onError: (error) => {
      toast.error(`Deposit failed: ${error.message}`);
    },
  });
}
