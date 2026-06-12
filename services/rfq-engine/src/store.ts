import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Address, Hex } from "viem";
import type { RfqTradeData } from "@hedge/shared";
import {
  parseAction,
  serializeAction,
  serializeTrade,
  type Quote,
  type Rfq,
  type RfqStatus,
  type SerializedAction,
  type SerializedTrade,
} from "./types.js";

/**
 * Storage boundary. Two implementations ship:
 *   - InMemoryRfqStore — default, used by tests and dev.
 *   - JsonlRfqStore    — durable append-only JSONL + in-memory index, enabled
 *                        via STORE_PATH; restart recovery + trade history.
 * Everything above this interface (auction engine, server, executor) is
 * storage-agnostic so a Redis/Postgres store can be dropped in later.
 */
export interface RfqStore {
  putRfq(rfq: Rfq): Promise<void>;
  getRfq(id: string): Promise<Rfq | null>;
  listOpenRfqs(): Promise<Rfq[]>;
  /** every RFQ ever stored — used for restart recovery and trade history */
  listRfqs(): Promise<Rfq[]>;
  putQuote(quote: Quote): Promise<void>;
  getQuote(id: string): Promise<Quote | null>;
  /** remove a quote (cancel / replace); no-op when absent */
  deleteQuote(id: string): Promise<void>;
  listQuotes(rfqId: string): Promise<Quote[]>;
}

export class InMemoryRfqStore implements RfqStore {
  protected readonly rfqs = new Map<string, Rfq>();
  protected readonly quotes = new Map<string, Quote>();
  protected readonly quotesByRfq = new Map<string, string[]>();

  async putRfq(rfq: Rfq): Promise<void> {
    this.rfqs.set(rfq.id, rfq);
  }

  async getRfq(id: string): Promise<Rfq | null> {
    return this.rfqs.get(id) ?? null;
  }

  async listOpenRfqs(): Promise<Rfq[]> {
    return [...this.rfqs.values()].filter((r) => r.status === "open");
  }

  async listRfqs(): Promise<Rfq[]> {
    return [...this.rfqs.values()];
  }

  async putQuote(quote: Quote): Promise<void> {
    if (!this.quotes.has(quote.id)) {
      const ids = this.quotesByRfq.get(quote.rfqId) ?? [];
      ids.push(quote.id);
      this.quotesByRfq.set(quote.rfqId, ids);
    }
    this.quotes.set(quote.id, quote);
  }

  async getQuote(id: string): Promise<Quote | null> {
    return this.quotes.get(id) ?? null;
  }

  async deleteQuote(id: string): Promise<void> {
    const quote = this.quotes.get(id);
    if (!quote) return;
    this.quotes.delete(id);
    const ids = this.quotesByRfq.get(quote.rfqId);
    if (ids) {
      this.quotesByRfq.set(
        quote.rfqId,
        ids.filter((qid) => qid !== id),
      );
    }
  }

  async listQuotes(rfqId: string): Promise<Quote[]> {
    const ids = this.quotesByRfq.get(rfqId) ?? [];
    return ids
      .map((id) => this.quotes.get(id))
      .filter((q): q is Quote => q !== undefined);
  }
}

// ---------------------------------------------------------------------------
// JSONL persistence — append-only log, replayed into the in-memory index on
// startup. Latest record per id wins; quote deletions are tombstoned. No
// native deps, single file, durable enough for v1 (fsync-on-append is left to
// the OS; the engine re-validates recovered state on boot).
// ---------------------------------------------------------------------------

interface StoredInstrument {
  currency: string;
  optionAsset: string;
  expiry: string;
  strike: string;
  isCall: boolean;
  subId: string;
  name: string;
}

interface StoredRfq {
  id: string;
  takerSubaccountId: string;
  instrument: StoredInstrument;
  amount: string;
  direction: "sell";
  createdAt: number;
  auctionEndsAt: number;
  acceptDeadlineAt: number | null;
  status: RfqStatus;
  bestQuoteId: string | null;
  execution: {
    txHash: Hex;
    status: "success" | "reverted";
    blockNumber: string | null;
    fill: {
      rfqId: string;
      quoteId: string;
      instrument: string;
      maker: string;
      makerSubaccountId: string;
      takerSubaccountId: string;
      amount: string;
      premium: string;
      totalPremium: string;
      makerFee: string;
      takerFee: string;
    };
  } | null;
  error: string | null;
}

