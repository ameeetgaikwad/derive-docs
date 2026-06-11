import { EventEmitter } from "node:events";
import type { Address, Hex } from "viem";
import { encodeOptionSubId, instrumentName, toUnit, type Action } from "@sats-options/shared";
import type { ChainReader } from "./chain.js";
import { QuoteValidationError, validateQuote, validateTakerAccept } from "./quotes.js";
import type { RfqStore } from "./store.js";
import {
  asBigInt,
  type CreateRfqRequest,
  type Instrument,
  type Quote,
  type Rfq,
} from "./types.js";
import { buildRfqExecution, type Executor } from "./executor.js";
import type { ExecutionResult } from "./types.js";

export interface AuctionEvents {
  rfq_open: [rfq: Rfq];
  rfq_closed: [rfq: Rfq, bestQuote: Quote | null];
  rfq_executed: [rfq: Rfq, result: ExecutionResult];
  rfq_failed: [rfq: Rfq, error: string];
}

export interface AuctionEngineOptions {
  store: RfqStore;
  chainReader: ChainReader;
  executor: Executor;
  chainId: number;
  matching: Address;
  rfqModule: Address;
  optionAssets: Record<string, Address>;
  auctionWindowMs: number;
  now?: () => number;
}

/**
 * The auction core: opens RFQs, validates and collects maker quotes during
 * the window, selects the best (highest premium — the taker is selling), and
 * executes accepted RFQs through the on-chain executor.
 *
 * Transport-agnostic: the WS/REST server subscribes to its events.
 */
export class AuctionEngine extends EventEmitter<AuctionEvents> {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly now: () => number;

  constructor(private readonly opts: AuctionEngineOptions) {
    super();
    this.now = opts.now ?? Date.now;
  }

  resolveInstrument(spec: CreateRfqRequest["instrument"]): Instrument {
    const currency = String(spec.asset ?? "").toUpperCase();
    const optionAsset = this.opts.optionAssets[currency];
    if (!optionAsset) {
      throw new Error(
        `unknown asset "${spec.asset}" (supported: ${Object.keys(this.opts.optionAssets).join(", ")})`,
      );
    }
    const expiry = asBigInt(spec.expiry, "instrument.expiry");
    if (expiry <= BigInt(Math.floor(this.now() / 1000))) {
      throw new Error("instrument.expiry must be in the future");
    }
    if (typeof spec.isCall !== "boolean") throw new Error("instrument.isCall must be boolean");
    const strike = toUnit(String(spec.strike));
    if (strike <= 0n) throw new Error("instrument.strike must be > 0");
    const subId = encodeOptionSubId({ expiry, strike, isCall: spec.isCall });
    return {
      currency,
      optionAsset,
      expiry,
      strike,
      isCall: spec.isCall,
      subId,
      name: instrumentName({ currency, expiry, strike, isCall: spec.isCall }),
    };
  }

  async openRfq(request: CreateRfqRequest): Promise<Rfq> {
    if (request.direction !== "sell") {
      throw new Error('v1 supports direction "sell" only (covered calls sold to makers)');
    }
    const takerSubaccountId = asBigInt(request.subaccountId, "subaccountId");
    if (takerSubaccountId <= 0n) throw new Error("subaccountId must be non-zero");
    const amount = toUnit(String(request.amount));
    if (amount <= 0n) throw new Error("amount must be > 0");
    const instrument = this.resolveInstrument(request.instrument);

    const createdAt = this.now();
    const rfq: Rfq = {
      id: crypto.randomUUID(),
      takerSubaccountId,
      instrument,
      amount,
      direction: "sell",
      createdAt,
      auctionEndsAt: createdAt + this.opts.auctionWindowMs,
      status: "open",
      bestQuoteId: null,
      execution: null,
      error: null,
    };
    await this.opts.store.putRfq(rfq);

    const timer = setTimeout(() => {
      this.closeAuction(rfq.id).catch((err) => {
        // eslint-disable-next-line no-console
        console.error(`closeAuction(${rfq.id}) failed:`, err);
      });
    }, this.opts.auctionWindowMs);
    this.timers.set(rfq.id, timer);

    this.emit("rfq_open", rfq);
    return rfq;
  }

  async getRfq(id: string): Promise<Rfq | null> {
    return this.opts.store.getRfq(id);
  }

  async listOpenRfqs(): Promise<Rfq[]> {
    return this.opts.store.listOpenRfqs();
  }

  async listQuotes(rfqId: string): Promise<Quote[]> {
    return this.opts.store.listQuotes(rfqId);
  }

