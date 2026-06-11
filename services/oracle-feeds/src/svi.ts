/**
 * SVI parameter helpers for LyraVolFeed
 * (protocol/lib/v2-core/src/feeds/LyraVolFeed.sol +
 *  protocol/lib/v2-core/lib/lyra-utils/src/math/SVI.sol).
 *
 * On-chain vol is computed as:
 *   w   = a + b * (sqrt((k - m)^2 + sigma^2) + rho * (k - m))   (total variance, 18dp)
 *   vol = sqrt(w / tau)                                          (18dp)
 * with k = ln(strike / fwd) and tau = SVI_refTau (years, 18dp).
 */

const ONE = 10n ** 18n;

/** 365 days — matches lyra-utils Black76.SECONDS_PER_YEAR. */
export const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n;

/** Black76.annualise: seconds -> 18dp year fraction (fits uint64 for <~18.4y). */
export function annualise(seconds: bigint): bigint {
  if (seconds < 0n) throw new Error(`annualise: negative duration ${seconds}`);
  return (seconds * ONE) / SECONDS_PER_YEAR;
}

export interface SviParams {
  SVI_a: bigint;
  SVI_b: bigint;
  SVI_rho: bigint;
  SVI_m: bigint;
  SVI_sigma: bigint;
  SVI_fwd: bigint;
  SVI_refTau: bigint;
}

/**
 * Flat implied-vol surface: with b = 0, w = a for every strike, so
 * vol = sqrt(a / tau). Choosing a = iv^2 * tau makes getVol return `iv`
 * exactly (modulo integer sqrt rounding) at all strikes.
 *
 * @param iv 18dp implied vol (e.g. 0.6e18 for 60%)
 * @param forwardPrice 18dp forward price for the expiry (SVI_fwd)
 * @param tau 18dp time-to-expiry in years (use annualise(expiry - now))
 */
export function flatIvSviParams(iv: bigint, forwardPrice: bigint, tau: bigint): SviParams {
  if (iv <= 0n) throw new Error("flatIvSviParams: iv must be > 0");
  if (tau <= 0n) throw new Error("flatIvSviParams: tau must be > 0 (expiry in the past?)");
  if (forwardPrice <= 0n) throw new Error("flatIvSviParams: forwardPrice must be > 0");

  // a = iv^2 * tau, 18dp fixed-point multiplies
  const ivSq = (iv * iv) / ONE;
  const a = (ivSq * tau) / ONE;

  return {
    SVI_a: a,
    SVI_b: 0n,
    SVI_rho: 0n,
    SVI_m: 0n,
    // unused when b = 0, but SVI.getK reads b*sigma — keep it small & positive
    SVI_sigma: ONE / 20n, // 0.05
    SVI_fwd: forwardPrice,
    SVI_refTau: tau,
  };
}

/**
 * TS replica of SVI.getVol for a flat surface (b = 0): vol = sqrt(a/tau),
 * using the same integer math as lyra-utils FixedPointMathLib
 * (sqrt(x) = isqrt(x * 1e18)). Used by tests to assert the produced params
 * round-trip to the requested IV.
 */
export function flatSviVol(params: SviParams): bigint {
  const w = params.SVI_a; // b = 0 -> w = a for all strikes
  const ratio = (w * ONE) / params.SVI_refTau; // divideDecimal
  return integerSqrt(ratio * ONE); // FixedPointMathLib.sqrt
}

export function integerSqrt(value: bigint): bigint {
  if (value < 0n) throw new Error("integerSqrt of negative");
  if (value < 2n) return value;
  let x = value;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + value / x) / 2n;
  }
  return x;
}
