export interface RiskExposure {
  readonly netOptionDeltaUnderlying: number;
  readonly netGammaUsdForOnePercentSquared: number;
  readonly grossGammaUsdForOnePercentSquared: number;
  readonly netVegaUsdPerVolPoint: number;
  readonly grossVegaUsdPerVolPoint: number;
  readonly grossOptionNotionalUsd: number;
  /** Premium plus protocol/open-interest fees committed on the option venue. */
  readonly protocolCashOutflowUsd: number;
  readonly hedgeNotionalUsd: number;
  readonly hedgeInitialMarginUsd: number;
}

export interface RiskSlice {
  readonly expiryBucket: string;
  readonly exposure: RiskExposure;
}

export interface RiskReservation extends RiskSlice {
  readonly reservationId: string;
  readonly rfqId: string;
  readonly basedOnLedgerVersion: number;
  readonly expiresAtMs: number;
}

export interface PortfolioRiskState {
  readonly confirmed: readonly RiskSlice[];
  readonly reservations: readonly RiskReservation[];
  readonly realizedPnlTodayUsd: number;
  readonly quotingHalted: boolean;
}

export interface RiskLimits {
  readonly maxAbsNetOptionDeltaUnderlying: number;
  readonly maxGrossGammaUsdForOnePercentSquared: number;
  readonly maxGrossVegaUsdPerVolPoint: number;
  readonly maxGrossVegaUsdPerVolPointPerExpiry: number;
  readonly maxGrossOptionNotionalUsd: number;
  readonly maxProtocolCashOutflowUsd: number;
  readonly maxHedgeNotionalUsd: number;
  readonly maxHedgeInitialMarginUsd: number;
  readonly maxLiveReservations: number;
  readonly maxDailyLossUsd: number;
}

export const ZERO_EXPOSURE: RiskExposure = Object.freeze({
  netOptionDeltaUnderlying: 0,
  netGammaUsdForOnePercentSquared: 0,
  grossGammaUsdForOnePercentSquared: 0,
  netVegaUsdPerVolPoint: 0,
  grossVegaUsdPerVolPoint: 0,
  grossOptionNotionalUsd: 0,
  protocolCashOutflowUsd: 0,
  hedgeNotionalUsd: 0,
  hedgeInitialMarginUsd: 0,
});

export function addExposure(
  left: RiskExposure,
  right: RiskExposure,
): RiskExposure {
  return {
    netOptionDeltaUnderlying:
      left.netOptionDeltaUnderlying + right.netOptionDeltaUnderlying,
    netGammaUsdForOnePercentSquared:
      left.netGammaUsdForOnePercentSquared +
      right.netGammaUsdForOnePercentSquared,
    grossGammaUsdForOnePercentSquared:
      left.grossGammaUsdForOnePercentSquared +
      right.grossGammaUsdForOnePercentSquared,
    netVegaUsdPerVolPoint:
      left.netVegaUsdPerVolPoint + right.netVegaUsdPerVolPoint,
    grossVegaUsdPerVolPoint:
      left.grossVegaUsdPerVolPoint + right.grossVegaUsdPerVolPoint,
    grossOptionNotionalUsd:
      left.grossOptionNotionalUsd + right.grossOptionNotionalUsd,
    protocolCashOutflowUsd:
      left.protocolCashOutflowUsd + right.protocolCashOutflowUsd,
    hedgeNotionalUsd: left.hedgeNotionalUsd + right.hedgeNotionalUsd,
    hedgeInitialMarginUsd:
      left.hedgeInitialMarginUsd + right.hedgeInitialMarginUsd,
  };
}

export function aggregateRiskSlices(
  slices: readonly RiskSlice[],
): RiskExposure {
  return slices.reduce(
    (total, slice) => addExposure(total, slice.exposure),
    ZERO_EXPOSURE,
  );
}

export function expiryBucketUtc(expiryMs: number): string {
  if (!Number.isFinite(expiryMs)) {
    throw new RangeError("expiryMs must be finite");
  }
  return new Date(expiryMs).toISOString().slice(0, 10);
}

