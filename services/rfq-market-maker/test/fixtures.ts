import {
  DEFAULT_SHADOW_POLICY,
  type MarketMakerPolicy,
} from "../src/config.js";
import type {
  HedgeOperationalState,
  QuoteDecisionInput,
} from "../src/decision/quote-engine.js";
import type {
  HedgeMarketSnapshot,
  InstrumentIdentity,
  OptionMarketSnapshot,
  RfqCandidate,
  SnapshotMeta,
} from "../src/domain/types.js";
import type { HedgePlanInput } from "../src/hedging/hyperliquid-plan.js";
import type {
  PortfolioRiskState,
  RiskExposure,
  RiskReservation,
} from "../src/risk/exposures.js";

export const NOW_MS = Date.UTC(2026, 0, 15, 12, 0, 0);
export const DAY_MS = 24 * 60 * 60 * 1_000;

export interface PolicyOverrides {
  readonly mode?: MarketMakerPolicy["mode"];
  readonly policyVersion?: string;
  readonly modelVersion?: string;
  readonly product?: Partial<MarketMakerPolicy["product"]>;
  readonly timing?: Partial<MarketMakerPolicy["timing"]>;
  readonly marketData?: Partial<MarketMakerPolicy["marketData"]>;
  readonly hedge?: Partial<MarketMakerPolicy["hedge"]>;
  readonly costs?: Partial<MarketMakerPolicy["costs"]>;
  readonly quote?: Partial<MarketMakerPolicy["quote"]>;
  readonly reservationStress?: Partial<MarketMakerPolicy["reservationStress"]>;
  readonly risk?: Partial<MarketMakerPolicy["risk"]>;
}

export function makePolicy(
  overrides: PolicyOverrides = {},
): MarketMakerPolicy {
  return {
    ...DEFAULT_SHADOW_POLICY,
    ...overrides,
    product: { ...DEFAULT_SHADOW_POLICY.product, ...overrides.product },
    timing: { ...DEFAULT_SHADOW_POLICY.timing, ...overrides.timing },
    marketData: {
      ...DEFAULT_SHADOW_POLICY.marketData,
      ...overrides.marketData,
    },
    hedge: { ...DEFAULT_SHADOW_POLICY.hedge, ...overrides.hedge },
    costs: { ...DEFAULT_SHADOW_POLICY.costs, ...overrides.costs },
    quote: { ...DEFAULT_SHADOW_POLICY.quote, ...overrides.quote },
    reservationStress: {
      ...DEFAULT_SHADOW_POLICY.reservationStress,
      ...overrides.reservationStress,
    },
    risk: { ...DEFAULT_SHADOW_POLICY.risk, ...overrides.risk },
  };
}

function makeMeta(
  snapshotId: string,
  source: string,
  overrides: Partial<SnapshotMeta> = {},
): SnapshotMeta {
  return {
    snapshotId,
    source,
    observedAtMs: NOW_MS - 100,
    receivedAtMs: NOW_MS - 50,
    healthy: true,
    confidence: 1,
    ...overrides,
  };
}

type RfqOverrides = Omit<Partial<RfqCandidate>, "instrument"> & {
  readonly instrument?: Partial<InstrumentIdentity>;
};

export function makeRfq(overrides: RfqOverrides = {}): RfqCandidate {
  const instrument: InstrumentIdentity = {
    instrumentId: "BTC-100000-C-20260214",
    optionAssetAddress: DEFAULT_SHADOW_POLICY.product.allowedOptionAssetAddresses[0]!,
    optionSubId: "0x01",
    underlying: "BTC",
    settlementCurrency: "USDT",
    kind: "CALL",
    strikeUsdPerUnderlying: 100_000,
    expiryMs: NOW_MS + 30 * DAY_MS,
    contractMultiplierUnderlying: 1,
    identityVerified: true,
    ...overrides.instrument,
  };

  return {
    rfqId: "rfq-1",
    direction: "TAKER_SELLS_OPTION",
    quantityContracts: 0.1,
    receivedAtMs: NOW_MS - 100,
    auctionEndsAtMs: NOW_MS + 10_000,
    takerAcceptanceEndsAtMs: NOW_MS + 60_000,
    ...overrides,
    instrument,
  };
}

type OptionMarketOverrides = Omit<Partial<OptionMarketSnapshot>, "meta"> & {
  readonly meta?: Partial<SnapshotMeta>;
};

