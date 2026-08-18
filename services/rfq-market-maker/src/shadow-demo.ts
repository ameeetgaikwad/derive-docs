import { assertValidPolicy, DEFAULT_SHADOW_POLICY } from "./config.js";
import { evaluateQuote } from "./decision/quote-engine.js";
import { planHyperliquidHedge } from "./hedging/hyperliquid-plan.js";
import { InMemoryReservationLedger } from "./risk/reservations.js";

const nowMs = Date.UTC(2030, 0, 1, 0, 0, 0);
const policy = DEFAULT_SHADOW_POLICY;
assertValidPolicy(policy);

const ledger = new InMemoryReservationLedger();
const ledgerSnapshot = ledger.snapshot(nowMs);
const hedgeMarket = {
  meta: {
    snapshotId: "hl-l2-demo-1",
    source: "shadow-fixture",
    observedAtMs: nowMs - 100,
    receivedAtMs: nowMs - 50,
    healthy: true,
    confidence: 1,
  },
  venue: "HYPERLIQUID" as const,
  network: "TESTNET" as const,
  accountAddress: policy.hedge.accountAddress,
  coin: "BTC",
  oraclePriceUsdPerUnderlying: 100_000,
  markPriceUsdPerUnderlying: 100_010,
  bids: [
    { priceUsdPerUnderlying: 99_990, quantityUnderlying: 1 },
    { priceUsdPerUnderlying: 99_980, quantityUnderlying: 2 },
  ],
  asks: [
    { priceUsdPerUnderlying: 100_020, quantityUnderlying: 1 },
    { priceUsdPerUnderlying: 100_030, quantityUnderlying: 2 },
  ],
  takerFeeRateDecimal: 0.00045,
  fundingRateHourlyDecimal: 0.000005,
  accountEquityUsd: 250_000,
  currentMarginUsedUsd: 0,
};

const decision = evaluateQuote({
  nowMs,
  quoteAttemptId: "attempt-1",
  rfq: {
    rfqId: "shadow-rfq-1",
    direction: "TAKER_SELLS_OPTION",
    quantityContracts: 0.25,
    receivedAtMs: nowMs - 100,
    auctionEndsAtMs: nowMs + 30_000,
    takerAcceptanceEndsAtMs: nowMs + 90_000,
    instrument: {
      instrumentId: "BTC-2030-01-31-100000-C",
      optionAssetAddress:
        DEFAULT_SHADOW_POLICY.product.allowedOptionAssetAddresses[0]!,
      optionSubId: "shadow-verified-sub-id",
      underlying: "BTC",
      settlementCurrency: "USDT",
      kind: "CALL",
      strikeUsdPerUnderlying: 100_000,
      expiryMs: nowMs + 30 * 24 * 60 * 60 * 1_000,
      contractMultiplierUnderlying: 1,
      identityVerified: true,
    },
  },
  optionMarket: {
    meta: {
      snapshotId: "option-surface-demo-1",
      source: "shadow-fixture",
      observedAtMs: nowMs - 150,
      receivedAtMs: nowMs - 75,
      healthy: true,
      confidence: 1,
    },
    spotUsdPerUnderlying: 100_000,
    forwardUsdPerUnderlying: 100_100,
    volatilityDecimal: 0.6,
    annualRateDecimal: 0.04,
    protocolAndOiFeesUsd: 7.5,
  },
  hedgeMarket,
  hedgeOperations: {
    reconciliationHealthy: true,
    reconciledAtMs: nowMs - 50,
    portfolioRevision: 0,
    pendingOrderCount: 0,
    residualPortfolioDeltaUnderlying: 0,
  },
  portfolio: {
    confirmed: [],
    reservations: ledgerSnapshot.reservations,
    realizedPnlTodayUsd: 0,
    quotingHalted: false,
  },
  reservationLedgerVersion: ledgerSnapshot.version,
  policy,
});

let reservationCommitted = false;
let hypotheticalConfirmedFillHedgePlan: unknown = null;
if (decision.kind === "QUOTE") {
  reservationCommitted = ledger.tryApply(ledgerSnapshot.version, {
    kind: "UPSERT",
    reservation: decision.reservation,
  });
  // Demonstration only: the planner is invoked as if this quote later became an
  // attributable confirmed fill. A live coordinator must never infer a fill here.
  hypotheticalConfirmedFillHedgePlan = planHyperliquidHedge({
    nowMs,
    confirmedOptionDeltaUnderlying: decision.greeks.hedgeDeltaUnderlying,
    currentPerpPositionUnderlying: 0,
    pendingSignedPerpQuantityUnderlying: 0,
    portfolioRevision: 1,
    correlationId: "hypothetical-confirmed-fill:shadow-rfq-1",
    market: hedgeMarket,
    policy,
  });
}

process.stdout.write(
  `${JSON.stringify(
    {
      mode: policy.mode,
      sideEffectsPossible: false,
      decision,
      reservationCommitted,
      hypotheticalConfirmedFillHedgePlan,
    },
    null,
    2,
  )}\n`,
);
