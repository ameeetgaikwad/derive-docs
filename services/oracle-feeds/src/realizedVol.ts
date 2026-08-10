const TRADING_DAYS_PER_YEAR = 252;

/** Annualized close-to-close volatility from the newest `window` closes. */
export function annualizedRealizedVol(closes: readonly number[], window: number): number {
  if (!Number.isInteger(window) || window < 2) throw new Error("realized-vol window must be at least 2");
  const values = closes.slice(-window);
  if (values.length < window || values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error(`realized-vol calculation requires ${window} positive closes`);
  }
  const returns: number[] = [];
  for (let index = 1; index < values.length; index++) {
    returns.push(Math.log(values[index]! / values[index - 1]!));
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance * TRADING_DAYS_PER_YEAR);
}

export interface ReferenceVolatility {
  floor: number;
  rv20: number;
  rv60: number;
  reference: number;
}

/** v1 RWA surface: max(configured floor, 1.25 x RV20, 1.25 x RV60). */
export function referenceRwaVolatility(
  closes: readonly number[],
  configuredFloor: number,
): ReferenceVolatility {
  if (!Number.isFinite(configuredFloor) || configuredFloor <= 0) {
    throw new Error("configured volatility floor must be positive");
  }
  const rv20 = annualizedRealizedVol(closes, 20);
  const rv60 = annualizedRealizedVol(closes, 60);
  return {
    floor: configuredFloor,
    rv20,
    rv60,
    reference: Math.max(configuredFloor, 1.25 * rv20, 1.25 * rv60),
  };
}
