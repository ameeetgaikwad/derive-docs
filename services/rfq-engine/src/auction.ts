import { EventEmitter } from "node:events";
import type { Address, Hex } from "viem";
import { encodeOptionSubId, instrumentName, toUnit, type Action, type MarketDefinition } from "@hedge/shared";
import {
  UnresolvedExecutorOperationError,
  UnresolvedExecutorTransactionError,
  type ChainReader,
} from "./chain.js";
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
import { AccountLock } from "./account-lock.js";

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
  marketReadiness?: (
    market: MarketDefinition,
    expiry: bigint,
    strike: bigint,
    rawAmount: bigint,
  ) => Promise<void>;
  auctionWindowMs: number;
  /** ms the taker has to accept after the auction closes with a winner (default 120s) */
  acceptDeadlineMs?: number;
  now?: () => number;
  accountLock?: AccountLock;
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
  private readonly activeExecutions = new Set<string>();
  private readonly reconciliations = new Map<string, Promise<Rfq>>();
  private readonly now: () => number;
  private readonly acceptDeadlineMs: number;
  private readonly accountLock: AccountLock;

  constructor(private readonly opts: AuctionEngineOptions) {
    super();
    this.now = opts.now ?? Date.now;
    this.acceptDeadlineMs = opts.acceptDeadlineMs ?? DEFAULT_ACCEPT_DEADLINE_MS;
    this.accountLock = opts.accountLock ?? new AccountLock();
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
      await this.opts.marketReadiness?.(market, instrument.expiry, instrument.strike, amount);
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
      executionIntent: null,
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
    const rfq = await this.opts.store.getRfq(id);
    if (!rfq || rfq.status !== "executing" || this.activeExecutions.has(id)) return rfq;
    return this.reconcileExecuting(rfq);
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
    return this.accountLock.runResource(`rfq:${params.rfqId}`, () =>
      this.accountLock.run([params.action.subaccountId], () =>
        this.submitQuoteLocked(params),
      ),
    );
  }

  private async submitQuoteLocked(params: {
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
    return this.accountLock.runResource(`rfq:${quote.rfqId}`, () =>
      this.accountLock.run([quote.makerSubaccountId], async () => {
        const current = await this.opts.store.getQuote(params.quoteId);
        if (!current || !addressEq(current.maker, params.maker)) {
          throw new QuoteValidationError(`unknown quote ${params.quoteId}`);
        }
        const rfq = await this.opts.store.getRfq(current.rfqId);
        if (!rfq || rfq.status !== "open" || this.now() >= rfq.auctionEndsAt) {
          throw new QuoteValidationError("auction window closed — quote can no longer be cancelled");
        }
        await this.opts.store.deleteQuote(current.id);
        this.releaseReservation(current.id);
        return current;
      }),
    );
  }

  async closeAuction(rfqId: string): Promise<void> {
    return this.accountLock.runResource(`rfq:${rfqId}`, () => this.closeAuctionLocked(rfqId));
  }

  private async closeAuctionLocked(rfqId: string): Promise<void> {
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
    }
    await this.opts.store.putRfq(rfq);
    if (best) this.armAcceptTimer(rfq);
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
    return this.accountLock.runResource(`rfq:${rfqId}`, async () => {
      const rfq = await this.opts.store.getRfq(rfqId);
      const winner = rfq?.bestQuoteId ? await this.opts.store.getQuote(rfq.bestQuoteId) : null;
      return this.accountLock.run(
        winner ? [winner.makerSubaccountId] : [],
        () => this.expireAcceptLocked(rfqId),
      );
    });
  }

  private async expireAcceptLocked(rfqId: string): Promise<void> {
    this.clearAcceptTimer(rfqId);
    const rfq = await this.opts.store.getRfq(rfqId);
    if (!rfq || rfq.status !== "closed") return;
    const winner = rfq.bestQuoteId ? await this.opts.store.getQuote(rfq.bestQuoteId) : null;
    rfq.status = "expired";
    rfq.error = "taker did not accept before the deadline";
    await this.opts.store.putRfq(rfq);
    if (winner) this.releaseReservation(winner.id);
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
    return this.accountLock.runResource(`rfq:${params.rfqId}`, async () => {
      const candidate = await this.opts.store.getRfq(params.rfqId);
      const candidateQuote = candidate?.bestQuoteId
        ? await this.opts.store.getQuote(candidate.bestQuoteId)
        : null;
      const accountIds = [
        ...(candidate ? [candidate.takerSubaccountId] : []),
        ...(candidateQuote ? [candidateQuote.makerSubaccountId] : []),
      ];
      return this.accountLock.run(accountIds, () => this.acceptRfqLocked(params));
    });
  }

  private async acceptRfqLocked(params: {
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
      await this.expireAcceptLocked(rfq.id);
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

    const intent = await this.opts.executor.createExecutionIntent(plan);
    // Validation and block-anchor reads can outlive the accept deadline. The
    // RFQ lock keeps the expiry timer queued while this final state/time check
    // decides which durable transition wins.
    const fresh = await this.opts.store.getRfq(rfq.id);
    if (!fresh || fresh.status !== "closed" || fresh.bestQuoteId !== quote.id) {
      throw new QuoteValidationError("rfq changed while validating acceptance");
    }
    if (fresh.acceptDeadlineAt !== null && this.now() >= fresh.acceptDeadlineAt) {
      await this.expireAcceptLocked(fresh.id);
      throw new QuoteValidationError("taker accept deadline passed");
    }

    const executing: Rfq = {
      ...fresh,
      status: "executing",
      executionIntent: intent,
      error: null,
    };
    // Mark active before exposing `executing` in the store. GET cannot start
    // reconciliation in the await gap between the durable put and broadcast.
    this.activeExecutions.add(executing.id);
    this.clearAcceptTimer(executing.id);
    try {
      try {
        // JsonlRfqStore fsyncs this intent before the submitter can broadcast.
        await this.opts.store.putRfq(executing);
      } catch (error) {
        this.armAcceptTimer(fresh);
        throw error;
      }

      try {
        const result = await this.opts.executor.execute(plan, async (txHash) => {
          intent.txHash = txHash;
          // The hash is durable before ViemTxSubmitter starts receipt waiting.
          await this.opts.store.putRfq(executing);
        });
        const terminal = await this.terminalizeMined(executing, intent, result);
        return terminal.execution!;
      } catch (err) {
        if (
          err instanceof UnresolvedExecutorOperationError ||
          err instanceof UnresolvedExecutorTransactionError
        ) {
          // serializeWrite rejected this RFQ before invoking its broadcast work
          // because an older executor outcome is unresolved. Return this still-
          // valid acceptance to `closed`, preserve only its existing winner
          // reservation, and let the taker retry after the older latch clears.
          // Do not create a second ambiguous-operation latch.
          const closed: Rfq = {
            ...executing,
            status: "closed",
            executionIntent: null,
            error: `executor unavailable: ${err.message}`,
          };
          await this.opts.store.putRfq(closed);
          if (closed.acceptDeadlineAt !== null && this.now() >= closed.acceptDeadlineAt) {
            await this.expireAcceptLocked(closed.id);
          } else {
            this.armAcceptTimer(closed);
          }
          throw err;
        }
        // A thrown executor call is not proof that verifyAndMatch was never
        // broadcast: eth_sendRawTransaction and receipt RPCs can fail after the
        // executor transaction entered the mempool. Keep the RFQ non-terminal,
        // retain the maker cash reservation, and latch all executor writes. A
        // reverted receipt is returned as a normal result above and remains the
        // only terminal failure path.
        this.opts.executor.armExecutionRecovery(executing.id, intent.txHash);
        const unresolved = {
          ...executing,
          error: `execution outcome unresolved: ${err instanceof Error ? err.message : String(err)}`,
        };
        await this.opts.store.putRfq(unresolved);
        throw err;
      }
    } finally {
      this.activeExecutions.delete(executing.id);
    }
  }

  private async terminalizeMined(
    rfq: Rfq,
    intent: NonNullable<Rfq["executionIntent"]>,
    result: Pick<ExecutionResult, "txHash" | "status" | "blockNumber">,
  ): Promise<Rfq> {
    const wasHashless = intent.txHash === null;
    if (intent.txHash && intent.txHash.toLowerCase() !== result.txHash.toLowerCase()) {
      throw new Error(`reconciled hash ${result.txHash} does not match persisted ${intent.txHash}`);
    }
    const terminalIntent = { ...intent, txHash: result.txHash };
    const execution: ExecutionResult = { ...result, fill: intent.fill };
    const terminal: Rfq = {
      ...rfq,
      status: result.status === "success" ? "executed" : "failed",
      execution,
      executionIntent: terminalIntent,
      error: result.status === "success" ? null : "verifyAndMatch reverted",
    };
    // Durability is the authority: release no collateral and clear no latch
    // until the terminal RFQ record has reached fsync.
    await this.opts.store.putRfq(terminal);
    this.releaseReservation(intent.fill.quoteId);
    this.opts.executor.clearExecutionRecovery(rfq.id, result.txHash, wasHashless);
    if (result.status === "success") this.emit("rfq_executed", terminal, execution);
    else this.emit("rfq_failed", terminal, terminal.error ?? "reverted");
    return terminal;
  }

  private async terminalizeExpiredUnused(
    rfq: Rfq,
    intent: NonNullable<Rfq["executionIntent"]>,
  ): Promise<Rfq> {
    const terminal: Rfq = {
      ...rfq,
      status: "failed",
      execution: null,
      error: "execution did not consume either action nonce before both actions expired",
    };
    await this.opts.store.putRfq(terminal);
    this.releaseReservation(intent.fill.quoteId);
    this.opts.executor.clearExecutionRecovery(rfq.id, intent.txHash, intent.txHash === null);
    this.emit("rfq_failed", terminal, terminal.error!);
    return terminal;
  }

  private reconcileExecuting(rfq: Rfq): Promise<Rfq> {
    const existing = this.reconciliations.get(rfq.id);
    if (existing) return existing;
    const run = this.reconcileExecutingOnce(rfq).finally(() => {
      this.reconciliations.delete(rfq.id);
    });
    this.reconciliations.set(rfq.id, run);
    return run;
  }

  private async reconcileExecutingOnce(candidate: Rfq): Promise<Rfq> {
    const rfq = await this.opts.store.getRfq(candidate.id) ?? candidate;
    if (rfq.status !== "executing") return rfq;
    const intent = rfq.executionIntent;
    this.opts.executor.armExecutionRecovery(rfq.id, intent?.txHash ?? null);
    if (!intent) {
      if (!rfq.error?.includes("legacy execution record")) {
        const unresolved = {
          ...rfq,
          error: "legacy execution record has no durable action identity; manual reconciliation required",
        };
        await this.opts.store.putRfq(unresolved);
        return unresolved;
      }
      return rfq;
    }
    try {
      const reconciled = await this.opts.executor.reconcileExecution(intent);
      if (reconciled.state === "mined") {
        return this.terminalizeMined(rfq, intent, reconciled.result);
      }
      if (reconciled.state === "expired-unused") {
        return this.terminalizeExpiredUnused(rfq, intent);
      }
      return rfq;
    } catch (error) {
      const message = `execution reconciliation remains ambiguous: ${error instanceof Error ? error.message : String(error)}`;
      if (rfq.error === message) return rfq;
      const unresolved = { ...rfq, error: message };
      await this.opts.store.putRfq(unresolved);
      return unresolved;
    }
  }

  /**
   * Restart recovery (durable stores): re-arm timers for live RFQs, close or
   * expire anything whose window/deadline passed while the engine was down,
   * latch RFQs that were mid-execution, and rebuild collateral reservations.
   * Call once on startup, before serving traffic.
   */
  async recover(): Promise<{
    rearmed: number;
    closed: number;
    expired: number;
    unresolved: number;
    resolved: number;
  }> {
    const summary = { rearmed: 0, closed: 0, expired: 0, unresolved: 0, resolved: 0 };
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
        // Rebuild reservation and install the exact executor latch before any
        // read-side reconciliation. recover() completes before traffic starts.
        const winner = rfq.bestQuoteId ? await this.opts.store.getQuote(rfq.bestQuoteId) : null;
        if (winner) {
          this.reservations.set(winner.id, {
            subaccountId: winner.makerSubaccountId,
            amount: winner.reservedCash,
          });
        }
        const reconciled = await this.reconcileExecuting(rfq);
        if (reconciled.status === "executing") summary.unresolved += 1;
        else summary.resolved += 1;
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
