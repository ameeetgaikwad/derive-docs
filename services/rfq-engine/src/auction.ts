import { EventEmitter } from "node:events";
import type { Address, Hex } from "viem";
import { encodeOptionSubId, instrumentName, toUnit, type Action, type MarketDefinition } from "@hedge/shared";
import type { ChainReader } from "./chain.js";
import { QuoteValidationError, validateQuote, validateTakerAccept } from "./quotes.js";
import type { RfqStore } from "./store.js";
import {
  addressEq,
  asBigInt,
  type CreateRfqRequest,
  type Instrument,
  type Quote,
  type Rfq,
} from "./types.js";
import { buildRfqExecution, type Executor } from "./executor.js";
import type { ExecutionResult } from "./types.js";
import { assertMarketTradeable } from "./markets.js";

export interface AuctionEvents {
  rfq_open: [rfq: Rfq];
  rfq_closed: [rfq: Rfq, bestQuote: Quote | null];
  rfq_executed: [rfq: Rfq, result: ExecutionResult];
  rfq_failed: [rfq: Rfq, error: string];
  /** won-but-unaccepted RFQ passed the taker-accept deadline */
  rfq_accept_expired: [rfq: Rfq, winningQuote: Quote | null];
}

export interface AuctionEngineOptions {
  store: RfqStore;
  chainReader: ChainReader;
  executor: Executor;
  chainId: number;
  matching: Address;
  rfqModule: Address;
  optionAssets: Record<string, Address>;
  /** currency symbol -> forward feed (SRM OI fee estimation); optional per currency */
  forwardFeeds?: Record<string, Address>;
  markets?: MarketDefinition[];
  /** Production feed and multiplier readiness gate, called before an RFQ is persisted. */
  marketReadiness?: (market: MarketDefinition, expiry: bigint, strike: bigint) => Promise<void>;
  auctionWindowMs: number;
  /** ms the taker has to accept after the auction closes with a winner (default 120s) */
  acceptDeadlineMs?: number;
  now?: () => number;
}

const DEFAULT_ACCEPT_DEADLINE_MS = 120_000;

/**
 * The auction core: opens RFQs, validates and collects maker quotes during
 * the window, selects the best (highest premium — the taker is selling), and
 * executes accepted RFQs through the on-chain executor.
 *
 * Transport-agnostic: the WS/REST server subscribes to its events.
 */
export class AuctionEngine extends EventEmitter<AuctionEvents> {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly acceptTimers = new Map<string, NodeJS.Timeout>();
  /** quoteId -> reserved maker cash (totalPremium + maxFee + OI fee) */
  private readonly reservations = new Map<string, { subaccountId: bigint; amount: bigint }>();
  private readonly now: () => number;
  private readonly acceptDeadlineMs: number;

  constructor(private readonly opts: AuctionEngineOptions) {
    super();
    this.now = opts.now ?? Date.now;
    this.acceptDeadlineMs = opts.acceptDeadlineMs ?? DEFAULT_ACCEPT_DEADLINE_MS;
  }

  /** Sum of cash reserved against a maker subaccount, excluding given quotes. */
  reservedFor(subaccountId: bigint, exclude?: Set<string>): bigint {
    let total = 0n;
    for (const [quoteId, r] of this.reservations) {
      if (r.subaccountId !== subaccountId) continue;
      if (exclude?.has(quoteId)) continue;
      total += r.amount;
    }
    return total;
  }

