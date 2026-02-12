"use client";

import { useMutation } from "@tanstack/react-query";
import { useDerive } from "@/providers/DeriveProvider";
import { useTradeStore } from "@/stores/trade";
import { useMarketsStore } from "@/stores/markets";
import { useAccountStore } from "@/stores/account";
import {
  encodeTradeData,
  signAction,
  generateNonce,
  getSignatureExpiry,
} from "@/lib/derive/signing";
import { getConfig } from "@/lib/derive/constants";
import { toBN } from "@/lib/derive/utils";
import type { OrderResult, OrderDirection } from "@/lib/derive/types";
import type { Hex } from "viem";
import { toast } from "sonner";

interface SubmitOrderParams {
  instrumentName: string;
  direction: OrderDirection;
  amount: string;
  limitPrice: string;
  baseAssetAddress: string;
  baseAssetSubId: string;
}

export function useSubmitOrder() {
  const { restClient, subaccountId, deriveWallet } = useDerive();
  const { sessionKey } = useAccountStore();
  const tradeStore = useTradeStore();

  return useMutation<OrderResult, Error, SubmitOrderParams>({
    mutationFn: async (params) => {
      if (!subaccountId || !sessionKey || !deriveWallet) {
        throw new Error("Not authenticated");
      }

      tradeStore.setStatus("signing");

      const config = getConfig();
      const nonce = generateNonce();
      const signatureExpiry = getSignatureExpiry();

      // Convert amounts to 18-decimal
      const amountBN = toBN(params.amount);
      const limitPriceBN = toBN(params.limitPrice);
      const maxFeeBN = toBN("100"); // Max fee in USDC (generous for testnet)

      // Encode trade data per Derive docs:
      // Order: [asset, subId, limitPrice, amount, maxFee, subaccountId, isBid]
      const tradeData = encodeTradeData({
        assetAddress: params.baseAssetAddress as Hex,
        subId: BigInt(params.baseAssetSubId),
        limitPrice: limitPriceBN,
        amount: amountBN,
        maxFee: maxFeeBN,
        subaccountId: BigInt(subaccountId),
        isBid: params.direction === "buy",
      });

      // Sign the action with session key
      const signature = await signAction({
        subaccountId: BigInt(subaccountId),
        nonce: BigInt(nonce),
        module: config.tradeModule,
        data: tradeData,
        expiry: BigInt(signatureExpiry),
        owner: deriveWallet,
        sessionPrivateKey: sessionKey.private_key,
      });

      tradeStore.setStatus("submitting");

      // Submit order
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
        signer: sessionKey.public_key,
        signature,
        max_fee: "100",
      });

      return result;
    },
    onSuccess: (result) => {
      tradeStore.setStatus("success");
      const fills = result.trades.length;
      if (fills > 0) {
        toast.success(`Order filled! ${fills} trade(s)`);
      } else {
        toast.success("Order placed on book");
      }
      setTimeout(() => tradeStore.setStatus("idle"), 2000);
    },
    onError: (error) => {
      tradeStore.setError(error.message);
      toast.error(`Order failed: ${error.message}`);
    },
  });
}