export type RiskLimitCode =
  | "DELTA_LIMIT"
  | "GAMMA_LIMIT"
  | "VEGA_LIMIT"
  | "EXPIRY_VEGA_LIMIT"
  | "OPTION_NOTIONAL_LIMIT"
  | "CASH_LIMIT"
  | "HEDGE_NOTIONAL_LIMIT"
  | "HEDGE_MARGIN_LIMIT"
  | "LIVE_QUOTE_LIMIT"
  | "DAILY_DRAWDOWN_LIMIT"
  | "QUOTING_HALTED";

export interface RiskLimitBreach {
  readonly code: RiskLimitCode;
  readonly observed: number;
  readonly limit: number;
}

export function evaluateRiskLimits(
  state: PortfolioRiskState,
  candidate: RiskSlice | null,
  limits: RiskLimits,
): readonly RiskLimitBreach[] {
  const slices: RiskSlice[] = [
    ...state.confirmed,
    ...state.reservations,
    ...(candidate === null ? [] : [candidate]),
  ];
  const total = aggregateRiskSlices(slices);
  const breaches: RiskLimitBreach[] = [];
  const check = (
    code: RiskLimitCode,
    observed: number,
    limit: number,
  ): void => {
    if (observed > limit + 1e-9) breaches.push({ code, observed, limit });
  };

  if (state.quotingHalted) {
    breaches.push({ code: "QUOTING_HALTED", observed: 1, limit: 0 });
  }
  check(
    "DAILY_DRAWDOWN_LIMIT",
    Math.max(0, -state.realizedPnlTodayUsd),
    limits.maxDailyLossUsd,
  );
  check(
    "LIVE_QUOTE_LIMIT",
    state.reservations.length + (candidate === null ? 0 : 1),
    limits.maxLiveReservations,
  );
  check(
    "DELTA_LIMIT",
    Math.abs(total.netOptionDeltaUnderlying),
    limits.maxAbsNetOptionDeltaUnderlying,
  );
  check(
    "GAMMA_LIMIT",
    total.grossGammaUsdForOnePercentSquared,
    limits.maxGrossGammaUsdForOnePercentSquared,
  );
  check(
    "VEGA_LIMIT",
    total.grossVegaUsdPerVolPoint,
    limits.maxGrossVegaUsdPerVolPoint,
  );
  check(
    "OPTION_NOTIONAL_LIMIT",
    total.grossOptionNotionalUsd,
    limits.maxGrossOptionNotionalUsd,
  );
  check(
    "CASH_LIMIT",
    total.protocolCashOutflowUsd,
    limits.maxProtocolCashOutflowUsd,
  );
  check(
    "HEDGE_NOTIONAL_LIMIT",
    total.hedgeNotionalUsd,
    limits.maxHedgeNotionalUsd,
  );
  check(
    "HEDGE_MARGIN_LIMIT",
    total.hedgeInitialMarginUsd,
    limits.maxHedgeInitialMarginUsd,
  );

  const expiryBuckets = new Map<string, number>();
  for (const slice of slices) {
    expiryBuckets.set(
      slice.expiryBucket,
      (expiryBuckets.get(slice.expiryBucket) ?? 0) +
        slice.exposure.grossVegaUsdPerVolPoint,
    );
  }
  for (const grossVega of expiryBuckets.values()) {
    check(
      "EXPIRY_VEGA_LIMIT",
      grossVega,
      limits.maxGrossVegaUsdPerVolPointPerExpiry,
    );
  }

  return breaches;
}

export function maximumRiskUtilization(
  state: PortfolioRiskState,
  candidate: RiskSlice | null,
  limits: RiskLimits,
): number {
  const slices: RiskSlice[] = [
    ...state.confirmed,
    ...state.reservations,
    ...(candidate === null ? [] : [candidate]),
  ];
  const total = aggregateRiskSlices(slices);
  const ratios = [
    Math.abs(total.netOptionDeltaUnderlying) /
      limits.maxAbsNetOptionDeltaUnderlying,
    total.grossGammaUsdForOnePercentSquared /
      limits.maxGrossGammaUsdForOnePercentSquared,
    total.grossVegaUsdPerVolPoint / limits.maxGrossVegaUsdPerVolPoint,
    total.grossOptionNotionalUsd / limits.maxGrossOptionNotionalUsd,
    total.protocolCashOutflowUsd / limits.maxProtocolCashOutflowUsd,
    total.hedgeNotionalUsd / limits.maxHedgeNotionalUsd,
    total.hedgeInitialMarginUsd / limits.maxHedgeInitialMarginUsd,
  ];
  const expiryVega = new Map<string, number>();
  for (const slice of slices) {
    expiryVega.set(
      slice.expiryBucket,
      (expiryVega.get(slice.expiryBucket) ?? 0) +
        slice.exposure.grossVegaUsdPerVolPoint,
    );
  }
  for (const grossVega of expiryVega.values()) {
    ratios.push(grossVega / limits.maxGrossVegaUsdPerVolPointPerExpiry);
  }
  return Math.max(0, ...ratios);
}

