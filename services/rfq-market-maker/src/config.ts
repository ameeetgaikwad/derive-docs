import type { RiskLimits } from "./risk/exposures.js";

export interface ProductPolicy {
  readonly allowedUnderlying: string;
  readonly allowedSettlementCurrencies: readonly string[];
  readonly allowedOptionKinds: readonly "CALL"[];
  readonly allowedOptionAssetAddresses: readonly string[];
  readonly minimumQuantityUnderlying: number;
  readonly maximumQuantityUnderlying: number;
  readonly minimumMoneynessStrikeOverForward: number;
  readonly maximumMoneynessStrikeOverForward: number;
  readonly minimumTimeToExpiryMs: number;
  readonly maximumTimeToExpiryMs: number;
}

export interface TimingPolicy {
  readonly minimumQuoteHeadroomMs: number;
  readonly maximumAuctionWindowMs: number;
  readonly maximumAcceptanceWindowMs: number;
  readonly reservationFinalityBufferMs: number;
  readonly maximumClockSkewMs: number;
}

export interface MarketDataPolicy {
  readonly maximumOptionSnapshotAgeMs: number;
  readonly maximumHedgeSnapshotAgeMs: number;
  readonly minimumConfidence: number;
  readonly minimumVolatilityDecimal: number;
  readonly maximumVolatilityDecimal: number;
  readonly minimumAnnualRateDecimal: number;
  readonly maximumAnnualRateDecimal: number;
  readonly maximumForwardSpotDeviationBps: number;
  readonly maximumOptionSpotHedgeOracleDeviationBps: number;
  readonly maximumMarkOracleDeviationBps: number;
  readonly maximumHedgeBookSpreadBps: number;
}

export interface HedgePolicy {
  readonly network: "MAINNET" | "TESTNET";
  readonly accountAddress: string;
  readonly crossVenueDeltaBeta: number;
  readonly maximumAdverseSlippageBps: number;
  readonly initialMarginFraction: number;
  readonly collateralStressMoveFraction: number;
  readonly maximumCollateralUsageFraction: number;
  readonly noTradeBandUnderlying: number;
  readonly maximumResidualDeltaToQuoteUnderlying: number;
  readonly lotSizeUnderlying: number;
  readonly priceTickUsd: number;
  readonly minimumOrderNotionalUsd: number;
  readonly orderExpiryMs: number;
}

export interface CostPolicy {
  readonly conservativeForwardShockBps: number;
  readonly conservativeVolatilityHaircutDecimal: number;
  readonly expectedRehedgeTurnover: number;
  readonly expectedRehedgeSlippageBps: number;
  readonly expectedHoldingHours: number;
  readonly fundingStressBpsPerHour: number;
  readonly basisSettlementLatencyBps: number;
  readonly adverseSelectionBpsOfFairValue: number;
  readonly modelRiskBpsOfFairValue: number;
  readonly capitalChargeBpsOfMargin: number;
  readonly maximumConcentrationChargeBpsOfFairValue: number;
  readonly requiredProfitBpsOfFairValue: number;
  readonly minimumRequiredProfitUsd: number;
}

export interface QuotePolicy {
  readonly premiumTickUsdPerUnderlying: number;
  readonly minimumTotalPremiumUsd: number;
  readonly quoteShadeBpsFromReservationCeiling: number;
}

export interface ReservationStressPolicy {
  /** Symmetric forward/spot shock used to reserve possible fill Greeks. */
  readonly spotMoveFraction: number;
  /** Symmetric absolute IV shock, e.g. 0.20 means twenty volatility points. */
  readonly volatilityMoveDecimal: number;
}

export interface MarketMakerPolicy {
  readonly mode: "SHADOW";
  readonly policyVersion: string;
  readonly modelVersion: string;
  readonly product: ProductPolicy;
  readonly timing: TimingPolicy;
  readonly marketData: MarketDataPolicy;
  readonly hedge: HedgePolicy;
  readonly costs: CostPolicy;
  readonly quote: QuotePolicy;
  readonly reservationStress: ReservationStressPolicy;
  readonly risk: RiskLimits;
}

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

