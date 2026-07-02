"use client";

import { useCallback, useRef, useState } from "react";
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
import { useNetwork } from "./useNetwork";

export type SellPhase =
  | "idle"
  | "requesting" // POST /rfq
  | "auction" // quote-collection window running
  | "signing" // taker signs the TakerOrder EIP-712 Action
  | "executing" // engine submits verifyAndMatch
  | "done"
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

export interface SellResult {
  txHash: Hex;
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

const POLL_INTERVAL_MS = 750;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Sell a covered call through the RFQ auction:
 * 1. POST /rfq opens a short auction; makers stream signed quotes.
 * 2. Poll GET /rfq/:id during the window (live best quote shown in the UI).
 * 3. Verify the winning quote locally (orderHash re-derivation + instrument
 *    checks), sign the TakerOrder Action via wallet signTypedData.
 * 4. POST /rfq/:id/accept — the engine submits Matching.verifyAndMatch and
 *    returns the on-chain receipt summary.
 */
export function useSellCall() {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const { addresses, chainId } = useNetwork();

  const [phase, setPhase] = useState<SellPhase>("idle");
  const [auction, setAuction] = useState<AuctionState | null>(null);
  const [result, setResult] = useState<SellResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const reset = useCallback(() => {
    busyRef.current = false;
    setPhase("idle");
    setAuction(null);
    setResult(null);
    setError(null);
  }, []);

  const sell = useCallback(
    async (params: SellParams): Promise<SellResult> => {
      if (!address) throw new Error("Wallet not connected");
      if (busyRef.current) throw new Error("A sale is already in progress");
      busyRef.current = true;
      setError(null);
      setResult(null);

      try {
        // 1. Open the auction
        setPhase("requesting");
        const rfq = await createRfq({
          subaccountId: params.subaccountId,
          expiry: params.expiry,
          strike: params.strike.toString(),
          amount: params.amount,
        });

        // 2. Poll until the window closes
        setPhase("auction");
        let status: RfqStatusResponse;
        for (;;) {
          status = await getRfq(rfq.id);
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
          throw new Error(
            "No quotes received in the auction window — is a market maker (maker-bot) connected?"
          );
        }
        const best = status.bestQuote;

        verifyBestQuote(best, params, addresses.btcOptionAsset);

        // 3. Sign the TakerOrder Action with the wallet (EIP-712)
        setPhase("signing");
        await switchChainAsync({ chainId }).catch(() => {});
        const action = buildAction({
          subaccountId: params.subaccountId,
          module: addresses.rfqModule,
          data: encodeTakerOrder({ orderHash: best.orderHash, maxFee: 0n }),
          owner: address,
          expiry: getActionExpiry(600),
        });
        const signature = await signTypedDataAsync(
          actionTypedData(action, chainId, addresses.matching)
        );

        // 4. Accept — engine executes verifyAndMatch on-chain
        setPhase("executing");
        const accepted = await acceptRfq(rfq.id, serializeAction(action), signature);
        if (accepted.status !== "success") {
          throw new Error(`Trade reverted on-chain (tx ${accepted.txHash})`);
        }

        const sellResult: SellResult = {
          txHash: accepted.txHash,
          instrumentName: params.instrumentName,
          totalPremium: unitToNumber(BigInt(accepted.fill.totalPremium)),
          maker: accepted.fill.maker,
        };
        setResult(sellResult);
        setPhase("done");
        return sellResult;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setPhase("error");
        throw err;
      } finally {
        busyRef.current = false;
      }
    },
    [address, signTypedDataAsync, switchChainAsync, addresses, chainId]
  );

  return { sell, reset, phase, auction, result, error };
}

/**
 * Defense-in-depth before signing: re-derive the orderHash from the quoted
 * trades and check the trade matches the requested instrument exactly.
 */
function verifyBestQuote(
  best: PublicBestQuote,
  params: SellParams,
  btcOptionAsset: Address
): void {
  const trades = best.trades.map((t) => ({
    asset: t.asset as Address,
    subId: BigInt(t.subId),
    price: BigInt(t.price),
    amount: BigInt(t.amount),
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