export function makeOptionMarket(
  overrides: OptionMarketOverrides = {},
): OptionMarketSnapshot {
  const { meta, ...values } = overrides;
  return {
    spotUsdPerUnderlying: 100_000,
    forwardUsdPerUnderlying: 100_200,
    volatilityDecimal: 0.6,
    annualRateDecimal: 0.04,
    protocolAndOiFeesUsd: 5,
    ...values,
    meta: makeMeta("option-snapshot-1", "test-option-source", meta),
  };
}

type HedgeMarketOverrides = Omit<Partial<HedgeMarketSnapshot>, "meta"> & {
  readonly meta?: Partial<SnapshotMeta>;
};

export function makeHedgeMarket(
  overrides: HedgeMarketOverrides = {},
): HedgeMarketSnapshot {
  const { meta, ...values } = overrides;
  return {
    venue: "HYPERLIQUID",
    network: DEFAULT_SHADOW_POLICY.hedge.network,
    accountAddress: DEFAULT_SHADOW_POLICY.hedge.accountAddress,
    coin: "BTC",
    oraclePriceUsdPerUnderlying: 100_000,
    markPriceUsdPerUnderlying: 100_010,
    bids: [
      { priceUsdPerUnderlying: 99_990, quantityUnderlying: 5 },
      { priceUsdPerUnderlying: 99_980, quantityUnderlying: 5 },
    ],
    asks: [
      { priceUsdPerUnderlying: 100_010, quantityUnderlying: 5 },
      { priceUsdPerUnderlying: 100_020, quantityUnderlying: 5 },
    ],
    takerFeeRateDecimal: 0.00045,
    fundingRateHourlyDecimal: 0.000005,
    accountEquityUsd: 1_000_000,
    currentMarginUsedUsd: 10_000,
    ...values,
    meta: makeMeta("hedge-snapshot-1", "test-hyperliquid", meta),
  };
}

export function makeExposure(
  overrides: Partial<RiskExposure> = {},
): RiskExposure {
  return {
    netOptionDeltaUnderlying: 0,
    netGammaUsdForOnePercentSquared: 0,
    grossGammaUsdForOnePercentSquared: 0,
    netVegaUsdPerVolPoint: 0,
    grossVegaUsdPerVolPoint: 0,
    grossOptionNotionalUsd: 0,
    protocolCashOutflowUsd: 0,
    hedgeNotionalUsd: 0,
    hedgeInitialMarginUsd: 0,
    ...overrides,
  };
}

export function makeReservation(
  overrides: Partial<RiskReservation> = {},
): RiskReservation {
  return {
    reservationId: "rfq:other",
    rfqId: "other",
    basedOnLedgerVersion: 0,
    expiresAtMs: NOW_MS + 60_000,
    expiryBucket: "2026-02-14",
    exposure: makeExposure(),
    ...overrides,
  };
}

export function makePortfolio(
  overrides: Partial<PortfolioRiskState> = {},
): PortfolioRiskState {
  return {
    confirmed: [],
    reservations: [],
    realizedPnlTodayUsd: 0,
    quotingHalted: false,
    ...overrides,
  };
}

export function makeQuoteInput(
  overrides: Partial<QuoteDecisionInput> = {},
): QuoteDecisionInput {
  return {
    nowMs: NOW_MS,
    quoteAttemptId: "attempt-1",
    rfq: makeRfq(),
    optionMarket: makeOptionMarket(),
    hedgeMarket: makeHedgeMarket(),
    hedgeOperations: makeHedgeOperations(),
    portfolio: makePortfolio(),
    reservationLedgerVersion: 7,
    policy: makePolicy(),
    ...overrides,
  };
}

export function makeHedgeOperations(
  overrides: Partial<HedgeOperationalState> = {},
): HedgeOperationalState {
  return {
    reconciliationHealthy: true,
    reconciledAtMs: NOW_MS - 50,
    portfolioRevision: 11,
    pendingOrderCount: 0,
    residualPortfolioDeltaUnderlying: 0,
    ...overrides,
  };
}

export function makeHedgeInput(
  overrides: Partial<HedgePlanInput> = {},
): HedgePlanInput {
  return {
    nowMs: NOW_MS,
    confirmedOptionDeltaUnderlying: 0.3,
    currentPerpPositionUnderlying: 0,
    pendingSignedPerpQuantityUnderlying: 0,
    portfolioRevision: 11,
    correlationId: "fill-1",
    market: makeHedgeMarket(),
    policy: makePolicy(),
    ...overrides,
  };
}
