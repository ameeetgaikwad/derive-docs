"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import { useAccount, useSignTypedData, useSwitchChain } from "wagmi";
import {
  actionTypedData,
  buildAction,
  getActionExpiry,
  serializeAction,
} from "@/lib/protocol/actions";
import { encodeTakerOrder, hashRfqTrades } from "@/lib/protocol/rfq";
import {
  acceptRfq,
  createRfq,
  getRfq,
  type PublicBestQuote,
  type RfqStatusResponse,
} from "@/lib/protocol/rfq-engine";
import { encodeOptionSubId } from "@/lib/protocol/instruments";
import { toUnit, unitToNumber } from "@/lib/protocol/units";
import type { AppChainId } from "@/stores/network";
import { useNetwork } from "./useNetwork";

export type SellPhase =
  | "idle"
  | "requesting"
  | "auction"
  | "quoted"
  | "signing"
  | "executing"
  | "done"
  | "expired"
  | "error";

export interface AuctionState {
  rfqId: string;
  /** ms epoch */
  endsAt: number;
  quoteCount: number;
  /** per-unit premium of the current best quote, USD */
  bestPremium: number | null;
  /** total premium of the current best quote, USD */
  bestTotalPremium: number | null;
}

export interface PreparedQuote {
  rfqId: string;
  chainId: AppChainId;
  instrumentName: string;
  expiry: number;
  strike: number;
  amount: string;
  quoteCount: number;
  /** per-unit executable premium, USD */
  premium: number;
  /** total executable premium, USD */
  totalPremium: number;
  /** ms epoch; acceptance must begin before this time */
  acceptBy: number;
}

export interface SellResult {
  txHash: Hex;
  chainId: AppChainId;
  instrumentName: string;
  /** total premium received, USD */
  totalPremium: number;
  maker: string;
}

export interface SellParams {
  subaccountId: bigint;
  /** unix seconds */
  expiry: number;
  /** whole USD strike, e.g. 69000 */
  strike: number;
  /** human decimal option amount, e.g. "0.5" */
  amount: string;
  instrumentName: string;
}

interface PreparedContext {
  params: SellParams;
  best: PublicBestQuote;
  rfqId: string;
  chainId: AppChainId;
  owner: Address;
  acceptBy: number;
  addresses: {
    btcOptionAsset: Address;
    rfqModule: Address;
    matching: Address;
  };
}

const POLL_INTERVAL_MS = 750;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * RFQ lifecycle for a covered-call sale. Quote collection and acceptance are
 * intentionally separate so the user can inspect the winning executable
 * premium before signing anything.
 */
