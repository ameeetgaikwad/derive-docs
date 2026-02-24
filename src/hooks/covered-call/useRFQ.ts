"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useDerive } from "@/providers/DeriveProvider";
import { useAccountStore } from "@/stores/account";
import {
  encodeTradeData,
  signAction,
  generateNonce,
  getSignatureExpiry,
  toTokenAmount,
} from "@/lib/derive/signing";
import { getConfig } from "@/lib/derive/constants";
import { toast } from "sonner";
import type { RFQQuote } from "@/lib/derive/types";
import type { Hex } from "viem";

/** Strip 0x prefix from signature — Derive API expects raw hex (130 chars, no prefix). */
function stripSigPrefix(sig: string): string {
  return sig.startsWith("0x") ? sig.slice(2) : sig;
}

interface RequestQuoteParams {
  subaccountId: number;
  instrumentName: string;
  amount: string;
}

/**
 * Send an RFQ (Request for Quote) to market makers for a single sell leg.
 */
export function useRequestQuote() {
  const { restClient } = useDerive();

  return useMutation({
    mutationFn: async ({ subaccountId, instrumentName, amount }: RequestQuoteParams) => {
      const result = await restClient.sendRfq({
        subaccount_id: subaccountId,
        legs: [
          {
            instrument_name: instrumentName,
            direction: "sell",
            amount,
          },
        ],
      });

      return result;
    },
    onSuccess: () => {
      toast.success("Quote request sent to market makers");
    },
    onError: (error) => {
      toast.error(`Failed to request quote: ${error.message}`);
    },
  });
}

/**
 * Poll for quotes received on an RFQ. Polls every 2 seconds when rfqId is provided.
 */
export function useQuotes(rfqId: string | null, subaccountId: number | null) {
  const { restClient } = useDerive();

  return useQuery({
    queryKey: ["rfq-quotes", rfqId],
    queryFn: async () => {
      if (!rfqId || !subaccountId) return [];

      const result = await restClient.pollRfqs({
        subaccount_id: subaccountId,
        rfq_id: rfqId,
        status: "open",
      });

      return result.rfqs ?? [];
    },
    enabled: !!rfqId && !!subaccountId,
    refetchInterval: 2000,
  });
}

interface AcceptQuoteParams {
  subaccountId: number;
  rfqId: string;
  quote: RFQQuote;
}

/**
 * Accept a received RFQ quote by signing the trade and executing it.
 */
export function useAcceptQuote() {
  const { restClient, deriveWallet } = useDerive();
  const { sessionKey } = useAccountStore();

  return useMutation({
    mutationFn: async ({ subaccountId, rfqId, quote }: AcceptQuoteParams) => {
      if (!sessionKey || !deriveWallet) {
        throw new Error("Not authenticated");
      }

      const config = getConfig();
      const nonce = generateNonce();
      const signatureExpiry = getSignatureExpiry();

      // For the first leg of the quote, build trade data for signing
      const leg = quote.legs[0];
      if (!leg) throw new Error("Quote has no legs");

      // We need the instrument's base_asset_address and sub_id.
      // Fetch the instrument to get these values.
      const instruments = await restClient.getInstruments("BTC", "option");
      const instrument = instruments.find((i) => i.instrument_name === leg.instrument_name);
      if (!instrument) throw new Error(`Instrument not found: ${leg.instrument_name}`);

      const limitPrice = toTokenAmount(leg.price, 18);
      const amount = toTokenAmount(leg.amount, 18);
      const maxFee = toTokenAmount("10", 18);

      const tradeData = encodeTradeData({
        assetAddress: instrument.base_asset_address as Hex,
        subId: BigInt(instrument.base_asset_sub_id),
        limitPrice,
        amount,
        maxFee,
        subaccountId: BigInt(subaccountId),
        isBid: false, // selling
      });

      const signature = await signAction({
        subaccountId: BigInt(subaccountId),
        nonce: BigInt(nonce),
        module: config.tradeModule,
        data: tradeData,
        expiry: BigInt(signatureExpiry),
        owner: deriveWallet,
        sessionPrivateKey: sessionKey.private_key,
      });

      const result = await restClient.executeQuote({
        subaccount_id: subaccountId,
        rfq_id: rfqId,
        legs: [
          {
            instrument_name: leg.instrument_name,
            direction: "sell",
            amount: leg.amount,
            limit_price: leg.price,
            max_fee: "10",
          },
        ],
        nonce,
        signature_expiry_sec: signatureExpiry,
        signer: sessionKey.public_key,
        signature: stripSigPrefix(signature),
      });

      return result;
    },
    onSuccess: () => {
      toast.success("Quote accepted — option sold");
    },
    onError: (error) => {
      toast.error(`Failed to accept quote: ${error.message}`);
    },
  });
}
