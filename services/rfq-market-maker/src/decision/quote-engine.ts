import { validatePolicy, type MarketMakerPolicy } from "../config.js";
import type {
  HedgeMarketSnapshot,
  OptionMarketSnapshot,
  RfqCandidate,
} from "../domain/types.js";
import { simulateBoundedIoc, type BookExecution } from "../market/order-book.js";
import {
  black76,
  forwardDeltaToHedgeUnderlying,
  type Black76Result,
} from "../pricing/black76.js";
import {
  evaluateRiskLimits,
  expiryBucketUtc,
  maximumRiskUtilization,
  validatePortfolioRiskState,
  type PortfolioRiskState,
  type RiskExposure,
  type RiskReservation,
  type RiskSlice,
} from "../risk/exposures.js";
import type { DeclineReasonCode, GateCheck } from "./reason-codes.js";

const YEAR_MS = 365 * 24 * 60 * 60 * 1_000;

export interface QuoteCostBreakdown {
  readonly protocolAndOiFeesUsd: number;
  readonly initialHedgeSpreadSlippageUsd: number;
  readonly initialHedgeTakerFeeUsd: number;
  readonly expectedRehedgingCostUsd: number;
  readonly expectedFundingCostUsd: number;
  readonly basisSettlementLatencyChargeUsd: number;
  readonly adverseSelectionChargeUsd: number;
  readonly modelRiskChargeUsd: number;
  readonly capitalChargeUsd: number;
  readonly incrementalPortfolioRiskChargeUsd: number;
  readonly requiredProfitUsd: number;
}

export interface QuoteEconomics {
  readonly modelFairValueUsd: number;
  readonly conservativeFairValueUsd: number;
  readonly costs: QuoteCostBreakdown;
  readonly totalDeductionsUsd: number;
  readonly reservationBidCeilingUsd: number;
  readonly quotedTotalPremiumUsd: number;
  readonly quotedUnitPremiumUsdPerUnderlying: number;
  readonly expectedModelEdgeUsd: number;
}

export interface CandidateGreeks {
  readonly makerOptionQuantityUnderlying: number;
  readonly forwardDeltaPerUnderlying: number;
  readonly hedgeDeltaUnderlying: number;
  readonly gammaUsdForOnePercentSquared: number;
  readonly vegaUsdPerVolPoint: number;
  readonly thetaUsdPerDay: number;
}

export interface DecisionDiagnostics {
  readonly evaluatedAtMs: number;
  readonly policyVersion: string;
  readonly modelVersion: string;
  readonly reservationLedgerVersion: number;
  readonly optionSnapshotId: string;
  readonly hedgeSnapshotId: string;
  readonly gates: readonly GateCheck[];
}

export interface QuoteDecisionInput {
  readonly nowMs: number;
  readonly quoteAttemptId: string;
  readonly rfq: RfqCandidate;
  readonly optionMarket: OptionMarketSnapshot;
  readonly hedgeMarket: HedgeMarketSnapshot;
  readonly hedgeOperations: HedgeOperationalState;
  readonly portfolio: PortfolioRiskState;
  readonly reservationLedgerVersion: number;
  readonly policy: MarketMakerPolicy;
}

export interface HedgeOperationalState {
  readonly reconciliationHealthy: boolean;
  readonly reconciledAtMs: number;
  readonly portfolioRevision: number;
  readonly pendingOrderCount: number;
  /** Confirmed option delta plus confirmed perp position after reconciliation. */
  readonly residualPortfolioDeltaUnderlying: number;
}

export type QuoteDecision =
  | {
      readonly kind: "DECLINE";
      readonly rfqId: string;
      readonly primaryReason: DeclineReasonCode;
      readonly reasons: readonly DeclineReasonCode[];
      readonly diagnostics: DecisionDiagnostics;
    }
  | {
      readonly kind: "QUOTE";
      readonly rfqId: string;
      readonly economics: QuoteEconomics;
      readonly greeks: CandidateGreeks;
      readonly initialHedgePreview: BookExecution;
      readonly reservation: RiskReservation;
      readonly diagnostics: DecisionDiagnostics;
    };

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isValidBookLevel(level: {
  readonly priceUsdPerUnderlying: number;
  readonly quantityUnderlying: number;
}): boolean {
  return (
    isFinitePositive(level.priceUsdPerUnderlying) &&
    isFinitePositive(level.quantityUnderlying)
  );
}

function sumCosts(costs: QuoteCostBreakdown): number {
  return Object.values(costs).reduce((total, value) => total + value, 0);
}

function floorToTick(value: number, tick: number): number {
  return Math.floor(value / tick + 1e-12) * tick;
}

function makeDiagnostics(
  input: QuoteDecisionInput,
  gates: readonly GateCheck[],
): DecisionDiagnostics {
  return {
    evaluatedAtMs: input.nowMs,
    policyVersion: input.policy.policyVersion,
    modelVersion: input.policy.modelVersion,
    reservationLedgerVersion: input.reservationLedgerVersion,
    optionSnapshotId: input.optionMarket.meta.snapshotId,
    hedgeSnapshotId: input.hedgeMarket.meta.snapshotId,
    gates,
  };
}

function decline(
  input: QuoteDecisionInput,
  gates: readonly GateCheck[],
): QuoteDecision {
  const reasons = gates
    .filter((gate) => !gate.passed)
    .map((gate) => gate.declineCode);
  if (reasons.length === 0) {
    throw new Error("decline called without a failed gate");
  }
  return {
    kind: "DECLINE",
    rfqId: input.rfq.rfqId,
    primaryReason: reasons[0]!,
    reasons: [...new Set(reasons)],
    diagnostics: makeDiagnostics(input, gates),
  };
}