interface StoredQuote {
  id: string;
  rfqId: string;
  maker: string;
  makerSubaccountId: string;
  premium: string;
  totalPremium: string;
  trades: SerializedTrade[];
  orderHash: Hex;
  action: SerializedAction;
  signature: Hex;
  receivedAt: number;
  reservedCash?: string;
}

type StoreRecord =
  | { k: "rfq"; v: StoredRfq }
  | { k: "quote"; v: StoredQuote }
  | { k: "quote_del"; id: string };

export function rfqToStored(rfq: Rfq): StoredRfq {
  return {
    id: rfq.id,
    takerSubaccountId: rfq.takerSubaccountId.toString(),
    instrument: {
      currency: rfq.instrument.currency,
      optionAsset: rfq.instrument.optionAsset,
      expiry: rfq.instrument.expiry.toString(),
      strike: rfq.instrument.strike.toString(),
      isCall: rfq.instrument.isCall,
      subId: rfq.instrument.subId.toString(),
      name: rfq.instrument.name,
    },
    amount: rfq.amount.toString(),
    direction: rfq.direction,
    createdAt: rfq.createdAt,
    auctionEndsAt: rfq.auctionEndsAt,
    acceptDeadlineAt: rfq.acceptDeadlineAt,
    status: rfq.status,
    bestQuoteId: rfq.bestQuoteId,
    execution: rfq.execution
      ? {
          txHash: rfq.execution.txHash,
          status: rfq.execution.status,
          blockNumber: rfq.execution.blockNumber?.toString() ?? null,
          fill: {
            rfqId: rfq.execution.fill.rfqId,
            quoteId: rfq.execution.fill.quoteId,
            instrument: rfq.execution.fill.instrument,
            maker: rfq.execution.fill.maker,
            makerSubaccountId: rfq.execution.fill.makerSubaccountId.toString(),
            takerSubaccountId: rfq.execution.fill.takerSubaccountId.toString(),
            amount: rfq.execution.fill.amount.toString(),
            premium: rfq.execution.fill.premium.toString(),
            totalPremium: rfq.execution.fill.totalPremium.toString(),
            makerFee: rfq.execution.fill.makerFee.toString(),
            takerFee: rfq.execution.fill.takerFee.toString(),
          },
        }
      : null,
    error: rfq.error,
  };
}

export function rfqFromStored(s: StoredRfq): Rfq {
  return {
    id: s.id,
    takerSubaccountId: BigInt(s.takerSubaccountId),
    instrument: {
      currency: s.instrument.currency,
      optionAsset: s.instrument.optionAsset as Address,
      expiry: BigInt(s.instrument.expiry),
      strike: BigInt(s.instrument.strike),
      isCall: s.instrument.isCall,
      subId: BigInt(s.instrument.subId),
      name: s.instrument.name,
    },
    amount: BigInt(s.amount),
    direction: s.direction,
    createdAt: s.createdAt,
    auctionEndsAt: s.auctionEndsAt,
    acceptDeadlineAt: s.acceptDeadlineAt ?? null,
    status: s.status,
    bestQuoteId: s.bestQuoteId,
    execution: s.execution
      ? {
          txHash: s.execution.txHash,
          status: s.execution.status,
          blockNumber: s.execution.blockNumber !== null ? BigInt(s.execution.blockNumber) : null,
          fill: {
            rfqId: s.execution.fill.rfqId,
            quoteId: s.execution.fill.quoteId,
            instrument: s.execution.fill.instrument,
            maker: s.execution.fill.maker as Address,
            makerSubaccountId: BigInt(s.execution.fill.makerSubaccountId),
            takerSubaccountId: BigInt(s.execution.fill.takerSubaccountId),
            amount: BigInt(s.execution.fill.amount),
            premium: BigInt(s.execution.fill.premium),
            totalPremium: BigInt(s.execution.fill.totalPremium),
            makerFee: BigInt(s.execution.fill.makerFee),
            takerFee: BigInt(s.execution.fill.takerFee),
          },
        }
      : null,
    error: s.error,
  };
}

