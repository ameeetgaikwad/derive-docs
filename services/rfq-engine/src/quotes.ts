import { decodeAbiParameters, recoverTypedDataAddress, type Address, type Hex } from "viem";
import {
  ACTION_TYPES,
  MATCHING_DOMAIN_NAME,
  MATCHING_DOMAIN_VERSION,
  hashRfqTrades,
  type Action,
  type RfqOrder,
  type RfqTradeData,
  type TakerOrder,
} from "@hedge/shared";
import type { ChainReader } from "./chain.js";
import { addressEq, type Quote, type Rfq } from "./types.js";

const ONE = 10n ** 18n;

export class QuoteValidationError extends Error {}

// ---------------------------------------------------------------------------
// abi.decode counterparts of the shared encoders, mirroring the structs the
// module decodes in RfqModule.executeAction:
//   RfqOrder  { uint maxFee; TradeData[] trades }   (maker action data)
//   TakerOrder{ bytes32 orderHash; uint maxFee }    (taker action data)
// ---------------------------------------------------------------------------

const TRADE_DATA_COMPONENTS = [
  { name: "asset", type: "address" },
  { name: "subId", type: "uint256" },
  { name: "price", type: "uint256" },
  { name: "amount", type: "int256" },
] as const;

export function decodeRfqOrderData(data: Hex): RfqOrder {
  const [decoded] = decodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "maxFee", type: "uint256" },
          { name: "trades", type: "tuple[]", components: [...TRADE_DATA_COMPONENTS] },
        ],
      },
    ],
    data,
  );
  return {
    maxFee: decoded.maxFee,
    trades: decoded.trades.map((t) => ({
      asset: t.asset,
      subId: t.subId,
      price: t.price,
      amount: t.amount,
    })),
  };
}

export function decodeTakerOrderData(data: Hex): TakerOrder {
  const [decoded] = decodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "orderHash", type: "bytes32" },
          { name: "maxFee", type: "uint256" },
        ],
      },
    ],
    data,
  );
  return { orderHash: decoded.orderHash, maxFee: decoded.maxFee };
}

/** Recover the EIP-712 signer of an Action (Matching domain) and compare. */
export async function verifyActionSignature(params: {
  action: Action;
  signature: Hex;
  chainId: number;
  matching: Address;
}): Promise<boolean> {
  const recovered = await recoverTypedDataAddress({
    domain: {
      name: MATCHING_DOMAIN_NAME,
      version: MATCHING_DOMAIN_VERSION,
      chainId: params.chainId,
      verifyingContract: params.matching,
    },
    types: ACTION_TYPES,
    primaryType: "Action",
    message: params.action,
    signature: params.signature,
  }).catch(() => null);
  return recovered !== null && addressEq(recovered, params.action.signer);
}

export interface QuoteValidationContext {
  chainId: number;
  matching: Address;
  rfqModule: Address;
  chainReader: ChainReader;
  /** unix ms clock, injectable for tests */
  now?: () => number;
  /**
   * Forward feed for the RFQ instrument's currency — used to estimate the SRM
   * OI fee. When absent the OI fee is treated as 0 (e.g. unit fixtures).
   */
  forwardFeed?: Address | null;
  /**
   * 18dp cash already reserved against the maker subaccount by other live
   * quotes (open auctions + won-awaiting-accept). Default 0.
   */
  reservedCash?: bigint;
}

/**
 * Estimate the SRM open-interest fee for a single option trade exactly the way
 * the chain computes it (StandardManager._chargeAllOIFee ->
 * BasePortfolioViewer.getAssetOIFee):
 *
 *   fee = |amount| * forwardPrice / 1e18 * OIFeeRateBPS[asset] / 1e18
 *   fee = max(fee, minOIFee) when fee > 0
 *
 * Conservative: assumes OI increases (the on-chain fee is 0 when it doesn't).
 * All inputs are read live — OIFeeRateBPS is governance-settable.
 */