export function useSellCall() {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const { addresses, chainId } = useNetwork();

  const [phase, setPhase] = useState<SellPhase>("idle");
  const [auction, setAuction] = useState<AuctionState | null>(null);
  const [quote, setQuote] = useState<PreparedQuote | null>(null);
  const [result, setResult] = useState<SellResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preparedRef = useRef<PreparedContext | null>(null);
  const busyRef = useRef(false);
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearExpiryTimer = useCallback(() => {
    if (expiryTimerRef.current !== null) {
      clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
    }
  }, []);

  const armExpiryTimer = useCallback(
    (acceptBy: number) => {
      clearExpiryTimer();
      const delay = Math.max(0, acceptBy - Date.now());
      expiryTimerRef.current = setTimeout(() => {
        expiryTimerRef.current = null;
        setPhase((current) =>
          current === "quoted" || current === "signing" ? "expired" : current,
        );
      }, delay);
    },
    [clearExpiryTimer],
  );

  useEffect(() => clearExpiryTimer, [clearExpiryTimer]);

  const reset = useCallback(() => {
    busyRef.current = false;
    preparedRef.current = null;
    clearExpiryTimer();
    setPhase("idle");
    setAuction(null);
    setQuote(null);
    setResult(null);
    setError(null);
  }, [clearExpiryTimer]);

  const requestQuote = useCallback(
    async (params: SellParams): Promise<PreparedQuote> => {
      if (!address) throw new Error("Wallet not connected");
      if (busyRef.current) throw new Error("A quote request is already in progress");
      if (phase === "quoted" && preparedRef.current) {
        throw new Error("An executable quote is already waiting for review");
      }

      busyRef.current = true;
      preparedRef.current = null;
      clearExpiryTimer();
      setAuction(null);
      setQuote(null);
      setResult(null);
      setError(null);

      try {
        const saleChainId = chainId;
        const saleOwner = address;
        const saleAddresses = {
          btcOptionAsset: addresses.btcOptionAsset,
          rfqModule: addresses.rfqModule,
          matching: addresses.matching,
        };

        setPhase("requesting");
        const rfq = await createRfq(
          {
            subaccountId: params.subaccountId,
            expiry: params.expiry,
            strike: params.strike.toString(),
            amount: params.amount,
          },
          saleChainId,
        );

        setPhase("auction");
        let status: RfqStatusResponse;
        for (;;) {
          status = await getRfq(rfq.id, saleChainId);
          setAuction({
            rfqId: rfq.id,
            endsAt: status.rfq.auctionEndsAt,
            quoteCount: status.quoteCount,
            bestPremium: status.bestQuote
              ? unitToNumber(BigInt(status.bestQuote.premium))
              : null,
            bestTotalPremium: status.bestQuote
              ? unitToNumber(BigInt(status.bestQuote.totalPremium))
              : null,
          });
          if (status.rfq.status !== "open") break;
          await sleep(POLL_INTERVAL_MS);
        }

        if (status.rfq.status === "expired" || !status.bestQuote) {
          throw new Error("No executable quotes were received. Try again in a moment.");
        }
        if (status.rfq.status !== "closed") {
          throw new Error(`RFQ closed in an unexpected state: ${status.rfq.status}`);
        }

        const best = status.bestQuote;
        verifyBestQuote(best, params, saleAddresses.btcOptionAsset);

        const makerExpiryMs = Number(best.actionExpiry) * 1000;
        const engineDeadline = status.rfq.acceptDeadlineAt ?? makerExpiryMs;
        const acceptBy = Math.min(engineDeadline, makerExpiryMs);
        if (!Number.isFinite(acceptBy) || acceptBy <= Date.now()) {
          setPhase("expired");
          throw new Error("The winning quote expired before it could be reviewed");
        }

        const prepared: PreparedQuote = {
          rfqId: rfq.id,
          chainId: saleChainId,
          instrumentName: params.instrumentName,
          expiry: params.expiry,
          strike: params.strike,
          amount: params.amount,
          quoteCount: status.quoteCount,
          premium: unitToNumber(BigInt(best.premium)),
          totalPremium: unitToNumber(BigInt(best.totalPremium)),
          acceptBy,
        };

        preparedRef.current = {
          params,
          best,
          rfqId: rfq.id,
          chainId: saleChainId,
          owner: saleOwner,
          acceptBy,
          addresses: saleAddresses,
        };
        setQuote(prepared);
        setPhase("quoted");
        armExpiryTimer(acceptBy);
        return prepared;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setPhase((current) => (current === "expired" ? "expired" : "error"));
        throw err;
      } finally {
        busyRef.current = false;
      }
    },
    [address, addresses, armExpiryTimer, chainId, clearExpiryTimer, phase],
  );

  const acceptQuote = useCallback(async (): Promise<SellResult> => {
    const prepared = preparedRef.current;
    if (!prepared) throw new Error("No executable quote is ready");
    if (!address || address.toLowerCase() !== prepared.owner.toLowerCase()) {
      throw new Error("Reconnect the wallet that requested this quote");
    }
    if (Date.now() >= prepared.acceptBy) {
      clearExpiryTimer();
      setPhase("expired");
      throw new Error("This quote has expired. Request a new quote.");
    }
    if (busyRef.current) throw new Error("Quote acceptance is already in progress");

    busyRef.current = true;
    setError(null);
    let submittedToEngine = false;
    try {
      setPhase("signing");
      await switchChainAsync({ chainId: prepared.chainId }).catch(() => {});
      const action = buildAction({
        subaccountId: prepared.params.subaccountId,
        module: prepared.addresses.rfqModule,
        data: encodeTakerOrder({
          orderHash: prepared.best.orderHash,
          maxFee: 0n,
        }),
        owner: prepared.owner,
        expiry: getActionExpiry(600),
      });
      const signature = await signTypedDataAsync(
        actionTypedData(action, prepared.chainId, prepared.addresses.matching),
      );
      if (Date.now() >= prepared.acceptBy) {
        clearExpiryTimer();
        setPhase("expired");
        throw new Error("This quote expired before it could be submitted.");
      }

      setPhase("executing");
      clearExpiryTimer();
      submittedToEngine = true;
      const accepted = await acceptRfq(
        prepared.rfqId,
        serializeAction(action),
        signature,
        prepared.chainId,
      );
      if (accepted.status !== "success") {
        throw new Error(`Trade reverted on-chain (tx ${accepted.txHash})`);
      }

      const sellResult: SellResult = {
        txHash: accepted.txHash,
        chainId: prepared.chainId,
        instrumentName: prepared.params.instrumentName,
        totalPremium: unitToNumber(BigInt(accepted.fill.totalPremium)),
        maker: accepted.fill.maker,
      };
      setResult(sellResult);
      setPhase("done");
      return sellResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      if (Date.now() >= prepared.acceptBy) {
        setPhase("expired");
      } else if (!submittedToEngine) {
        setPhase("quoted");
        armExpiryTimer(prepared.acceptBy);
      } else {
        setPhase("error");
      }
      throw err;
    } finally {
      busyRef.current = false;
    }
  }, [address, armExpiryTimer, clearExpiryTimer, signTypedDataAsync, switchChainAsync]);

  // Backwards-compatible helper for the legacy CoveredCallFlow component.
  const sell = useCallback(
    async (params: SellParams): Promise<SellResult> => {
      await requestQuote(params);
      return acceptQuote();
    },
    [acceptQuote, requestQuote],
  );

  return {
    requestQuote,
    acceptQuote,
    sell,
    reset,
    phase,
    auction,
    quote,
    result,
    error,
  };
}

/**
 * Defense-in-depth before displaying a quote: re-derive the order hash and
 * ensure the winning trade exactly matches the requested covered call.
 */
function verifyBestQuote(
  best: PublicBestQuote,
  params: SellParams,
  btcOptionAsset: Address,
): void {
  const trades = best.trades.map((trade) => ({
    asset: trade.asset as Address,
    subId: BigInt(trade.subId),
    price: BigInt(trade.price),
    amount: BigInt(trade.amount),
  }));

  const derived = hashRfqTrades(trades);
  if (derived !== best.orderHash) {
    throw new Error("Quote rejected: orderHash does not match quoted trades");
  }
  if (trades.length !== 1) {
    throw new Error("Quote rejected: expected exactly one trade leg");
  }
  const trade = trades[0];
  const expectedSubId = encodeOptionSubId({
    expiry: BigInt(params.expiry),
    strike: toUnit(params.strike),
    isCall: true,
  });
  if (trade.asset.toLowerCase() !== btcOptionAsset.toLowerCase()) {
    throw new Error("Quote rejected: wrong asset");
  }
  if (trade.subId !== expectedSubId) {
    throw new Error("Quote rejected: wrong instrument (subId mismatch)");
  }
  if (trade.amount !== toUnit(params.amount)) {
    throw new Error("Quote rejected: wrong amount");
  }
}