function conservativeValue(
  input: QuoteDecisionInput,
  timeToExpiryYears: number,
  makerQuantityUnderlying: number,
): { readonly base: Black76Result; readonly conservativeTotalUsd: number } {
  const base = black76({
    forwardUsdPerUnderlying: input.optionMarket.forwardUsdPerUnderlying,
    strikeUsdPerUnderlying: input.rfq.instrument.strikeUsdPerUnderlying,
    timeToExpiryYears,
    volatilityDecimal: input.optionMarket.volatilityDecimal,
    annualRateDecimal: input.optionMarket.annualRateDecimal,
    kind: input.rfq.instrument.kind,
  });
  const shock = input.policy.costs.conservativeForwardShockBps / 10_000;
  const conservativeVolatility = Math.max(
    input.policy.marketData.minimumVolatilityDecimal,
    input.optionMarket.volatilityDecimal -
      input.policy.costs.conservativeVolatilityHaircutDecimal,
  );
  const scenarioValues: number[] = [];
  for (const forwardMultiplier of [1 - shock, 1, 1 + shock]) {
    for (const volatility of [
      conservativeVolatility,
      input.optionMarket.volatilityDecimal,
    ]) {
      scenarioValues.push(
        black76({
          forwardUsdPerUnderlying:
            input.optionMarket.forwardUsdPerUnderlying * forwardMultiplier,
          strikeUsdPerUnderlying: input.rfq.instrument.strikeUsdPerUnderlying,
          timeToExpiryYears,
          volatilityDecimal: volatility,
          annualRateDecimal: input.optionMarket.annualRateDecimal,
          kind: input.rfq.instrument.kind,
        }).premiumUsdPerUnderlying * makerQuantityUnderlying,
      );
    }
  }

  return { base, conservativeTotalUsd: Math.min(...scenarioValues) };
}

interface ReservationStressExposure {
  readonly optionDeltaUnderlying: number;
  readonly gammaUsdForOnePercentSquared: number;
  readonly vegaUsdPerVolPoint: number;
  readonly hedgeNotionalUsd: number;
}

function reservationStressExposure(
  input: QuoteDecisionInput,
  timeToExpiryYears: number,
  makerQuantityUnderlying: number,
): ReservationStressExposure {
  const spotMove = input.policy.reservationStress.spotMoveFraction;
  const volatilityMove =
    input.policy.reservationStress.volatilityMoveDecimal;
  const candidates: ReservationStressExposure[] = [];

  for (const priceMultiplier of [1 - spotMove, 1, 1 + spotMove]) {
    const scenarioSpot =
      input.optionMarket.spotUsdPerUnderlying * priceMultiplier;
    const scenarioForward =
      input.optionMarket.forwardUsdPerUnderlying * priceMultiplier;
    const scenarioHedgePrice =
      input.hedgeMarket.oraclePriceUsdPerUnderlying * priceMultiplier;
    for (const volatility of [
      Math.max(
        input.policy.marketData.minimumVolatilityDecimal,
        input.optionMarket.volatilityDecimal - volatilityMove,
      ),
      input.optionMarket.volatilityDecimal,
      Math.min(
        input.policy.marketData.maximumVolatilityDecimal,
        input.optionMarket.volatilityDecimal + volatilityMove,
      ),
    ]) {
      const result = black76({
        forwardUsdPerUnderlying: scenarioForward,
        strikeUsdPerUnderlying:
          input.rfq.instrument.strikeUsdPerUnderlying,
        timeToExpiryYears,
        volatilityDecimal: volatility,
        annualRateDecimal: input.optionMarket.annualRateDecimal,
        kind: input.rfq.instrument.kind,
      });
      const deltaUnderlying =
        makerQuantityUnderlying *
        forwardDeltaToHedgeUnderlying(
          result.forwardDelta,
          scenarioForward,
          scenarioHedgePrice,
          input.policy.hedge.crossVenueDeltaBeta,
        );
      const forwardToSpot = scenarioForward / scenarioSpot;
      const spotGammaPerUsd =
        result.forwardGammaPerUsd *
        (forwardToSpot * input.policy.hedge.crossVenueDeltaBeta) ** 2;
      const gammaUsdForOnePercentSquared =
        0.5 *
        spotGammaPerUsd *
        (scenarioSpot * 0.01) ** 2 *
        makerQuantityUnderlying;
      const vegaUsdPerVolPoint =
        result.vegaUsdPerVolPoint * makerQuantityUnderlying;
      candidates.push({
        optionDeltaUnderlying: deltaUnderlying,
        gammaUsdForOnePercentSquared,
        vegaUsdPerVolPoint,
        hedgeNotionalUsd:
          Math.abs(deltaUnderlying) * scenarioHedgePrice,
      });
    }
  }

  const greatestByAbsolute = (
    selector: (candidate: ReservationStressExposure) => number,
  ): number =>
    candidates.reduce((greatest, candidate) => {
      const value = selector(candidate);
      return Math.abs(value) > Math.abs(greatest) ? value : greatest;
    }, 0);

  return {
    optionDeltaUnderlying: greatestByAbsolute(
      (candidate) => candidate.optionDeltaUnderlying,
    ),
    gammaUsdForOnePercentSquared: greatestByAbsolute(
      (candidate) => candidate.gammaUsdForOnePercentSquared,
    ),
    vegaUsdPerVolPoint: greatestByAbsolute(
      (candidate) => candidate.vegaUsdPerVolPoint,
    ),
    hedgeNotionalUsd: Math.max(
      ...candidates.map((candidate) => candidate.hedgeNotionalUsd),
    ),
  };
}