  async getBestQuote(rfq: Rfq): Promise<Quote | null> {
    if (rfq.bestQuoteId) return this.opts.store.getQuote(rfq.bestQuoteId);
    const quotes = await this.opts.store.listQuotes(rfq.id);
    return selectBestQuote(quotes);
  }

  /**
   * Validate and admit a maker quote into an open auction.
   * Throws QuoteValidationError with a maker-friendly reason on rejection.
   */
  async submitQuote(params: {
    rfqId: string;
    maker: Address;
    action: Action;
    signature: Hex;
  }): Promise<Quote> {
    const rfq = await this.opts.store.getRfq(params.rfqId);
    if (!rfq) throw new QuoteValidationError(`unknown rfq ${params.rfqId}`);
    const quote = await validateQuote({
      rfq,
      maker: params.maker,
      action: params.action,
      signature: params.signature,
      ctx: this.validationCtx(),
    });
    // Re-check the window: validation does chain reads and may straddle close.
    const fresh = await this.opts.store.getRfq(params.rfqId);
    if (!fresh || fresh.status !== "open" || this.now() >= fresh.auctionEndsAt) {
      throw new QuoteValidationError("auction window closed");
    }
    await this.opts.store.putQuote(quote);
    return quote;
  }

  async closeAuction(rfqId: string): Promise<void> {
    const timer = this.timers.get(rfqId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(rfqId);
    }
    const rfq = await this.opts.store.getRfq(rfqId);
    if (!rfq || rfq.status !== "open") return;

    const quotes = await this.opts.store.listQuotes(rfqId);
    const best = selectBestQuote(quotes);
    rfq.status = best ? "closed" : "expired";
    rfq.bestQuoteId = best?.id ?? null;
    await this.opts.store.putRfq(rfq);
    this.emit("rfq_closed", rfq, best);
  }

  /**
   * Taker accepts the winning quote with their signed EIP-712 Action.
   * Builds the RfqModule action pair and submits Matching.verifyAndMatch.
   */
  async acceptRfq(params: {
    rfqId: string;
    action: Action;
    signature: Hex;
  }): Promise<ExecutionResult> {
    const rfq = await this.opts.store.getRfq(params.rfqId);
    if (!rfq) throw new QuoteValidationError(`unknown rfq ${params.rfqId}`);
    if (rfq.status === "open") {
      throw new QuoteValidationError("auction still open — wait for the window to close");
    }
    if (rfq.status !== "closed") {
      throw new QuoteValidationError(`rfq is ${rfq.status}, cannot accept`);
    }
    const quote = rfq.bestQuoteId ? await this.opts.store.getQuote(rfq.bestQuoteId) : null;
    if (!quote) throw new QuoteValidationError("no winning quote to accept");

    await validateTakerAccept({
      rfq,
      quote,
      action: params.action,
      signature: params.signature,
      ctx: this.validationCtx(),
    });

    const plan = buildRfqExecution({
      rfq,
      quote,
      takerAction: params.action,
      takerSignature: params.signature,
    });

    rfq.status = "executing";
    await this.opts.store.putRfq(rfq);
    try {
      const result = await this.opts.executor.execute(plan);
      rfq.status = result.status === "success" ? "executed" : "failed";
      rfq.execution = result;
      rfq.error = result.status === "success" ? null : "verifyAndMatch reverted";
      await this.opts.store.putRfq(rfq);
      if (result.status === "success") {
        this.emit("rfq_executed", rfq, result);
      } else {
        this.emit("rfq_failed", rfq, rfq.error ?? "reverted");
      }
      return result;
    } catch (err) {
      rfq.status = "failed";
      rfq.error = err instanceof Error ? err.message : String(err);
      await this.opts.store.putRfq(rfq);
      this.emit("rfq_failed", rfq, rfq.error);
      throw err;
    }
  }

  /** Clear all pending auction timers (for shutdown). */
  stop(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private validationCtx() {
    return {
      chainId: this.opts.chainId,
      matching: this.opts.matching,
      rfqModule: this.opts.rfqModule,
      chainReader: this.opts.chainReader,
      now: this.now,
    };
  }
}

/**
 * Best quote for a SELL RFQ = highest per-unit premium; ties broken by
 * earliest arrival.
 */
export function selectBestQuote(quotes: Quote[]): Quote | null {
  let best: Quote | null = null;
  for (const q of quotes) {
    if (
      best === null ||
      q.premium > best.premium ||
      (q.premium === best.premium && q.receivedAt < best.receivedAt)
    ) {
      best = q;
    }
  }
  return best;
}
