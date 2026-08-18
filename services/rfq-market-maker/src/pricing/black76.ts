import type { OptionKind } from "../domain/types.js";
import { normalCdf, normalPdf } from "../math/normal.js";

const DAYS_PER_YEAR = 365;

export interface Black76Input {
  readonly forwardUsdPerUnderlying: number;
  readonly strikeUsdPerUnderlying: number;
  readonly timeToExpiryYears: number;
  readonly volatilityDecimal: number;
  readonly annualRateDecimal: number;
  readonly kind: OptionKind;
}

export interface Black76Result {
  readonly premiumUsdPerUnderlying: number;
  /** Sensitivity to one USD of forward movement. */
  readonly forwardDelta: number;
  /** Change in forward delta for one USD of forward movement. */
  readonly forwardGammaPerUsd: number;
  /** Premium change for one volatility point, where one point is 1%. */
  readonly vegaUsdPerVolPoint: number;
  /** Premium change from one calendar day passing, holding forward and IV fixed. */
  readonly calendarThetaUsdPerDay: number;
  readonly d1: number;
  readonly d2: number;
  readonly discountFactor: number;
}

function requireFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite`);
  }
}

export function black76(input: Black76Input): Black76Result {
  requireFinite("forwardUsdPerUnderlying", input.forwardUsdPerUnderlying);
  requireFinite("strikeUsdPerUnderlying", input.strikeUsdPerUnderlying);
  requireFinite("timeToExpiryYears", input.timeToExpiryYears);
  requireFinite("volatilityDecimal", input.volatilityDecimal);
  requireFinite("annualRateDecimal", input.annualRateDecimal);

  if (input.forwardUsdPerUnderlying <= 0) {
    throw new RangeError("forwardUsdPerUnderlying must be greater than zero");
  }
  if (input.strikeUsdPerUnderlying <= 0) {
    throw new RangeError("strikeUsdPerUnderlying must be greater than zero");
  }
  if (input.timeToExpiryYears <= 0) {
    throw new RangeError("timeToExpiryYears must be greater than zero");
  }
  if (input.volatilityDecimal <= 0) {
    throw new RangeError("volatilityDecimal must be greater than zero");
  }

  const sqrtTime = Math.sqrt(input.timeToExpiryYears);
  const sigmaSqrtTime = input.volatilityDecimal * sqrtTime;
  const d1 =
    (Math.log(input.forwardUsdPerUnderlying / input.strikeUsdPerUnderlying) +
      0.5 * input.volatilityDecimal ** 2 * input.timeToExpiryYears) /
    sigmaSqrtTime;
  const d2 = d1 - sigmaSqrtTime;
  const discountFactor = Math.exp(
    -input.annualRateDecimal * input.timeToExpiryYears,
  );
  const direction = input.kind === "CALL" ? 1 : -1;
  const premiumUsdPerUnderlying =
    discountFactor *
    direction *
    (input.forwardUsdPerUnderlying * normalCdf(direction * d1) -
      input.strikeUsdPerUnderlying * normalCdf(direction * d2));
  const forwardDelta =
    discountFactor * direction * normalCdf(direction * d1);
  const forwardGammaPerUsd =
    (discountFactor * normalPdf(d1)) /
    (input.forwardUsdPerUnderlying * sigmaSqrtTime);
  const vegaUsdPerVolPoint =
    (discountFactor *
      input.forwardUsdPerUnderlying *
      normalPdf(d1) *
      sqrtTime) /
    100;
  const calendarThetaUsdPerYear =
    input.annualRateDecimal * premiumUsdPerUnderlying -
    (discountFactor *
      input.forwardUsdPerUnderlying *
      normalPdf(d1) *
      input.volatilityDecimal) /
      (2 * sqrtTime);

  return {
    premiumUsdPerUnderlying,
    forwardDelta,
    forwardGammaPerUsd,
    vegaUsdPerVolPoint,
    calendarThetaUsdPerDay: calendarThetaUsdPerYear / DAYS_PER_YEAR,
    d1,
    d2,
    discountFactor,
  };
}

/**
 * Converts a Black-76 forward delta to a spot/perpetual-equivalent underlying
 * quantity under the explicit assumption dF/dS = beta * F/S.
 */
export function forwardDeltaToHedgeUnderlying(
  forwardDelta: number,
  forwardUsdPerUnderlying: number,
  hedgeReferenceUsdPerUnderlying: number,
  crossVenueBeta: number,
): number {
  if (
    !Number.isFinite(forwardDelta) ||
    !Number.isFinite(forwardUsdPerUnderlying) ||
    !Number.isFinite(hedgeReferenceUsdPerUnderlying) ||
    !Number.isFinite(crossVenueBeta) ||
    forwardUsdPerUnderlying <= 0 ||
    hedgeReferenceUsdPerUnderlying <= 0 ||
    crossVenueBeta <= 0
  ) {
    throw new RangeError("delta conversion inputs must be finite and positive");
  }

  return (
    forwardDelta *
    (forwardUsdPerUnderlying / hedgeReferenceUsdPerUnderlying) *
    crossVenueBeta
  );
}