  private releaseReservation(quoteId: string): void {
    this.reservations.delete(quoteId);
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
    const market = this.opts.markets?.find((candidate) => candidate.id === instrument.currency);
    if (market) {
      assertMarketTradeable(market, amount, instrument.expiry, this.now());
      await this.opts.marketReadiness?.(market, instrument.expiry, instrument.strike);
    }

    const createdAt = this.now();
    const rfq: Rfq = {
      id: crypto.randomUUID(),
      takerSubaccountId,
      instrument,
      amount,
      direction: "sell",
      createdAt,
      auctionEndsAt: createdAt + this.opts.auctionWindowMs,
      acceptDeadlineAt: null,
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
   * Validate and admit a maker quote into an open auction. A second quote
   * from the same maker for the same RFQ replaces the previous one (only the
   * latest is kept). Throws QuoteValidationError with a maker-friendly reason
   * on rejection.
   */
  async submitQuote(params: {
    rfqId: string;
    maker: Address;
    action: Action;
    signature: Hex;
  }): Promise<{ quote: Quote; replacedQuoteId: string | null }> {
    const rfq = await this.opts.store.getRfq(params.rfqId);
    if (!rfq) throw new QuoteValidationError(`unknown rfq ${params.rfqId}`);

    // Replace semantics: prior quotes by this maker on this RFQ don't count
    // against their reserved collateral and are removed on admit.
    const prior = (await this.opts.store.listQuotes(params.rfqId)).filter((q) =>
      addressEq(q.maker, params.maker),
    );
    const priorIds = new Set(prior.map((q) => q.id));
    const reservedCash = this.reservedFor(params.action.subaccountId, priorIds);

    const quote = await validateQuote({
      rfq,
      maker: params.maker,
      action: params.action,
      signature: params.signature,
      ctx: this.validationCtx(rfq, reservedCash),
    });
    // Re-check the window: validation does chain reads and may straddle close.
    const fresh = await this.opts.store.getRfq(params.rfqId);
    if (!fresh || fresh.status !== "open" || this.now() >= fresh.auctionEndsAt) {
      throw new QuoteValidationError("auction window closed");
    }
    for (const old of prior) {
      await this.opts.store.deleteQuote(old.id);
      this.releaseReservation(old.id);
    }
    await this.opts.store.putQuote(quote);
    this.reservations.set(quote.id, {
      subaccountId: quote.makerSubaccountId,
      amount: quote.reservedCash,
    });
    return { quote, replacedQuoteId: prior[prior.length - 1]?.id ?? null };
  }

  /**
   * Maker cancels their own quote (by quoteId) while the auction is open.
   * Throws QuoteValidationError when the quote is unknown, owned by someone
   * else, or the auction has already closed (the winner is locked in).
   */
  async cancelQuote(params: { quoteId: string; maker: Address }): Promise<Quote> {
    const quote = await this.opts.store.getQuote(params.quoteId);
    if (!quote || !addressEq(quote.maker, params.maker)) {
      // identical error for unknown vs foreign quotes — don't leak ids
      throw new QuoteValidationError(`unknown quote ${params.quoteId}`);
    }
    const rfq = await this.opts.store.getRfq(quote.rfqId);
    if (!rfq || rfq.status !== "open" || this.now() >= rfq.auctionEndsAt) {
      throw new QuoteValidationError("auction window closed — quote can no longer be cancelled");
    }
    await this.opts.store.deleteQuote(quote.id);
    this.releaseReservation(quote.id);
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
    // losing quotes no longer reserve maker collateral; the winner stays
    // reserved until executed/failed/deadline (idempotent for recovery)
    for (const q of quotes) {
      if (q.id !== best?.id) this.releaseReservation(q.id);
    }
    if (best) {
      this.reservations.set(best.id, {
        subaccountId: best.makerSubaccountId,
        amount: best.reservedCash,
      });
    }
    rfq.status = best ? "closed" : "expired";
    rfq.bestQuoteId = best?.id ?? null;
    if (best) {
      rfq.acceptDeadlineAt = this.now() + this.acceptDeadlineMs;
      this.armAcceptTimer(rfq);
    }
    await this.opts.store.putRfq(rfq);
    this.emit("rfq_closed", rfq, best);
  }

  private armAcceptTimer(rfq: Rfq): void {
    if (rfq.acceptDeadlineAt === null) return;
    const delay = Math.max(0, rfq.acceptDeadlineAt - this.now());
    const timer = setTimeout(() => {
      this.expireAccept(rfq.id).catch((err) => {
        // eslint-disable-next-line no-console
        console.error(`expireAccept(${rfq.id}) failed:`, err);
      });
    }, delay);
    this.acceptTimers.set(rfq.id, timer);
  }

  private clearAcceptTimer(rfqId: string): void {
    const timer = this.acceptTimers.get(rfqId);
    if (timer) {
      clearTimeout(timer);
      this.acceptTimers.delete(rfqId);
    }
  }

  /** Won-but-unaccepted RFQ hit the taker-accept deadline: close it out. */
  async expireAccept(rfqId: string): Promise<void> {
    this.clearAcceptTimer(rfqId);
    const rfq = await this.opts.store.getRfq(rfqId);
    if (!rfq || rfq.status !== "closed") return;
    const winner = rfq.bestQuoteId ? await this.opts.store.getQuote(rfq.bestQuoteId) : null;
    if (winner) this.releaseReservation(winner.id);
    rfq.status = "expired";
    rfq.error = "taker did not accept before the deadline";
    await this.opts.store.putRfq(rfq);
    this.emit("rfq_accept_expired", rfq, winner);
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

    if (rfq.acceptDeadlineAt !== null && this.now() >= rfq.acceptDeadlineAt) {
      await this.expireAccept(rfq.id);
      throw new QuoteValidationError("taker accept deadline passed");
    }

    await validateTakerAccept({
      rfq,
      quote,
      action: params.action,
      signature: params.signature,
      ctx: this.validationCtx(rfq, 0n),
    });

    const plan = buildRfqExecution({
      rfq,
      quote,
      takerAction: params.action,
      takerSignature: params.signature,
    });

    this.clearAcceptTimer(rfq.id);
    rfq.status = "executing";
    await this.opts.store.putRfq(rfq);
    try {
      const result = await this.opts.executor.execute(plan);
      rfq.status = result.status === "success" ? "executed" : "failed";
      rfq.execution = result;
      rfq.error = result.status === "success" ? null : "verifyAndMatch reverted";
      await this.opts.store.putRfq(rfq);
      this.releaseReservation(quote.id);
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
      this.releaseReservation(quote.id);
      this.emit("rfq_failed", rfq, rfq.error);
      throw err;
    }
  }

  /**
   * Restart recovery (durable stores): re-arm timers for live RFQs, close or
   * expire anything whose window/deadline passed while the engine was down,
   * fail RFQs that were mid-execution, and rebuild collateral reservations.
   * Call once on startup, before serving traffic.
   */
  async recover(): Promise<{ rearmed: number; closed: number; expired: number; failed: number }> {
    const summary = { rearmed: 0, closed: 0, expired: 0, failed: 0 };
    for (const rfq of await this.opts.store.listRfqs()) {
      if (rfq.status === "open") {
        if (this.now() < rfq.auctionEndsAt) {
          const timer = setTimeout(() => {
            this.closeAuction(rfq.id).catch((err) => {
              // eslint-disable-next-line no-console
              console.error(`closeAuction(${rfq.id}) failed:`, err);
            });
          }, rfq.auctionEndsAt - this.now());
          this.timers.set(rfq.id, timer);
          for (const q of await this.opts.store.listQuotes(rfq.id)) {
            this.reservations.set(q.id, {
              subaccountId: q.makerSubaccountId,
              amount: q.reservedCash,
            });
          }
          summary.rearmed += 1;
        } else {
          await this.closeAuction(rfq.id);
          summary.closed += 1;
        }
      } else if (rfq.status === "closed") {
        if (rfq.acceptDeadlineAt !== null && this.now() >= rfq.acceptDeadlineAt) {
          await this.expireAccept(rfq.id);
          summary.expired += 1;
        } else {
          if (rfq.acceptDeadlineAt === null) {
            // pre-deadline records: start the clock now
            rfq.acceptDeadlineAt = this.now() + this.acceptDeadlineMs;
            await this.opts.store.putRfq(rfq);
          }
          const winner = rfq.bestQuoteId ? await this.opts.store.getQuote(rfq.bestQuoteId) : null;
          if (winner) {
            this.reservations.set(winner.id, {
              subaccountId: winner.makerSubaccountId,
              amount: winner.reservedCash,
            });
          }
          this.armAcceptTimer(rfq);
          summary.rearmed += 1;
        }
      } else if (rfq.status === "executing") {
        // a tx may or may not have landed — surface loudly, never resubmit
        rfq.status = "failed";
        rfq.error = "engine restarted during execution — verify on-chain state manually";
        await this.opts.store.putRfq(rfq);
        summary.failed += 1;
      }
    }
    return summary;
  }

  /** Clear all pending auction timers (for shutdown). */
  stop(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const timer of this.acceptTimers.values()) clearTimeout(timer);
    this.acceptTimers.clear();
  }

  private validationCtx(rfq: Rfq, reservedCash: bigint) {
    return {
      chainId: this.opts.chainId,
      matching: this.opts.matching,
      rfqModule: this.opts.rfqModule,
      chainReader: this.opts.chainReader,
      now: this.now,
      forwardFeed: this.opts.forwardFeeds?.[rfq.instrument.currency] ?? null,
      reservedCash,
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