export async function estimateOIFee(params: {
  chainReader: ChainReader;
  optionAsset: Address;
  forwardFeed: Address;
  expiry: bigint;
  amount: bigint;
}): Promise<bigint> {
  const rate = await params.chainReader.getOIFeeRateBPS(params.optionAsset);
  if (rate === 0n) return 0n;
  const forwardPrice = await params.chainReader.getForwardPrice(params.forwardFeed, params.expiry);
  const abs = params.amount < 0n ? -params.amount : params.amount;
  let fee = (((abs * forwardPrice) / ONE) * rate) / ONE;
  if (fee > 0n) {
    const minOIFee = await params.chainReader.getMinOIFee();
    if (fee < minOIFee) fee = minOIFee;
  }
  return fee;
}

/**
 * Validate a maker quote (a signed Action targeting RfqModule) against an
 * open RFQ. Checks, in order:
 *   1. auction still open
 *   2. action targets RfqModule; owner is the authenticated maker; v1 EOA
 *      signing (signer == owner); action not expired and valid through the
 *      auction window
 *   3. data decodes to an RfqOrder with exactly one trade matching the RFQ
 *      instrument: same OptionAsset, same subId, amount == +rfq.amount
 *      (taker sells -> maker receives), price > 0
 *   4. EIP-712 signature recovers to action.signer
 *   5. on-chain: maker subaccount is deposited into Matching under the maker
 *      address, and maker cash balance covers totalPremium + maxFee
 *
 * Returns the parsed Quote (not yet stored).
 */
