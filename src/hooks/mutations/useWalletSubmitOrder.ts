"use client";

import { useMutation } from "@tanstack/react-query";
import { useWalletClient } from "wagmi";
import { useDerive } from "@/providers/DeriveProvider";
import { useTradeStore } from "@/stores/trade";
import { useAccountStore } from "@/stores/account";
import {
  encodeTradeData,
  signActionWithWallet,
  generateNonce,
  getSignatureExpiry,
} from "@/lib/derive/signing";
import { getConfig } from "@/lib/derive/constants";
import { toBN } from "@/lib/derive/utils";
import type { OrderResult, OrderDirection } from "@/lib/derive/types";
import type { Hex } from "viem";
import { toast } from "sonner";

/** Strip 0x prefix from signature — Derive API expects raw hex. */
function stripSigPrefix(sig: string): string {
  return sig.startsWith("0x") ? sig.slice(2) : sig;
}

interface SubmitOrderParams {
  instrumentName: string;
  direction: OrderDirection;
  amount: string;
  limitPrice: string;
  baseAssetAddress: string;
  baseAssetSubId: string;
}

/**
 * Submit orders using direct wallet signing (MetaMask popup per trade).
 * No session key needed — the EOA signs the EIP-712 action directly.
 */
export function useWalletSubmitOrder() {
  const { restClient, subaccountId, deriveWallet } = useDerive();
  const { data: walletClient } = useWalletClient();
  const tradeStore = useTradeStore();

  return useMutation<OrderResult, Error, SubmitOrderParams>({
    mutationFn: async (params) => {
      if (!subaccountId || !walletClient || !deriveWallet) {
        throw new Error("Not authenticated");
      }

      const eoaAddress = walletClient.account.address;
      tradeStore.setStatus("signing");

      const config = getConfig();
      const nonce = generateNonce();
      const signatureExpiry = getSignatureExpiry();

      const amountBN = toBN(params.amount);
      const limitPriceBN = toBN(params.limitPrice);
      const maxFeeBN = toBN("100");

      const tradeData = encodeTradeData({
        assetAddress: params.baseAssetAddress as Hex,
        subId: BigInt(params.baseAssetSubId),
        limitPrice: limitPriceBN,
        amount: amountBN,
        maxFee: maxFeeBN,
        subaccountId: BigInt(subaccountId),
        isBid: params.direction === "buy",
      });

      // Sign with wallet (one MetaMask popup)
      const signature = await signActionWithWallet({
        subaccountId: BigInt(subaccountId),
        nonce: BigInt(nonce),
        module: config.tradeModule,
        data: tradeData,
        expiry: BigInt(signatureExpiry),
        owner: deriveWallet,
        signer: eoaAddress,
        signTypedData: (args) => walletClient.signTypedData(args),
      });

      tradeStore.setStatus("submitting");

      const result = await restClient.submitOrder({
        instrument_name: params.instrumentName,
        direction: params.direction,
        order_type: "limit",
        amount: params.amount,
        limit_price: params.limitPrice,
        time_in_force: "gtc",
        subaccount_id: subaccountId,
        nonce,
        signature_expiry_sec: signatureExpiry,
        signer: eoaAddress, // EOA address (the wallet that signs)
        signature: stripSigPrefix(signature),
        max_fee: "100",
      });

      return result;
    },
    onSuccess: (result) => {
      tradeStore.setStatus("success");
      const fills = result.trades.length;
      toast.success(fills > 0 ? `Order filled! ${fills} trade(s)` : "Order placed on book");
      setTimeout(() => tradeStore.setStatus("idle"), 2000);
    },
    onError: (error) => {
      tradeStore.setError(error.message);
      toast.error(`Order failed: ${error.message}`);
    },
  });
}
