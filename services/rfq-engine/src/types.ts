import type { Address, Hex } from "viem";
import type { Action, RfqTradeData } from "@hedge/shared";

// ---------------------------------------------------------------------------
// Domain types (internal — bigints everywhere, 18dp protocol units)
// ---------------------------------------------------------------------------

export interface Instrument {
  /** e.g. "BTC" */
  currency: string;
  /** OptionAsset contract address for this currency */
  optionAsset: Address;
  /** unix seconds */
  expiry: bigint;
  /** 18dp */
  strike: bigint;
  isCall: boolean;
  /** lyra-utils OptionEncoding subId */
  subId: bigint;
  /** e.g. "BTC-20260617-110000-C" */
  name: string;
}

/** v1: takers only SELL options (covered calls) to makers. */
export type RfqDirection = "sell";

export type RfqStatus =
  | "open" // auction window running, makers may quote
  | "closed" // window over, best quote selected, awaiting taker accept
  | "expired" // window over with zero valid quotes
  | "executing" // accept received, tx in flight
  | "executed" // verifyAndMatch mined successfully
  | "failed"; // execution reverted / errored

export interface Rfq {
  id: string;
  takerSubaccountId: bigint;
  instrument: Instrument;
  /** 18dp, > 0 */
  amount: bigint;
  direction: RfqDirection;
  /** ms epoch */
  createdAt: number;
  /** ms epoch — quotes accepted strictly before this */
  auctionEndsAt: number;
  /**
   * ms epoch — set when the auction closes with a winner; the taker must
   * accept strictly before this or the RFQ expires and the maker is released.
   */
  acceptDeadlineAt: number | null;
  status: RfqStatus;
  bestQuoteId: string | null;
  execution: ExecutionResult | null;
  /**
   * Durable, non-secret identity for an accepted execution. Written before
   * broadcast and retained for crash recovery. It contains hashes rather than
   * the maker/taker signatures embedded in submitted calldata.
   */
  executionIntent?: RfqExecutionIntent | null;
  /** Terminal failure/expiry reason, or reconciliation warning while executing. */
  error: string | null;
}

export interface Quote {
  id: string;
  rfqId: string;
  /** authenticated maker EOA (== action.owner) */
  maker: Address;
  makerSubaccountId: bigint;
  /** per-unit premium, 18dp (== trades[0].price) */
  premium: bigint;
  /** premium * amount / 1e18 — total cash maker pays taker */
  totalPremium: bigint;
  trades: RfqTradeData[];
  /** keccak256(abi.encode(trades)) — what the taker signs over */
  orderHash: Hex;
  /** the maker's full signed Action targeting RfqModule */
  action: Action;
  signature: Hex;
  receivedAt: number;
  /**
   * 18dp cash reserved against the maker subaccount while this quote is live:
   * totalPremium + signed maxFee + estimated SRM OI fee.
   */
  reservedCash: bigint;
}

export interface ExecutionResult {
  txHash: Hex;
  status: "success" | "reverted";
  blockNumber: bigint | null;
  fill: FillSummary;
}

export interface RfqActionIdentity {
  subaccountId: bigint;
  nonce: bigint;
  module: Address;
  expiry: bigint;
  owner: Address;
  signer: Address;
  /** keccak256(Action.data), binding data without logging it. */
  dataHash: Hex;
}

export interface RfqExecutionIntent {
  actions: [RfqActionIdentity, RfqActionIdentity];
  /** keccak256 of the exact Matching.verifyAndMatch calldata. */
  calldataHash: Hex;
  /** Inclusive chain block anchor captured before the intent is persisted. */
  fromBlock: bigint;
  /** Filled by the submitter callback before receipt waiting. */
  txHash: Hex | null;
  fill: FillSummary;
}

export interface FillSummary {
  rfqId: string;
  quoteId: string;
  instrument: string;
  maker: Address;
  makerSubaccountId: bigint;
  takerSubaccountId: bigint;
  /** 18dp option amount transferred taker -> maker */
  amount: bigint;
  /** 18dp per-unit premium */
  premium: bigint;
  /** 18dp cash transferred maker -> taker */
  totalPremium: bigint;
  makerFee: bigint;
  takerFee: bigint;
}