export async function validateQuote(params: {
  rfq: Rfq;
  maker: Address;
  action: Action;
  signature: Hex;
  ctx: QuoteValidationContext;
}): Promise<Quote> {
  const { rfq, maker, action, signature, ctx } = params;
  const now = ctx.now ?? Date.now;

  // 1. auction window
  if (rfq.status !== "open") throw new QuoteValidationError(`rfq ${rfq.id} is ${rfq.status}`);
  if (now() >= rfq.auctionEndsAt) throw new QuoteValidationError("auction window closed");

  // 2. action shape
  if (!addressEq(action.module, ctx.rfqModule)) {
    throw new QuoteValidationError(`action.module must be RfqModule ${ctx.rfqModule}`);
  }
  if (!addressEq(action.owner, maker)) {
    throw new QuoteValidationError("action.owner must be the authenticated maker address");
  }
  if (!addressEq(action.signer, action.owner)) {
    throw new QuoteValidationError("v1 requires signer == owner (no session keys)");
  }
  if (action.subaccountId <= 0n) {
    throw new QuoteValidationError("action.subaccountId must be non-zero");
  }
  const nowSec = BigInt(Math.floor(now() / 1000));
  const auctionEndSec = BigInt(Math.ceil(rfq.auctionEndsAt / 1000));
  if (action.expiry <= nowSec) throw new QuoteValidationError("action expired");
  if (action.expiry < auctionEndSec) {
    throw new QuoteValidationError("action.expiry must outlive the auction window");
  }

  // 3. order data
  let order: RfqOrder;
  try {
    order = decodeRfqOrderData(action.data);
  } catch {
    throw new QuoteValidationError("action.data does not decode as RfqOrder");
  }
  if (order.trades.length !== 1) {
    throw new QuoteValidationError("quote must contain exactly one trade");
  }
  const trade = order.trades[0] as RfqTradeData;
  if (!addressEq(trade.asset, rfq.instrument.optionAsset)) {
    throw new QuoteValidationError(
      `trade.asset ${trade.asset} != instrument optionAsset ${rfq.instrument.optionAsset}`,
    );
  }
  if (trade.subId !== rfq.instrument.subId) {
    throw new QuoteValidationError(
      `trade.subId ${trade.subId} != instrument subId ${rfq.instrument.subId}`,
    );
  }
  // direction "sell": maker receives the option => positive amount == rfq.amount
  if (trade.amount !== rfq.amount) {
    throw new QuoteValidationError(
      `trade.amount ${trade.amount} != rfq amount ${rfq.amount} (maker must receive what the taker sells)`,
    );
  }
  if (trade.price <= 0n) throw new QuoteValidationError("premium must be > 0");

  // 4. signature
  const sigOk = await verifyActionSignature({
    action,
    signature,
    chainId: ctx.chainId,
    matching: ctx.matching,
  });
  if (!sigOk) throw new QuoteValidationError("invalid EIP-712 signature");

  // 5. on-chain checks
  const owner = await ctx.chainReader.getMatchingSubaccountOwner(action.subaccountId);
  if (!addressEq(owner, maker)) {
    throw new QuoteValidationError(
      `subaccount ${action.subaccountId} is not deposited into Matching by ${maker}`,
    );
  }
  // RfqModule cash leg: maker pays price * amount / 1e18, plus the matching
  // fee (capped by the signed maxFee) plus the SRM OI fee (charged by the
  // manager on OI-increasing trades — estimated live, never hardcoded).
  const totalPremium = (trade.price * trade.amount) / ONE;
  let oiFee = 0n;
  if (ctx.forwardFeed) {
    try {
      oiFee = await estimateOIFee({
        chainReader: ctx.chainReader,
        optionAsset: rfq.instrument.optionAsset,
        forwardFeed: ctx.forwardFeed,
        expiry: rfq.instrument.expiry,
        amount: trade.amount,
      });
    } catch (err) {
      throw new QuoteValidationError(
        `cannot estimate SRM OI fee (forward feed ${ctx.forwardFeed}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  const required = totalPremium + order.maxFee + oiFee;
  const reserved = ctx.reservedCash ?? 0n;
  const cash = await ctx.chainReader.getCashBalance(action.subaccountId);
  if (cash < reserved + required) {
    throw new QuoteValidationError(
      `insufficient maker cash: balance ${cash} < required ${required}` +
        ` (incl. OI fee ${oiFee})` +
        (reserved > 0n ? ` + reserved ${reserved} across open quotes` : ""),
    );
  }

  return {
    id: crypto.randomUUID(),
    rfqId: rfq.id,
    maker,
    makerSubaccountId: action.subaccountId,
    premium: trade.price,
    totalPremium,
    trades: order.trades,
    orderHash: hashRfqTrades(order.trades),
    action,
    signature,
    receivedAt: now(),
    reservedCash: required,
  };
}

/**
 * Validate the taker's accept Action against the winning quote. Mirrors the
 * checks RfqModule.executeAction will enforce on-chain (RFQM_InvalidTakerHash,
 * RFQM_SignedAccountMismatch, OV_ActionExpired, OV_InvalidSignature) so we
 * fail fast off-chain.
 */
export async function validateTakerAccept(params: {
  rfq: Rfq;
  quote: Quote;
  action: Action;
  signature: Hex;
  ctx: QuoteValidationContext;
}): Promise<TakerOrder> {
  const { rfq, quote, action, signature, ctx } = params;
  const now = ctx.now ?? Date.now;
  const nowSec = BigInt(Math.floor(now() / 1000));

  if (!addressEq(action.module, ctx.rfqModule)) {
    throw new QuoteValidationError(`action.module must be RfqModule ${ctx.rfqModule}`);
  }
  if (action.subaccountId !== rfq.takerSubaccountId) {
    throw new QuoteValidationError(
      `action.subaccountId ${action.subaccountId} != rfq taker subaccount ${rfq.takerSubaccountId}`,
    );
  }
  if (!addressEq(action.signer, action.owner)) {
    throw new QuoteValidationError("v1 requires signer == owner (no session keys)");
  }
  if (action.expiry <= nowSec) throw new QuoteValidationError("taker action expired");
  if (quote.action.expiry <= nowSec) {
    throw new QuoteValidationError("winning maker quote has expired");
  }

  let order: TakerOrder;
  try {
    order = decodeTakerOrderData(action.data);
  } catch {
    throw new QuoteValidationError("action.data does not decode as TakerOrder");
  }
  if (order.orderHash !== quote.orderHash) {
    throw new QuoteValidationError(
      `orderHash mismatch: signed ${order.orderHash}, winning quote ${quote.orderHash}`,
    );
  }

  const sigOk = await verifyActionSignature({
    action,
    signature,
    chainId: ctx.chainId,
    matching: ctx.matching,
  });
  if (!sigOk) throw new QuoteValidationError("invalid EIP-712 signature");

  const owner = await ctx.chainReader.getMatchingSubaccountOwner(action.subaccountId);
  if (!addressEq(owner, action.owner)) {
    throw new QuoteValidationError(
      `taker subaccount ${action.subaccountId} is not deposited into Matching by ${action.owner}`,
    );
  }

  return order;
}