/** Example limits are intentionally small and are not approved live limits. */
export const DEFAULT_SHADOW_POLICY: MarketMakerPolicy = Object.freeze<MarketMakerPolicy>({
  mode: "SHADOW",
  policyVersion: "shadow-policy-v0.1.0",
  modelVersion: "black76-v0.1.0",
  product: {
    allowedUnderlying: "BTC",
    allowedSettlementCurrencies: ["USDT"],
    allowedOptionKinds: ["CALL"],
    allowedOptionAssetAddresses: [
      "0x0000000000000000000000000000000000000001",
    ],
    minimumQuantityUnderlying: 0.01,
    maximumQuantityUnderlying: 1,
    minimumMoneynessStrikeOverForward: 0.5,
    maximumMoneynessStrikeOverForward: 1.5,
    minimumTimeToExpiryMs: DAY_MS,
    maximumTimeToExpiryMs: 90 * DAY_MS,
  },
  timing: {
    minimumQuoteHeadroomMs: 500,
    maximumAuctionWindowMs: 2 * 60 * 1_000,
    maximumAcceptanceWindowMs: 10 * 60 * 1_000,
    reservationFinalityBufferMs: 2 * 60 * 1_000,
    maximumClockSkewMs: 1_000,
  },
  marketData: {
    maximumOptionSnapshotAgeMs: 2_000,
    maximumHedgeSnapshotAgeMs: 1_000,
    minimumConfidence: 0.99,
    minimumVolatilityDecimal: 0.05,
    maximumVolatilityDecimal: 2.5,
    minimumAnnualRateDecimal: -0.2,
    maximumAnnualRateDecimal: 1,
    maximumForwardSpotDeviationBps: 2_000,
    maximumOptionSpotHedgeOracleDeviationBps: 100,
    maximumMarkOracleDeviationBps: 30,
    maximumHedgeBookSpreadBps: 30,
  },
  hedge: {
    network: "TESTNET",
    accountAddress: "0x0000000000000000000000000000000000000002",
    crossVenueDeltaBeta: 1,
    maximumAdverseSlippageBps: 20,
    initialMarginFraction: 0.2,
    collateralStressMoveFraction: 0.15,
    maximumCollateralUsageFraction: 0.5,
    noTradeBandUnderlying: 0.005,
    maximumResidualDeltaToQuoteUnderlying: 0.01,
    lotSizeUnderlying: 0.001,
    priceTickUsd: 1,
    minimumOrderNotionalUsd: 10,
    orderExpiryMs: 5_000,
  },
  costs: {
    conservativeForwardShockBps: 10,
    conservativeVolatilityHaircutDecimal: 0.01,
    expectedRehedgeTurnover: 1.5,
    expectedRehedgeSlippageBps: 5,
    expectedHoldingHours: 24,
    fundingStressBpsPerHour: 0.05,
    basisSettlementLatencyBps: 10,
    adverseSelectionBpsOfFairValue: 50,
    modelRiskBpsOfFairValue: 50,
    capitalChargeBpsOfMargin: 20,
    maximumConcentrationChargeBpsOfFairValue: 100,
    requiredProfitBpsOfFairValue: 100,
    minimumRequiredProfitUsd: 5,
  },
  quote: {
    premiumTickUsdPerUnderlying: 0.01,
    minimumTotalPremiumUsd: 10,
    quoteShadeBpsFromReservationCeiling: 10,
  },
  reservationStress: {
    spotMoveFraction: 0.15,
    volatilityMoveDecimal: 0.2,
  },
  risk: {
    maxAbsNetOptionDeltaUnderlying: 5,
    maxGrossGammaUsdForOnePercentSquared: 10_000,
    maxGrossVegaUsdPerVolPoint: 5_000,
    maxGrossVegaUsdPerVolPointPerExpiry: 2_000,
    maxGrossOptionNotionalUsd: 500_000,
    maxProtocolCashOutflowUsd: 100_000,
    maxHedgeNotionalUsd: 300_000,
    maxHedgeInitialMarginUsd: 150_000,
    maxLiveReservations: 20,
    maxDailyLossUsd: 10_000,
  },
});