// ---------------------------------------------------------------------------
// Wire types (JSON-safe — bigints as decimal strings)
// ---------------------------------------------------------------------------

export interface SerializedAction {
  subaccountId: string;
  nonce: string;
  module: string;
  data: string;
  expiry: string;
  owner: string;
  signer: string;
}

export interface SerializedTrade {
  asset: string;
  subId: string;
  price: string;
  amount: string;
}

/** Taker-supplied instrument spec on POST /rfq. */
export interface InstrumentSpec {
  /** currency, e.g. "BTC" */
  asset: string;
  /** unix seconds */
  expiry: number | string;
  /** human decimal, e.g. "110000" */
  strike: string | number;
  isCall: boolean;
}

export interface CreateRfqRequest {
  subaccountId: string | number;
  instrument: InstrumentSpec;
  /** human decimal option amount, e.g. "1" or "0.5" */
  amount: string | number;
  direction: RfqDirection;
}

export interface AcceptRfqRequest {
  action: SerializedAction;
  signature: string;
}

/** RFQ view broadcast to makers / returned to takers. */
export interface PublicRfq {
  id: string;
  takerSubaccountId: string;
  direction: RfqDirection;
  instrument: {
    name: string;
    currency: string;
    optionAsset: string;
    expiry: string;
    /** 18dp string */
    strike: string;
    isCall: boolean;
    subId: string;
  };
  /** 18dp string */
  amount: string;
  createdAt: number;
  auctionEndsAt: number;
  /** ms epoch taker-accept deadline; null until the auction closes with a winner */
  acceptDeadlineAt: number | null;
  status: RfqStatus;
}

/** Fill report attached to rfq_executed (all 18dp decimal strings). */
export interface WireFill {
  quoteId: string;
  instrument: string;
  maker: string;
  makerSubaccountId: string;
  takerSubaccountId: string;
  amount: string;
  /** per-unit premium */
  premium: string;
  /** realized cash maker -> taker */
  totalPremium: string;
  makerFee: string;
  takerFee: string;
  blockNumber: string | null;
}

export interface PublicBestQuote {
  quoteId: string;
  maker: string;
  makerSubaccountId: string;
  /** 18dp per-unit premium */
  premium: string;
  /** 18dp total cash to taker */
  totalPremium: string;
  /** sign this in the TakerOrder to accept */
  orderHash: Hex;
  trades: SerializedTrade[];
  /** maker action expiry (unix seconds) — accept before this */
  actionExpiry: string;
}

export interface RfqStatusResponse {
  rfq: PublicRfq;
  quoteCount: number;
  bestQuote: PublicBestQuote | null;
  execution: {
    txHash: Hex;
    status: "success" | "reverted";
    blockNumber: string | null;
  } | null;
  error: string | null;
}

// Maker WS protocol (server -> maker)
export type MakerServerMessage =
  | { type: "auth_challenge"; challenge: string }
  | { type: "auth_ok"; address: string }
  | { type: "rfq_open"; rfq: PublicRfq }
  | {
      type: "rfq_closed";
      rfqId: string;
      bestQuoteId: string | null;
      /** set on the winning maker's socket only */
      won?: boolean;
      /** ms epoch taker-accept deadline; sent on the winning maker's socket only */
      acceptDeadlineAt?: number;
    }
  | { type: "rfq_executed"; rfqId: string; txHash: Hex; fill: WireFill }
  | { type: "rfq_failed"; rfqId: string; reason: string }
  | { type: "rfq_expired"; rfqId: string; reason: string }
  | { type: "quote_ack"; rfqId: string; quoteId: string; replacedQuoteId?: string }
  | { type: "quote_rejected"; rfqId: string; reason: string }
  | { type: "cancel_ack"; rfqId: string; quoteId: string }
  | { type: "cancel_rejected"; quoteId: string; reason: string }
  | { type: "superseded"; message: string }
  | { type: "error"; message: string };

// Maker WS protocol (maker -> server)
export type MakerClientMessage =
  | { type: "auth"; address: string; signature: string }
  | { type: "quote"; rfqId: string; action: SerializedAction; signature: string }
  | { type: "cancel"; quoteId: string };

