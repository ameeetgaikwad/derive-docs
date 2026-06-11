import type { Address, Hex } from "viem";
import {
  buildAction,
  decodeOptionSubId,
  encodeRfqOrder,
  getActionExpiry,
  hashRfqTrades,
  instrumentNameFromSubId,
  signAction,
  toUnit,
  type Action,
  type RfqTradeData,
  type TypedDataSigner,
} from "@sats-options/shared";
import { black76Price, yearsToExpiry } from "./black76.js";
import type { MarketInputs, PriceSource } from "./pricing.js";

export interface QuoteLeg {
  asset: Address;
  subId: bigint;
  /** int256 18dp, maker perspective (>0 maker receives/buys). */
  amount: bigint;
}

export interface PricedLeg extends QuoteLeg {
  instrument: string;
  inputs: MarketInputs;
  theo: number;
  /** Quoted unit price after spread, quote units. */
  unitPrice: number;
  /** uint256 18dp price for RfqOrder.trades[i].price. */
  price: bigint;
}

export interface SignedQuote {
  trades: RfqTradeData[];
  pricedLegs: PricedLeg[];
  orderHash: Hex;
  action: Action;
  signature: Hex;
  maxFee: bigint;
}

export interface QuoterParams {
  legs: QuoteLeg[];
  priceSource: PriceSource;
  /** bid = bidRatio * theo when maker buys; ask = askRatio * theo when maker sells. */
  bidRatio: number;
  askRatio: number;
  maxFee: bigint;
  subaccountId: bigint;
  owner: Address;
  signer: TypedDataSigner & { address: Address };
  chainId: number;
  matchingAddress: Address;
  rfqModuleAddress: Address;
  /** Action validity in seconds. */
  ttlSec: number;
  /**
   * Explicit action expiry (unix seconds) — overrides ttlSec. The engine
   * rejects quotes whose action expires before the auction window ends.
   */
  actionExpirySec?: bigint;
  nowMs?: number;
}

/** Float quote-price -> 18dp uint, floored at 0 (RfqModule price is uint). */
export function priceToUint18(price: number): bigint {
  if (!Number.isFinite(price)) throw new Error(`bad price ${price}`);
  const clamped = Math.max(price, 0);
  return toUnit(clamped.toFixed(18));
}

/**
 * Price every leg with Black-76, apply the configured spread, and build +
 * EIP-712-sign the maker's RfqModule Action ([actions[0]] in verifyAndMatch).
 */
export async function buildSignedQuote(params: QuoterParams): Promise<SignedQuote> {
  const now = params.nowMs ?? Date.now();
  const pricedLegs: PricedLeg[] = [];

  for (const leg of params.legs) {
    if (leg.amount === 0n) throw new Error("RFQ leg amount must be non-zero");
    const option = decodeOptionSubId(leg.subId);
    const T = yearsToExpiry(option.expiry, now);
    if (T <= 0) throw new Error(`option already expired: ${instrumentNameFromSubId(leg.subId)}`);

    const inputs = await params.priceSource.getInputs({
      expiry: option.expiry,
      strike: option.strike,
    });

    const theo = black76Price({
      forward: inputs.forward,
      strike: Number(option.strike) / 1e18,
      timeToExpiryYears: T,
      vol: inputs.vol,
      rate: inputs.rate,
      isCall: option.isCall,
    });

    // amount > 0: maker receives the option (maker BUYS) -> quote a bid.
    // amount < 0: maker delivers the option (maker SELLS) -> quote an ask.
    const ratio = leg.amount > 0n ? params.bidRatio : params.askRatio;
    const unitPrice = theo * ratio;

    pricedLegs.push({
      ...leg,
      instrument: instrumentNameFromSubId(leg.subId),
      inputs,
      theo,
      unitPrice,
      price: priceToUint18(unitPrice),
    });
  }

  const trades: RfqTradeData[] = pricedLegs.map((l) => ({
    asset: l.asset,
    subId: l.subId,
    price: l.price,
    amount: l.amount,
  }));

  const action = buildAction({
    subaccountId: params.subaccountId,
    module: params.rfqModuleAddress,
    data: encodeRfqOrder({ maxFee: params.maxFee, trades }),
    owner: params.owner,
    signer: params.signer.address,
    expiry: params.actionExpirySec ?? getActionExpiry(params.ttlSec),
  });

  const signature = await signAction({
    action,
    signer: params.signer,
    chainId: params.chainId,
    matchingAddress: params.matchingAddress,
  });

  return {
    trades,
    pricedLegs,
    orderHash: hashRfqTrades(trades),
    action,
    signature,
    maxFee: params.maxFee,
  };
}