export function evaluateQuote(input: QuoteDecisionInput): QuoteDecision {
  const gates: GateCheck[] = [];
  const check = (
    gate: string,
    passed: boolean,
    declineCode: DeclineReasonCode,
    detail: string,
    observed?: number | string | boolean,
    limit?: number | string | boolean,
  ): void => {
    gates.push({ gate, passed, declineCode, detail, observed, limit });
  };
  const failed = (): boolean => gates.some((gate) => !gate.passed);
  const { rfq, policy, optionMarket, hedgeMarket } = input;
  const instrument = rfq.instrument;

  const policyIssues = validatePolicy(policy);
  check(
    "valid shadow policy",
    policyIssues.length === 0,
    "INVALID_POLICY",
    policyIssues.length === 0
      ? "effective policy passed startup invariants"
      : policyIssues.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
  );
  const portfolioIssues = validatePortfolioRiskState(input.portfolio);
  check(
    "valid portfolio state",
    portfolioIssues.length === 0,
    "INVALID_PORTFOLIO_STATE",
    portfolioIssues.length === 0
      ? "confirmed and reserved risk inputs are finite and internally consistent"
      : portfolioIssues
          .map((issue) => `${issue.path}: ${issue.message}`)
          .join("; "),
  );
  check(
    "reservation version",
    Number.isSafeInteger(input.reservationLedgerVersion) &&
      input.reservationLedgerVersion >= 0 &&
      input.portfolio.reservations.every(
        (reservation) =>
          reservation.basedOnLedgerVersion <= input.reservationLedgerVersion,
      ),
    "INVALID_PORTFOLIO_STATE",
    "ledger version must be current and cover every supplied reservation",
    input.reservationLedgerVersion,
  );
  const hedgeOperationsAreValid =
    Number.isFinite(input.hedgeOperations.reconciledAtMs) &&
    Number.isSafeInteger(input.hedgeOperations.portfolioRevision) &&
    input.hedgeOperations.portfolioRevision >= 0 &&
    Number.isSafeInteger(input.hedgeOperations.pendingOrderCount) &&
    input.hedgeOperations.pendingOrderCount >= 0 &&
    Number.isFinite(
      input.hedgeOperations.residualPortfolioDeltaUnderlying,
    );
  check(
    "valid hedge operational state",
    hedgeOperationsAreValid,
    "HEDGE_RECONCILIATION_UNHEALTHY",
    "hedge reconciliation state must be finite and versioned",
  );
  check(
    "hedge reconciliation healthy",
    input.hedgeOperations.reconciliationHealthy,
    "HEDGE_RECONCILIATION_UNHEALTHY",
    "new quotes stop while position/order reconciliation is unhealthy",
    input.hedgeOperations.reconciliationHealthy,
    true,
  );
  check(
    "no hedge backlog",
    input.hedgeOperations.pendingOrderCount === 0,
    "HEDGE_BACKLOG_PRESENT",
    "new quotes stop while a hedge order remains pending",
    input.hedgeOperations.pendingOrderCount,
    0,
  );
  check(
    "existing residual delta",
    Math.abs(input.hedgeOperations.residualPortfolioDeltaUnderlying) <=
      policy.hedge.maximumResidualDeltaToQuoteUnderlying,
    "RESIDUAL_DELTA_LIMIT",
    "existing confirmed portfolio must be inside the quote-admission delta band",
    Math.abs(input.hedgeOperations.residualPortfolioDeltaUnderlying),
    policy.hedge.maximumResidualDeltaToQuoteUnderlying,
  );
  const reconciliationAgeMs =
    input.nowMs - input.hedgeOperations.reconciledAtMs;
  check(
    "fresh hedge reconciliation",
    reconciliationAgeMs >= -policy.timing.maximumClockSkewMs &&
      reconciliationAgeMs <=
        policy.marketData.maximumHedgeSnapshotAgeMs,
    "HEDGE_RECONCILIATION_UNHEALTHY",
    "position/order reconciliation must be fresh before quote admission",
    reconciliationAgeMs,
    policy.marketData.maximumHedgeSnapshotAgeMs,
  );
  if (failed()) return decline(input, gates);

  check(
    "rfq identifiers",
    rfq.rfqId.trim() !== "" &&
      input.quoteAttemptId.trim() !== "" &&
      instrument.instrumentId.trim() !== "" &&
      instrument.optionSubId.trim() !== "",
    "INVALID_RFQ",
    "RFQ, quote-attempt, instrument, and sub-ID identifiers must be non-empty",
  );
  check(
    "canonical instrument identity",
    instrument.identityVerified,
    "UNVERIFIED_INSTRUMENT",
    "instrument must be reconstructed and verified by a trusted local registry",
    instrument.identityVerified,
    true,
  );
  check(
    "approved option asset",
    policy.product.allowedOptionAssetAddresses.some(
      (address) =>
        address.toLowerCase() === instrument.optionAssetAddress.toLowerCase(),
    ),
    "UNSUPPORTED_ASSET",
    "option asset address is not locally approved",
    instrument.optionAssetAddress,
  );
  check(
    "supported underlying",
    instrument.underlying === policy.product.allowedUnderlying,
    "UNSUPPORTED_CURRENCY",
    "underlying is outside the v0 product mandate",
    instrument.underlying,
    policy.product.allowedUnderlying,
  );
  check(
    "supported settlement currency",
    policy.product.allowedSettlementCurrencies.includes(
      instrument.settlementCurrency,
    ),
    "UNSUPPORTED_CURRENCY",
    "settlement currency is not approved",
    instrument.settlementCurrency,
    policy.product.allowedSettlementCurrencies.join(","),
  );
  check(
    "maker buys option",
    rfq.direction === "TAKER_SELLS_OPTION",
    "UNSUPPORTED_DIRECTION",
    "v0 only receives options from a selling taker",
    rfq.direction,
    "TAKER_SELLS_OPTION",
  );
  check(
    "supported option kind",
    instrument.kind === "CALL",
    "UNSUPPORTED_OPTION_TYPE",
    "v0 quotes BTC calls only",
    instrument.kind,
    "CALL",
  );
  const makerQuantityUnderlying =
    rfq.quantityContracts * instrument.contractMultiplierUnderlying;
  check(
    "finite positive size",
    isFinitePositive(rfq.quantityContracts) &&
      isFinitePositive(instrument.contractMultiplierUnderlying) &&
      isFinitePositive(makerQuantityUnderlying),
    "INVALID_SIZE",
    "contract quantity, multiplier, and normalized quantity must be positive",
    makerQuantityUnderlying,
  );
  check(
    "size mandate",
    makerQuantityUnderlying >= policy.product.minimumQuantityUnderlying &&
      makerQuantityUnderlying <= policy.product.maximumQuantityUnderlying,
    "SIZE_OUTSIDE_LIMIT",
    "normalized option quantity must be inside configured bounds",
    makerQuantityUnderlying,
    `${policy.product.minimumQuantityUnderlying}..${policy.product.maximumQuantityUnderlying}`,
  );
  if (failed()) return decline(input, gates);

  const timeToExpiryMs = instrument.expiryMs - input.nowMs;
  check(
    "finite RFQ timeline",
    [
      input.nowMs,
      rfq.receivedAtMs,
      rfq.auctionEndsAtMs,
      rfq.takerAcceptanceEndsAtMs,
      instrument.expiryMs,
    ].every(Number.isFinite) &&
      rfq.receivedAtMs <= input.nowMs + policy.timing.maximumClockSkewMs &&
      input.nowMs - rfq.receivedAtMs <=
        policy.timing.maximumAuctionWindowMs +
          policy.timing.maximumClockSkewMs &&
      rfq.auctionEndsAtMs >= rfq.receivedAtMs,
    "INVALID_RFQ",
    "RFQ timestamps must be finite and receipt cannot exceed local clock skew",
  );
  check(
    "option not expired",
    timeToExpiryMs > 0,
    "OPTION_EXPIRED",
    "option expiry must be in the future",
    timeToExpiryMs,
    0,
  );
  check(
    "expiry mandate",
    timeToExpiryMs >= policy.product.minimumTimeToExpiryMs &&
      timeToExpiryMs <= policy.product.maximumTimeToExpiryMs,
    "EXPIRY_OUTSIDE_LIMIT",
    "time to expiry must be inside configured bounds",
    timeToExpiryMs,
    `${policy.product.minimumTimeToExpiryMs}..${policy.product.maximumTimeToExpiryMs}`,
  );
  const quoteHeadroomMs = rfq.auctionEndsAtMs - input.nowMs;
  check(
    "quote headroom",
    quoteHeadroomMs >= policy.timing.minimumQuoteHeadroomMs,
    "QUOTE_WINDOW_TOO_SHORT",
    "not enough time remains to publish and reserve a quote safely",
    quoteHeadroomMs,
    policy.timing.minimumQuoteHeadroomMs,
  );
  check(
    "locally bounded auction window",
    quoteHeadroomMs <= policy.timing.maximumAuctionWindowMs,
    "QUOTE_WINDOW_TOO_LONG",
    "server-provided auction end exceeds the local TTL bound",
    quoteHeadroomMs,
    policy.timing.maximumAuctionWindowMs,
  );
  const acceptanceWindowMs = rfq.takerAcceptanceEndsAtMs - input.nowMs;
  check(
    "locally bounded acceptance window",
    rfq.takerAcceptanceEndsAtMs >= rfq.auctionEndsAtMs &&
      acceptanceWindowMs <= policy.timing.maximumAcceptanceWindowMs,
    "ACCEPTANCE_WINDOW_INVALID",
    "acceptance must follow the auction and remain within the local bound",
    acceptanceWindowMs,
    policy.timing.maximumAcceptanceWindowMs,
  );
  if (failed()) return decline(input, gates);

  const optionNumbers = [
    optionMarket.spotUsdPerUnderlying,
    optionMarket.forwardUsdPerUnderlying,
    optionMarket.volatilityDecimal,
    optionMarket.annualRateDecimal,
    optionMarket.protocolAndOiFeesUsd,
    instrument.strikeUsdPerUnderlying,
  ];
  check(
    "valid option market values",
    optionNumbers.every(Number.isFinite) &&
      optionMarket.spotUsdPerUnderlying > 0 &&
      optionMarket.forwardUsdPerUnderlying > 0 &&
      instrument.strikeUsdPerUnderlying > 0 &&
      optionMarket.protocolAndOiFeesUsd >= 0,
    "INVALID_MARKET_DATA",
    "option inputs must be finite with positive prices and non-negative fees",
  );
  check(
    "option snapshot identity",
    optionMarket.meta.snapshotId.trim() !== "" &&
      optionMarket.meta.source.trim() !== "",
    "INVALID_MARKET_DATA",
    "option snapshot and source identifiers must be non-empty",
  );
  check(
    "option data health",
    optionMarket.meta.healthy,
    "OPTION_MARKET_DATA_UNHEALTHY",
    "option source reports unhealthy",
    optionMarket.meta.healthy,
    true,
  );
  const optionObservedAgeMs = input.nowMs - optionMarket.meta.observedAtMs;
  const optionReceivedAgeMs = input.nowMs - optionMarket.meta.receivedAtMs;
  check(
    "option timestamps not from future",
    optionObservedAgeMs >= -policy.timing.maximumClockSkewMs &&
      optionReceivedAgeMs >= -policy.timing.maximumClockSkewMs &&
      optionMarket.meta.observedAtMs <=
        optionMarket.meta.receivedAtMs + policy.timing.maximumClockSkewMs,
    "MARKET_DATA_FROM_FUTURE",
    "option snapshot exceeds permitted future clock skew",
    Math.min(optionObservedAgeMs, optionReceivedAgeMs),
    -policy.timing.maximumClockSkewMs,
  );
  check(
    "fresh option snapshot",
    optionObservedAgeMs <= policy.marketData.maximumOptionSnapshotAgeMs &&
      optionReceivedAgeMs <= policy.marketData.maximumOptionSnapshotAgeMs,
    "OPTION_MARKET_DATA_STALE",
    "option observed/received timestamps exceed freshness policy",
    Math.max(optionObservedAgeMs, optionReceivedAgeMs),
    policy.marketData.maximumOptionSnapshotAgeMs,
  );
  check(
    "option source confidence",
    Number.isFinite(optionMarket.meta.confidence) &&
      optionMarket.meta.confidence >= policy.marketData.minimumConfidence &&
      optionMarket.meta.confidence <= 1,
    "MARKET_CONFIDENCE_TOO_LOW",
    "option snapshot confidence is below policy",
    optionMarket.meta.confidence,
    policy.marketData.minimumConfidence,
  );
  check(
    "volatility mandate",
    optionMarket.volatilityDecimal >=
      policy.marketData.minimumVolatilityDecimal &&
      optionMarket.volatilityDecimal <=
        policy.marketData.maximumVolatilityDecimal,
    "VOLATILITY_OUTSIDE_LIMIT",
    "volatility is outside configured model bounds",
    optionMarket.volatilityDecimal,
    `${policy.marketData.minimumVolatilityDecimal}..${policy.marketData.maximumVolatilityDecimal}`,
  );
  check(
    "annual-rate mandate",
    optionMarket.annualRateDecimal >=
      policy.marketData.minimumAnnualRateDecimal &&
      optionMarket.annualRateDecimal <=
        policy.marketData.maximumAnnualRateDecimal,
    "RATE_OUTSIDE_LIMIT",
    "annualized rate is outside configured model bounds",
    optionMarket.annualRateDecimal,
    `${policy.marketData.minimumAnnualRateDecimal}..${policy.marketData.maximumAnnualRateDecimal}`,
  );
  const forwardSpotDeviationBps =
    (Math.abs(
      optionMarket.forwardUsdPerUnderlying -
        optionMarket.spotUsdPerUnderlying,
    ) /
      optionMarket.spotUsdPerUnderlying) *
    10_000;
  check(
    "forward/spot agreement",
    forwardSpotDeviationBps <=
      policy.marketData.maximumForwardSpotDeviationBps,
    "FORWARD_SPOT_DIVERGENCE",
    "option forward and spot diverge beyond the validated tenor bound",
    forwardSpotDeviationBps,
    policy.marketData.maximumForwardSpotDeviationBps,
  );
  if (failed()) return decline(input, gates);

  const moneyness =
    instrument.strikeUsdPerUnderlying /
    optionMarket.forwardUsdPerUnderlying;
  check(
    "moneyness mandate",
    moneyness >= policy.product.minimumMoneynessStrikeOverForward &&
      moneyness <= policy.product.maximumMoneynessStrikeOverForward,
    "MONEYNESS_OUTSIDE_LIMIT",
    "strike/forward ratio is outside configured bounds",
    moneyness,
    `${policy.product.minimumMoneynessStrikeOverForward}..${policy.product.maximumMoneynessStrikeOverForward}`,
  );

  const hedgeNumbers = [
    hedgeMarket.oraclePriceUsdPerUnderlying,
    hedgeMarket.markPriceUsdPerUnderlying,
    hedgeMarket.takerFeeRateDecimal,
    hedgeMarket.fundingRateHourlyDecimal,
    hedgeMarket.accountEquityUsd,
    hedgeMarket.currentMarginUsedUsd,
  ];
  check(
    "valid hedge market values",
    hedgeNumbers.every(Number.isFinite) &&
      hedgeMarket.oraclePriceUsdPerUnderlying > 0 &&
      hedgeMarket.markPriceUsdPerUnderlying > 0 &&
      hedgeMarket.takerFeeRateDecimal >= 0 &&
      hedgeMarket.takerFeeRateDecimal < 1 &&
      hedgeMarket.accountEquityUsd > 0 &&
      hedgeMarket.currentMarginUsedUsd >= 0 &&
      hedgeMarket.currentMarginUsedUsd <= hedgeMarket.accountEquityUsd,
    "INVALID_MARKET_DATA",
    "hedge inputs must be finite with positive prices and non-negative balances/fees",
  );
  check(
    "hedge snapshot identity",
    hedgeMarket.meta.snapshotId.trim() !== "" &&
      hedgeMarket.meta.source.trim() !== "",
    "INVALID_MARKET_DATA",
    "hedge snapshot and source identifiers must be non-empty",
  );
  check(
    "hedge instrument binding",
    hedgeMarket.venue === "HYPERLIQUID" &&
      hedgeMarket.coin === instrument.underlying &&
      hedgeMarket.network === policy.hedge.network &&
      hedgeMarket.accountAddress.toLowerCase() ===
        policy.hedge.accountAddress.toLowerCase(),
    "HEDGE_INSTRUMENT_MISMATCH",
    "hedge venue instrument must match the verified RFQ underlying",
    `${hedgeMarket.venue}:${hedgeMarket.network}:${hedgeMarket.accountAddress}:${hedgeMarket.coin}`,
    `HYPERLIQUID:${policy.hedge.network}:${policy.hedge.accountAddress}:${instrument.underlying}`,
  );
  const bookLevelsAreValid =
    hedgeMarket.bids.length > 0 &&
    hedgeMarket.asks.length > 0 &&
    hedgeMarket.bids.every(isValidBookLevel) &&
    hedgeMarket.asks.every(isValidBookLevel);
  const bestBid = bookLevelsAreValid
    ? Math.max(
        ...hedgeMarket.bids.map((level) => level.priceUsdPerUnderlying),
      )
    : Number.NaN;
  const bestAsk = bookLevelsAreValid
    ? Math.min(
        ...hedgeMarket.asks.map((level) => level.priceUsdPerUnderlying),
      )
    : Number.NaN;
  check(
    "valid two-sided hedge book",
    bookLevelsAreValid && bestBid < bestAsk,
    "HEDGE_BOOK_INVALID",
    "hedge L2 must contain finite positive quantities and a non-crossed two-sided book",
    bookLevelsAreValid ? `${bestBid}/${bestAsk}` : "invalid levels",
  );
  const hedgeBookSpreadBps =
    ((bestAsk - bestBid) / ((bestAsk + bestBid) / 2)) * 10_000;
  check(
    "hedge book spread",
    Number.isFinite(hedgeBookSpreadBps) &&
      hedgeBookSpreadBps <=
        policy.marketData.maximumHedgeBookSpreadBps,
    "HEDGE_SPREAD_TOO_WIDE",
    "Hyperliquid top-of-book spread exceeds quote-admission policy",
    hedgeBookSpreadBps,
    policy.marketData.maximumHedgeBookSpreadBps,
  );
  check(
    "hedge venue health",
    hedgeMarket.meta.healthy,
    "HEDGE_VENUE_UNHEALTHY",
    "hedge venue reports unhealthy",
    hedgeMarket.meta.healthy,
    true,
  );
  const hedgeObservedAgeMs = input.nowMs - hedgeMarket.meta.observedAtMs;
  const hedgeReceivedAgeMs = input.nowMs - hedgeMarket.meta.receivedAtMs;
  check(
    "hedge timestamps not from future",
    hedgeObservedAgeMs >= -policy.timing.maximumClockSkewMs &&
      hedgeReceivedAgeMs >= -policy.timing.maximumClockSkewMs &&
      hedgeMarket.meta.observedAtMs <=
        hedgeMarket.meta.receivedAtMs + policy.timing.maximumClockSkewMs,
    "MARKET_DATA_FROM_FUTURE",
    "hedge snapshot exceeds permitted future clock skew",
    Math.min(hedgeObservedAgeMs, hedgeReceivedAgeMs),
    -policy.timing.maximumClockSkewMs,
  );
  check(
    "fresh hedge snapshot",
    hedgeObservedAgeMs <= policy.marketData.maximumHedgeSnapshotAgeMs &&
      hedgeReceivedAgeMs <= policy.marketData.maximumHedgeSnapshotAgeMs,
    "HEDGE_MARKET_DATA_STALE",
    "hedge observed/received timestamps exceed freshness policy",
    Math.max(hedgeObservedAgeMs, hedgeReceivedAgeMs),
    policy.marketData.maximumHedgeSnapshotAgeMs,
  );
  check(
    "hedge source confidence",
    Number.isFinite(hedgeMarket.meta.confidence) &&
      hedgeMarket.meta.confidence >= policy.marketData.minimumConfidence &&
      hedgeMarket.meta.confidence <= 1,
    "MARKET_CONFIDENCE_TOO_LOW",
    "hedge snapshot confidence is below policy",
    hedgeMarket.meta.confidence,
    policy.marketData.minimumConfidence,
  );
  const markOracleDeviationBps =
    (Math.abs(
      hedgeMarket.markPriceUsdPerUnderlying -
        hedgeMarket.oraclePriceUsdPerUnderlying,
    ) /
      hedgeMarket.oraclePriceUsdPerUnderlying) *
    10_000;
  check(
    "mark/oracle agreement",
    markOracleDeviationBps <=
      policy.marketData.maximumMarkOracleDeviationBps,
    "HEDGE_MARK_ORACLE_DIVERGENCE",
    "Hyperliquid mark and oracle diverge beyond policy",
    markOracleDeviationBps,
    policy.marketData.maximumMarkOracleDeviationBps,
  );
  const optionSpotHedgeOracleDeviationBps =
    (Math.abs(
      optionMarket.spotUsdPerUnderlying -
        hedgeMarket.oraclePriceUsdPerUnderlying,
    ) /
      optionMarket.spotUsdPerUnderlying) *
    10_000;
  check(
    "cross-venue spot/oracle agreement",
    optionSpotHedgeOracleDeviationBps <=
      policy.marketData.maximumOptionSpotHedgeOracleDeviationBps,
    "CROSS_VENUE_SPOT_DIVERGENCE",
    "option spot and Hyperliquid oracle diverge beyond basis policy",
    optionSpotHedgeOracleDeviationBps,
    policy.marketData.maximumOptionSpotHedgeOracleDeviationBps,
  );
  if (failed()) return decline(input, gates);

  const timeToExpiryYears = timeToExpiryMs / YEAR_MS;
  const { base, conservativeTotalUsd } = conservativeValue(
    input,
    timeToExpiryYears,
    makerQuantityUnderlying,
  );
  const hedgeDeltaPerUnderlying = forwardDeltaToHedgeUnderlying(
    base.forwardDelta,
    optionMarket.forwardUsdPerUnderlying,
    hedgeMarket.oraclePriceUsdPerUnderlying,
    policy.hedge.crossVenueDeltaBeta,
  );
  const hedgeDeltaUnderlying =
    makerQuantityUnderlying * hedgeDeltaPerUnderlying;
  const hedgeSide = hedgeDeltaUnderlying >= 0 ? "SELL" : "BUY";
  const hedgeQuantityUnderlying = Math.abs(hedgeDeltaUnderlying);
  const stressedExposure = reservationStressExposure(
    input,
    timeToExpiryYears,
    makerQuantityUnderlying,
  );
  const modelOutputs = [
    base.premiumUsdPerUnderlying,
    base.forwardDelta,
    base.forwardGammaPerUsd,
    base.vegaUsdPerVolPoint,
    base.calendarThetaUsdPerDay,
    conservativeTotalUsd,
    hedgeDeltaUnderlying,
    stressedExposure.optionDeltaUnderlying,
    stressedExposure.gammaUsdForOnePercentSquared,
    stressedExposure.vegaUsdPerVolPoint,
    stressedExposure.hedgeNotionalUsd,
  ];
  check(
    "finite non-negative model output",
    modelOutputs.every(Number.isFinite) &&
      base.premiumUsdPerUnderlying >= 0 &&
      conservativeTotalUsd >= 0,
    "INVALID_MARKET_DATA",
    "pricing and Greek outputs must be finite and option values non-negative",
  );
  if (failed()) return decline(input, gates);

  const hedgeInsideNoTradeBand =
    hedgeQuantityUnderlying <= policy.hedge.noTradeBandUnderlying;
  const initialHedgeNotionalAtOracleUsd =
    hedgeQuantityUnderlying * hedgeMarket.oraclePriceUsdPerUnderlying;
  check(
    "minimum hedge order notional",
    hedgeInsideNoTradeBand ||
      initialHedgeNotionalAtOracleUsd >=
        policy.hedge.minimumOrderNotionalUsd,
    "HEDGE_ORDER_BELOW_MINIMUM",
    "required hedge is outside the no-trade band but below venue order minimum",
    initialHedgeNotionalAtOracleUsd,
    policy.hedge.minimumOrderNotionalUsd,
  );
  if (failed()) return decline(input, gates);
  const hedgeExecution: BookExecution = hedgeInsideNoTradeBand
    ? {
        side: hedgeSide,
        requestedQuantityUnderlying: 0,
        filledQuantityUnderlying: 0,
        unfilledQuantityUnderlying: 0,
        executable: true,
        vwapUsdPerUnderlying: null,
        worstPriceUsdPerUnderlying: null,
        adverseSlippageBps: 0,
        tradedNotionalUsd: 0,
      }
    : simulateBoundedIoc(
        hedgeSide,
        hedgeQuantityUnderlying,
        hedgeMarket.oraclePriceUsdPerUnderlying,
        policy.hedge.maximumAdverseSlippageBps,
        hedgeMarket.bids,
        hedgeMarket.asks,
      );
  check(
    "executable hedge depth",
    hedgeExecution.executable,
    "HEDGE_DEPTH_INSUFFICIENT",
    "fresh directional L2 depth cannot fill the initial delta hedge inside policy",
    hedgeExecution.filledQuantityUnderlying,
    hedgeExecution.requestedQuantityUnderlying,
  );
  if (failed()) return decline(input, gates);

  const modelFairValueUsd =
    base.premiumUsdPerUnderlying * makerQuantityUnderlying;
  const initialHedgeNotionalUsd = initialHedgeNotionalAtOracleUsd;
  const hedgeInitialMarginUsd =
    stressedExposure.hedgeNotionalUsd *
    (policy.hedge.initialMarginFraction +
      policy.hedge.collateralStressMoveFraction);
  const reservedMarginBeforeCandidate = input.portfolio.reservations.reduce(
    (total, reservation) =>
      reservation.reservationId === `rfq:${rfq.rfqId}`
        ? total
        : total + reservation.exposure.hedgeInitialMarginUsd,
    0,
  );
  const stressedMarginUsageUsd =
    hedgeMarket.currentMarginUsedUsd +
    reservedMarginBeforeCandidate +
    hedgeInitialMarginUsd;
  const permittedMarginUsageUsd =
    hedgeMarket.accountEquityUsd *
    policy.hedge.maximumCollateralUsageFraction;
  check(
    "independent hedge collateral",
    stressedMarginUsageUsd <= permittedMarginUsageUsd,
    "HEDGE_MARGIN_INSUFFICIENT",
    "Hyperliquid collateral does not cover current, reserved, and stressed candidate margin",
    stressedMarginUsageUsd,
    permittedMarginUsageUsd,
  );
  if (failed()) return decline(input, gates);

  const forwardToSpot =
    optionMarket.forwardUsdPerUnderlying /
    optionMarket.spotUsdPerUnderlying;
  const spotGammaPerUsd =
    base.forwardGammaPerUsd *
    (forwardToSpot * policy.hedge.crossVenueDeltaBeta) ** 2;
  const gammaUsdForOnePercentSquared =
    0.5 *
    spotGammaPerUsd *
    (optionMarket.spotUsdPerUnderlying * 0.01) ** 2 *
    makerQuantityUnderlying;
  const vegaUsdPerVolPoint =
    base.vegaUsdPerVolPoint * makerQuantityUnderlying;
  const preliminaryExposure: RiskExposure = {
    netOptionDeltaUnderlying: stressedExposure.optionDeltaUnderlying,
    netGammaUsdForOnePercentSquared:
      stressedExposure.gammaUsdForOnePercentSquared,
    grossGammaUsdForOnePercentSquared: Math.abs(
      stressedExposure.gammaUsdForOnePercentSquared,
    ),
    netVegaUsdPerVolPoint: stressedExposure.vegaUsdPerVolPoint,
    grossVegaUsdPerVolPoint: Math.abs(
      stressedExposure.vegaUsdPerVolPoint,
    ),
    grossOptionNotionalUsd:
      makerQuantityUnderlying * optionMarket.forwardUsdPerUnderlying,
    protocolCashOutflowUsd:
      conservativeTotalUsd + optionMarket.protocolAndOiFeesUsd,
    hedgeNotionalUsd: stressedExposure.hedgeNotionalUsd,
    hedgeInitialMarginUsd,
  };
  const expiryBucket = expiryBucketUtc(instrument.expiryMs);
  const preliminarySlice: RiskSlice = {
    expiryBucket,
    exposure: preliminaryExposure,
  };
  const portfolioWithoutReplacedReservation: PortfolioRiskState = {
    ...input.portfolio,
    reservations: input.portfolio.reservations.filter(
      (reservation) => reservation.reservationId !== `rfq:${rfq.rfqId}`,
    ),
  };
  const preUtilization = maximumRiskUtilization(
    portfolioWithoutReplacedReservation,
    null,
    policy.risk,
  );
  const postUtilization = maximumRiskUtilization(
    portfolioWithoutReplacedReservation,
    preliminarySlice,
    policy.risk,
  );
  const hedgeVwap =
    hedgeExecution.vwapUsdPerUnderlying ??
    hedgeMarket.oraclePriceUsdPerUnderlying;
  const adverseHedgePriceCostUsd =
    hedgeSide === "SELL"
      ? Math.max(
          0,
          hedgeMarket.oraclePriceUsdPerUnderlying - hedgeVwap,
        ) * hedgeQuantityUnderlying
      : Math.max(
          0,
          hedgeVwap - hedgeMarket.oraclePriceUsdPerUnderlying,
        ) * hedgeQuantityUnderlying;
  const initialHedgeTakerFeeUsd =
    hedgeExecution.tradedNotionalUsd * hedgeMarket.takerFeeRateDecimal;
  const expectedRehedgingCostUsd =
    initialHedgeNotionalUsd *
    policy.costs.expectedRehedgeTurnover *
    (hedgeMarket.takerFeeRateDecimal +
      policy.costs.expectedRehedgeSlippageBps / 10_000);
  const currentAdverseFundingRate =
    hedgeSide === "SELL"
      ? Math.max(0, -hedgeMarket.fundingRateHourlyDecimal)
      : Math.max(0, hedgeMarket.fundingRateHourlyDecimal);
  const expectedFundingCostUsd =
    initialHedgeNotionalUsd *
    policy.costs.expectedHoldingHours *
    (currentAdverseFundingRate +
      policy.costs.fundingStressBpsPerHour / 10_000);
  const concentrationIncrease = Math.max(
    0,
    postUtilization ** 2 - preUtilization ** 2,
  );
  const requiredProfitUsd = Math.max(
    policy.costs.minimumRequiredProfitUsd,
    conservativeTotalUsd *
      (policy.costs.requiredProfitBpsOfFairValue / 10_000),
  );
  const costs: QuoteCostBreakdown = {
    protocolAndOiFeesUsd: optionMarket.protocolAndOiFeesUsd,
    initialHedgeSpreadSlippageUsd: adverseHedgePriceCostUsd,
    initialHedgeTakerFeeUsd,
    expectedRehedgingCostUsd,
    expectedFundingCostUsd,
    basisSettlementLatencyChargeUsd:
      initialHedgeNotionalUsd *
      (policy.costs.basisSettlementLatencyBps / 10_000),
    adverseSelectionChargeUsd:
      conservativeTotalUsd *
      (policy.costs.adverseSelectionBpsOfFairValue / 10_000),
    modelRiskChargeUsd:
      conservativeTotalUsd *
      (policy.costs.modelRiskBpsOfFairValue / 10_000),
    capitalChargeUsd:
      hedgeInitialMarginUsd *
      (policy.costs.capitalChargeBpsOfMargin / 10_000),
    incrementalPortfolioRiskChargeUsd:
      conservativeTotalUsd *
      (policy.costs.maximumConcentrationChargeBpsOfFairValue / 10_000) *
      concentrationIncrease,
    requiredProfitUsd,
  };
  const totalDeductionsUsd = sumCosts(costs);
  const reservationBidCeilingUsd =
    conservativeTotalUsd - totalDeductionsUsd;
  check(
    "positive reservation bid ceiling",
    reservationBidCeilingUsd > 0,
    "NON_POSITIVE_RESERVATION_BID",
    "conservative fair value does not cover costs and required profit",
    reservationBidCeilingUsd,
    0,
  );
  if (failed()) return decline(input, gates);

  const shadedCeilingUsd =
    reservationBidCeilingUsd *
    (1 - policy.quote.quoteShadeBpsFromReservationCeiling / 10_000);
  const quotedUnitPremiumUsdPerUnderlying = floorToTick(
    shadedCeilingUsd / makerQuantityUnderlying,
    policy.quote.premiumTickUsdPerUnderlying,
  );
  const quotedTotalPremiumUsd =
    quotedUnitPremiumUsdPerUnderlying * makerQuantityUnderlying;
  check(
    "minimum executable premium",
    quotedTotalPremiumUsd >= policy.quote.minimumTotalPremiumUsd &&
      quotedUnitPremiumUsdPerUnderlying > 0,
    "BID_BELOW_MINIMUM",
    "tick-rounded bid is below the configured minimum",
    quotedTotalPremiumUsd,
    policy.quote.minimumTotalPremiumUsd,
  );
  if (failed()) return decline(input, gates);

  const finalExposure: RiskExposure = {
    ...preliminaryExposure,
    protocolCashOutflowUsd:
      quotedTotalPremiumUsd + optionMarket.protocolAndOiFeesUsd,
  };
  const candidateSlice: RiskSlice = {
    expiryBucket,
    exposure: finalExposure,
  };
  const riskBreaches = evaluateRiskLimits(
    portfolioWithoutReplacedReservation,
    candidateSlice,
    policy.risk,
  );
  for (const breach of riskBreaches) {
    check(
      `portfolio ${breach.code.toLowerCase()}`,
      false,
      breach.code,
      "candidate plus all live reservations exceeds a hard portfolio limit",
      breach.observed,
      breach.limit,
    );
  }
  if (riskBreaches.length === 0) {
    check(
      "portfolio limits",
      true,
      "DELTA_LIMIT",
      "candidate and all live reservations remain inside every hard risk limit",
    );
  }
  if (failed()) return decline(input, gates);

  const reservation: RiskReservation = {
    reservationId: `rfq:${rfq.rfqId}`,
    rfqId: rfq.rfqId,
    basedOnLedgerVersion: input.reservationLedgerVersion,
    expiresAtMs:
      rfq.takerAcceptanceEndsAtMs +
      policy.timing.reservationFinalityBufferMs,
    expiryBucket,
    exposure: finalExposure,
  };
  const economics: QuoteEconomics = {
    modelFairValueUsd,
    conservativeFairValueUsd: conservativeTotalUsd,
    costs,
    totalDeductionsUsd,
    reservationBidCeilingUsd,
    quotedTotalPremiumUsd,
    quotedUnitPremiumUsdPerUnderlying,
    expectedModelEdgeUsd:
      modelFairValueUsd - quotedTotalPremiumUsd -
      (totalDeductionsUsd - requiredProfitUsd),
  };

  return {
    kind: "QUOTE",
    rfqId: rfq.rfqId,
    economics,
    greeks: {
      makerOptionQuantityUnderlying: makerQuantityUnderlying,
      forwardDeltaPerUnderlying: base.forwardDelta,
      hedgeDeltaUnderlying,
      gammaUsdForOnePercentSquared,
      vegaUsdPerVolPoint,
      thetaUsdPerDay:
        base.calendarThetaUsdPerDay * makerQuantityUnderlying,
    },
    initialHedgePreview: hedgeExecution,
    reservation,
    diagnostics: makeDiagnostics(input, gates),
  };
}