// Taker WS protocol
export type TakerClientMessage =
  | { type: "create_rfq"; request: CreateRfqRequest }
  | { type: "subscribe"; rfqId: string };

export type TakerServerMessage =
  | { type: "rfq_created"; rfq: PublicRfq }
  | { type: "rfq_update"; update: RfqStatusResponse }
  | { type: "error"; message: string };

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HEX_RE = /^0x([0-9a-fA-F]{2})*$/;

export function asAddress(value: unknown, label: string): Address {
  if (typeof value !== "string" || !ADDRESS_RE.test(value)) {
    throw new Error(`${label}: expected 0x-address, got ${String(value)}`);
  }
  return value as Address;
}

export function asHex(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !HEX_RE.test(value)) {
    throw new Error(`${label}: expected 0x-hex, got ${String(value)}`);
  }
  return value as Hex;
}

export function asBigInt(value: unknown, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  throw new Error(`${label}: expected integer, got ${String(value)}`);
}

export function addressEq(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function serializeAction(action: Action): SerializedAction {
  return {
    subaccountId: action.subaccountId.toString(),
    nonce: action.nonce.toString(),
    module: action.module,
    data: action.data,
    expiry: action.expiry.toString(),
    owner: action.owner,
    signer: action.signer,
  };
}

export function parseAction(raw: unknown): Action {
  if (typeof raw !== "object" || raw === null) throw new Error("action: expected object");
  const a = raw as Record<string, unknown>;
  return {
    subaccountId: asBigInt(a.subaccountId, "action.subaccountId"),
    nonce: asBigInt(a.nonce, "action.nonce"),
    module: asAddress(a.module, "action.module"),
    data: asHex(a.data, "action.data"),
    expiry: asBigInt(a.expiry, "action.expiry"),
    owner: asAddress(a.owner, "action.owner"),
    signer: asAddress(a.signer, "action.signer"),
  };
}

export function serializeTrade(trade: RfqTradeData): SerializedTrade {
  return {
    asset: trade.asset,
    subId: trade.subId.toString(),
    price: trade.price.toString(),
    amount: trade.amount.toString(),
  };
}

export function publicRfq(rfq: Rfq): PublicRfq {
  return {
    id: rfq.id,
    takerSubaccountId: rfq.takerSubaccountId.toString(),
    direction: rfq.direction,
    instrument: {
      name: rfq.instrument.name,
      currency: rfq.instrument.currency,
      optionAsset: rfq.instrument.optionAsset,
      expiry: rfq.instrument.expiry.toString(),
      strike: rfq.instrument.strike.toString(),
      isCall: rfq.instrument.isCall,
      subId: rfq.instrument.subId.toString(),
    },
    amount: rfq.amount.toString(),
    createdAt: rfq.createdAt,
    auctionEndsAt: rfq.auctionEndsAt,
    acceptDeadlineAt: rfq.acceptDeadlineAt,
    status: rfq.status,
  };
}

export function wireFill(fill: FillSummary, blockNumber: bigint | null): WireFill {
  return {
    quoteId: fill.quoteId,
    instrument: fill.instrument,
    maker: fill.maker,
    makerSubaccountId: fill.makerSubaccountId.toString(),
    takerSubaccountId: fill.takerSubaccountId.toString(),
    amount: fill.amount.toString(),
    premium: fill.premium.toString(),
    totalPremium: fill.totalPremium.toString(),
    makerFee: fill.makerFee.toString(),
    takerFee: fill.takerFee.toString(),
    blockNumber: blockNumber?.toString() ?? null,
  };
}

export function publicBestQuote(quote: Quote): PublicBestQuote {
  return {
    quoteId: quote.id,
    maker: quote.maker,
    makerSubaccountId: quote.makerSubaccountId.toString(),
    premium: quote.premium.toString(),
    totalPremium: quote.totalPremium.toString(),
    orderHash: quote.orderHash,
    trades: quote.trades.map(serializeTrade),
    actionExpiry: quote.action.expiry.toString(),
  };
}