export interface PolicyValidationIssue {
  readonly path: string;
  readonly message: string;
}

export function validatePolicy(
  policy: MarketMakerPolicy,
): readonly PolicyValidationIssue[] {
  const issues: PolicyValidationIssue[] = [];
  const positive = (path: string, value: number): void => {
    if (!Number.isFinite(value) || value <= 0) {
      issues.push({ path, message: "must be finite and greater than zero" });
    }
  };
  const nonNegative = (path: string, value: number): void => {
    if (!Number.isFinite(value) || value < 0) {
      issues.push({ path, message: "must be finite and non-negative" });
    }
  };
  const fraction = (path: string, value: number): void => {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      issues.push({ path, message: "must be a finite fraction in [0, 1]" });
    }
  };
  const evmAddress = /^0x[0-9a-fA-F]{40}$/;

  if (policy.mode !== "SHADOW") {
    issues.push({ path: "mode", message: "v0 supports SHADOW only" });
  }
  if (policy.policyVersion.trim() === "") {
    issues.push({ path: "policyVersion", message: "must be non-empty" });
  }
  if (policy.modelVersion.trim() === "") {
    issues.push({ path: "modelVersion", message: "must be non-empty" });
  }
  if (policy.product.allowedOptionAssetAddresses.length === 0) {
    issues.push({
      path: "product.allowedOptionAssetAddresses",
      message: "must contain at least one locally approved asset",
    });
  }
  if (policy.product.allowedUnderlying.trim() === "") {
    issues.push({
      path: "product.allowedUnderlying",
      message: "must be non-empty",
    });
  }
  if (policy.product.allowedSettlementCurrencies.length === 0) {
    issues.push({
      path: "product.allowedSettlementCurrencies",
      message: "must contain at least one currency",
    });
  }
  for (const [index, address] of
    policy.product.allowedOptionAssetAddresses.entries()) {
    if (!evmAddress.test(address)) {
      issues.push({
        path: `product.allowedOptionAssetAddresses[${index}]`,
        message: "must be a 20-byte 0x-prefixed address",
      });
    }
  }
  if (
    new Set(
      policy.product.allowedOptionAssetAddresses.map((address) =>
        address.toLowerCase(),
      ),
    ).size !== policy.product.allowedOptionAssetAddresses.length
  ) {
    issues.push({
      path: "product.allowedOptionAssetAddresses",
      message: "must not contain duplicates",
    });
  }
  if (
    policy.product.allowedSettlementCurrencies.some(
      (currency) => currency.trim() === "",
    ) ||
    new Set(policy.product.allowedSettlementCurrencies).size !==
      policy.product.allowedSettlementCurrencies.length
  ) {
    issues.push({
      path: "product.allowedSettlementCurrencies",
      message: "must contain unique non-empty values",
    });
  }
  positive(
    "product.minimumQuantityUnderlying",
    policy.product.minimumQuantityUnderlying,
  );
  positive(
    "product.maximumQuantityUnderlying",
    policy.product.maximumQuantityUnderlying,
  );
  if (
    policy.product.minimumQuantityUnderlying >
    policy.product.maximumQuantityUnderlying
  ) {
    issues.push({
      path: "product.minimumQuantityUnderlying",
      message: "must not exceed maximumQuantityUnderlying",
    });
  }
  positive(
    "product.minimumMoneynessStrikeOverForward",
    policy.product.minimumMoneynessStrikeOverForward,
  );
  positive(
    "product.maximumMoneynessStrikeOverForward",
    policy.product.maximumMoneynessStrikeOverForward,
  );
  if (
    policy.product.minimumMoneynessStrikeOverForward >
    policy.product.maximumMoneynessStrikeOverForward
  ) {
    issues.push({
      path: "product.minimumMoneynessStrikeOverForward",
      message: "must not exceed maximumMoneynessStrikeOverForward",
    });
  }
  positive(
    "product.minimumTimeToExpiryMs",
    policy.product.minimumTimeToExpiryMs,
  );
  positive(
    "product.maximumTimeToExpiryMs",
    policy.product.maximumTimeToExpiryMs,
  );
  if (
    policy.product.minimumTimeToExpiryMs >
    policy.product.maximumTimeToExpiryMs
  ) {
    issues.push({
      path: "product.minimumTimeToExpiryMs",
      message: "must not exceed maximumTimeToExpiryMs",
    });
  }
  nonNegative(
    "timing.minimumQuoteHeadroomMs",
    policy.timing.minimumQuoteHeadroomMs,
  );
  positive(
    "timing.maximumAuctionWindowMs",
    policy.timing.maximumAuctionWindowMs,
  );
  positive(
    "timing.maximumAcceptanceWindowMs",
    policy.timing.maximumAcceptanceWindowMs,
  );
  if (
    policy.timing.minimumQuoteHeadroomMs >
    policy.timing.maximumAuctionWindowMs
  ) {
    issues.push({
      path: "timing.minimumQuoteHeadroomMs",
      message: "must not exceed maximumAuctionWindowMs",
    });
  }
  nonNegative(
    "timing.reservationFinalityBufferMs",
    policy.timing.reservationFinalityBufferMs,
  );
  nonNegative("timing.maximumClockSkewMs", policy.timing.maximumClockSkewMs);
  positive(
    "marketData.maximumOptionSnapshotAgeMs",
    policy.marketData.maximumOptionSnapshotAgeMs,
  );
  positive(
    "marketData.maximumHedgeSnapshotAgeMs",
    policy.marketData.maximumHedgeSnapshotAgeMs,
  );
  fraction("marketData.minimumConfidence", policy.marketData.minimumConfidence);
  positive(
    "marketData.minimumVolatilityDecimal",
    policy.marketData.minimumVolatilityDecimal,
  );
  positive(
    "marketData.maximumVolatilityDecimal",
    policy.marketData.maximumVolatilityDecimal,
  );
  if (
    policy.marketData.minimumVolatilityDecimal >
    policy.marketData.maximumVolatilityDecimal
  ) {
    issues.push({
      path: "marketData.minimumVolatilityDecimal",
      message: "must not exceed maximumVolatilityDecimal",
    });
  }
  if (
    !Number.isFinite(policy.marketData.minimumAnnualRateDecimal) ||
    !Number.isFinite(policy.marketData.maximumAnnualRateDecimal) ||
    policy.marketData.minimumAnnualRateDecimal >
      policy.marketData.maximumAnnualRateDecimal
  ) {
    issues.push({
      path: "marketData.minimumAnnualRateDecimal",
      message: "annual-rate bounds must be finite and ordered",
    });
  }
  nonNegative(
    "marketData.maximumForwardSpotDeviationBps",
    policy.marketData.maximumForwardSpotDeviationBps,
  );
  nonNegative(
    "marketData.maximumOptionSpotHedgeOracleDeviationBps",
    policy.marketData.maximumOptionSpotHedgeOracleDeviationBps,
  );
  nonNegative(
    "marketData.maximumMarkOracleDeviationBps",
    policy.marketData.maximumMarkOracleDeviationBps,
  );
  nonNegative(
    "marketData.maximumHedgeBookSpreadBps",
    policy.marketData.maximumHedgeBookSpreadBps,
  );
  positive("hedge.crossVenueDeltaBeta", policy.hedge.crossVenueDeltaBeta);
  if (!evmAddress.test(policy.hedge.accountAddress)) {
    issues.push({
      path: "hedge.accountAddress",
      message: "must bind decisions to a 20-byte 0x-prefixed account",
    });
  }
  if (policy.hedge.network !== "MAINNET" && policy.hedge.network !== "TESTNET") {
    issues.push({
      path: "hedge.network",
      message: "must be MAINNET or TESTNET",
    });
  }
  nonNegative(
    "hedge.maximumAdverseSlippageBps",
    policy.hedge.maximumAdverseSlippageBps,
  );
  fraction("hedge.initialMarginFraction", policy.hedge.initialMarginFraction);
  fraction(
    "hedge.collateralStressMoveFraction",
    policy.hedge.collateralStressMoveFraction,
  );
  fraction(
    "hedge.maximumCollateralUsageFraction",
    policy.hedge.maximumCollateralUsageFraction,
  );
  nonNegative("hedge.noTradeBandUnderlying", policy.hedge.noTradeBandUnderlying);
  nonNegative(
    "hedge.maximumResidualDeltaToQuoteUnderlying",
    policy.hedge.maximumResidualDeltaToQuoteUnderlying,
  );
  positive("hedge.lotSizeUnderlying", policy.hedge.lotSizeUnderlying);
  positive("hedge.priceTickUsd", policy.hedge.priceTickUsd);
  positive(
    "hedge.minimumOrderNotionalUsd",
    policy.hedge.minimumOrderNotionalUsd,
  );
  positive("hedge.orderExpiryMs", policy.hedge.orderExpiryMs);

  for (const [path, value] of Object.entries(policy.costs)) {
    nonNegative(`costs.${path}`, value);
  }
  positive(
    "quote.premiumTickUsdPerUnderlying",
    policy.quote.premiumTickUsdPerUnderlying,
  );
  nonNegative(
    "quote.minimumTotalPremiumUsd",
    policy.quote.minimumTotalPremiumUsd,
  );
  nonNegative(
    "quote.quoteShadeBpsFromReservationCeiling",
    policy.quote.quoteShadeBpsFromReservationCeiling,
  );
  if (policy.quote.quoteShadeBpsFromReservationCeiling >= 10_000) {
    issues.push({
      path: "quote.quoteShadeBpsFromReservationCeiling",
      message: "must be less than 10,000 bps",
    });
  }
  if (policy.costs.conservativeForwardShockBps >= 10_000) {
    issues.push({
      path: "costs.conservativeForwardShockBps",
      message: "must be less than 10,000 bps",
    });
  }
  if (policy.hedge.maximumAdverseSlippageBps >= 10_000) {
    issues.push({
      path: "hedge.maximumAdverseSlippageBps",
      message: "must be less than 10,000 bps",
    });
  }
  fraction(
    "reservationStress.spotMoveFraction",
    policy.reservationStress.spotMoveFraction,
  );
  if (policy.reservationStress.spotMoveFraction >= 1) {
    issues.push({
      path: "reservationStress.spotMoveFraction",
      message: "must be less than one so stressed prices remain positive",
    });
  }
  nonNegative(
    "reservationStress.volatilityMoveDecimal",
    policy.reservationStress.volatilityMoveDecimal,
  );
  for (const [path, value] of Object.entries(policy.risk)) {
    positive(`risk.${path}`, value);
  }
  if (!Number.isSafeInteger(policy.risk.maxLiveReservations)) {
    issues.push({
      path: "risk.maxLiveReservations",
      message: "must be a positive safe integer",
    });
  }

  return issues;
}

export function assertValidPolicy(policy: MarketMakerPolicy): void {
  const issues = validatePolicy(policy);
  if (issues.length > 0) {
    throw new Error(
      `Invalid market-maker policy:\n${issues
        .map((issue) => `- ${issue.path}: ${issue.message}`)
        .join("\n")}`,
    );
  }
}