export interface PortfolioValidationIssue {
  readonly path: string;
  readonly message: string;
}

export function validatePortfolioRiskState(
  state: PortfolioRiskState,
): readonly PortfolioValidationIssue[] {
  const issues: PortfolioValidationIssue[] = [];
  if (!Number.isFinite(state.realizedPnlTodayUsd)) {
    issues.push({
      path: "realizedPnlTodayUsd",
      message: "must be finite",
    });
  }

  const slices: Array<{ readonly path: string; readonly slice: RiskSlice }> = [
    ...state.confirmed.map((slice, index) => ({
      path: `confirmed[${index}]`,
      slice,
    })),
    ...state.reservations.map((slice, index) => ({
      path: `reservations[${index}]`,
      slice,
    })),
  ];
  const nonNegativeExposureKeys: ReadonlyArray<keyof RiskExposure> = [
    "grossGammaUsdForOnePercentSquared",
    "grossVegaUsdPerVolPoint",
    "grossOptionNotionalUsd",
    "protocolCashOutflowUsd",
    "hedgeNotionalUsd",
    "hedgeInitialMarginUsd",
  ];
  for (const { path, slice } of slices) {
    if (slice.expiryBucket.trim() === "") {
      issues.push({ path: `${path}.expiryBucket`, message: "must be non-empty" });
    }
    for (const [key, value] of Object.entries(slice.exposure)) {
      if (!Number.isFinite(value)) {
        issues.push({ path: `${path}.exposure.${key}`, message: "must be finite" });
      }
    }
    for (const key of nonNegativeExposureKeys) {
      if (slice.exposure[key] < 0) {
        issues.push({
          path: `${path}.exposure.${key}`,
          message: "must be non-negative",
        });
      }
    }
    if (
      slice.exposure.grossGammaUsdForOnePercentSquared + 1e-9 <
      Math.abs(slice.exposure.netGammaUsdForOnePercentSquared)
    ) {
      issues.push({
        path: `${path}.exposure.grossGammaUsdForOnePercentSquared`,
        message: "must cover the absolute net gamma",
      });
    }
    if (
      slice.exposure.grossVegaUsdPerVolPoint + 1e-9 <
      Math.abs(slice.exposure.netVegaUsdPerVolPoint)
    ) {
      issues.push({
        path: `${path}.exposure.grossVegaUsdPerVolPoint`,
        message: "must cover the absolute net vega",
      });
    }
  }

  const reservationIds = new Set<string>();
  for (const [index, reservation] of state.reservations.entries()) {
    const path = `reservations[${index}]`;
    if (reservation.reservationId.trim() === "") {
      issues.push({ path: `${path}.reservationId`, message: "must be non-empty" });
    }
    if (reservation.rfqId.trim() === "") {
      issues.push({ path: `${path}.rfqId`, message: "must be non-empty" });
    }
    if (
      !Number.isSafeInteger(reservation.basedOnLedgerVersion) ||
      reservation.basedOnLedgerVersion < 0
    ) {
      issues.push({
        path: `${path}.basedOnLedgerVersion`,
        message: "must be a non-negative safe integer",
      });
    }
    if (!Number.isFinite(reservation.expiresAtMs)) {
      issues.push({ path: `${path}.expiresAtMs`, message: "must be finite" });
    }
    if (reservationIds.has(reservation.reservationId)) {
      issues.push({
        path: `${path}.reservationId`,
        message: "must be unique",
      });
    }
    reservationIds.add(reservation.reservationId);
  }

  return issues;
}