export function quoteToStored(quote: Quote): StoredQuote {
  return {
    id: quote.id,
    rfqId: quote.rfqId,
    maker: quote.maker,
    makerSubaccountId: quote.makerSubaccountId.toString(),
    premium: quote.premium.toString(),
    totalPremium: quote.totalPremium.toString(),
    trades: quote.trades.map(serializeTrade),
    orderHash: quote.orderHash,
    action: serializeAction(quote.action),
    signature: quote.signature,
    receivedAt: quote.receivedAt,
    reservedCash: quote.reservedCash.toString(),
  };
}

export function quoteFromStored(s: StoredQuote): Quote {
  const trades: RfqTradeData[] = s.trades.map((t) => ({
    asset: t.asset as Address,
    subId: BigInt(t.subId),
    price: BigInt(t.price),
    amount: BigInt(t.amount),
  }));
  const totalPremium = BigInt(s.totalPremium);
  return {
    id: s.id,
    rfqId: s.rfqId,
    maker: s.maker as Address,
    makerSubaccountId: BigInt(s.makerSubaccountId),
    premium: BigInt(s.premium),
    totalPremium,
    trades,
    orderHash: s.orderHash,
    action: parseAction(s.action),
    signature: s.signature,
    receivedAt: s.receivedAt,
    // older records predate reservation tracking — fall back to the premium
    reservedCash: s.reservedCash !== undefined ? BigInt(s.reservedCash) : totalPremium,
  };
}

/**
 * Durable RfqStore: every mutation is appended (synchronously, preserving
 * order) to a JSONL file and applied to the inherited in-memory index. The
 * whole log is replayed on construction.
 */
export class JsonlRfqStore extends InMemoryRfqStore {
  constructor(private readonly path: string) {
    super();
    this.load();
  }

  private load(): void {
    const dir = dirname(this.path);
    if (dir) mkdirSync(dir, { recursive: true });
    if (!existsSync(this.path)) return;
    const lines = readFileSync(this.path, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let record: StoreRecord;
      try {
        record = JSON.parse(trimmed) as StoreRecord;
      } catch {
        // tolerate a torn final line from a crash mid-append
        continue;
      }
      if (record.k === "rfq") {
        this.rfqs.set(record.v.id, rfqFromStored(record.v));
      } else if (record.k === "quote") {
        const quote = quoteFromStored(record.v);
        if (!this.quotes.has(quote.id)) {
          const ids = this.quotesByRfq.get(quote.rfqId) ?? [];
          ids.push(quote.id);
          this.quotesByRfq.set(quote.rfqId, ids);
        }
        this.quotes.set(quote.id, quote);
      } else if (record.k === "quote_del") {
        const quote = this.quotes.get(record.id);
        if (quote) {
          this.quotes.delete(record.id);
          const ids = this.quotesByRfq.get(quote.rfqId);
          if (ids) {
            this.quotesByRfq.set(
              quote.rfqId,
              ids.filter((qid) => qid !== record.id),
            );
          }
        }
      }
    }
  }

  private append(record: StoreRecord): void {
    appendFileSync(this.path, `${JSON.stringify(record)}\n`, "utf8");
  }

  override async putRfq(rfq: Rfq): Promise<void> {
    this.append({ k: "rfq", v: rfqToStored(rfq) });
    await super.putRfq(rfq);
  }

  override async putQuote(quote: Quote): Promise<void> {
    this.append({ k: "quote", v: quoteToStored(quote) });
    await super.putQuote(quote);
  }

  override async deleteQuote(id: string): Promise<void> {
    if (!this.quotes.has(id)) return;
    this.append({ k: "quote_del", id });
    await super.deleteQuote(id);
  }
}
