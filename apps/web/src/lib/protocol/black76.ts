/**
 * Black-76 option pricing on the forward (ported from
 * services/maker-bot/src/black76.ts — the same model the reference maker bot
 * quotes with, so indicative premiums line up with live quotes):
 *
 *   call = e^(-rT) * (F*N(d1) - K*N(d2))
 *   d1 = (ln(F/K) + 0.5*sigma^2*T) / (sigma*sqrt(T)),  d2 = d1 - sigma*sqrt(T)
 *
 * Used for the indicative premium / APR shown in the StrikeSelector only;
 * the executable price always comes from the RFQ auction.
 */

export const YEAR_SECONDS = 365 * 24 * 60 * 60;

/** Abramowitz & Stegun 7.1.26 rational approximation of erf, |error| <= 1.5e-7. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/** Standard normal CDF. */
export function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

export interface Black76Params {
  /** Forward price F (quote units, e.g. USDT). */
  forward: number;
  /** Strike K. */
  strike: number;
  /** Time to expiry in years (365-day year). */
  timeToExpiryYears: number;
  /** Annualized volatility, e.g. 0.6 for 60%. */
  vol: number;
  /** Continuously-compounded rate, default 0. */
  rate?: number;
  isCall: boolean;
}

/**
 * Black-76 premium per 1 unit of underlying, in quote-asset units.
 * Degenerate inputs (T<=0 or vol<=0) collapse to discounted intrinsic value.
 */
export function black76Price(params: Black76Params): number {
  const { forward: F, strike: K, timeToExpiryYears: T, vol, isCall } = params;
  const rate = params.rate ?? 0;

  if (!(F > 0) || !(K > 0)) return 0;
  if (!Number.isFinite(T) || !Number.isFinite(vol)) return 0;

  const df = Math.exp(-rate * Math.max(T, 0));

  if (T <= 0 || vol <= 0) {
    const intrinsic = isCall ? Math.max(F - K, 0) : Math.max(K - F, 0);
    return df * intrinsic;
  }

  const sqrtT = Math.sqrt(T);
  const sigSqrtT = vol * sqrtT;
  const d1 = (Math.log(F / K) + 0.5 * vol * vol * T) / sigSqrtT;
  const d2 = d1 - sigSqrtT;

  if (isCall) return df * (F * normCdf(d1) - K * normCdf(d2));
  return df * (K * normCdf(-d2) - F * normCdf(-d1));
}

/** Time to expiry in years from a unix-seconds expiry (clamped at 0). */
export function yearsToExpiry(expirySec: bigint | number, nowMs: number = Date.now()): number {
  const expiry = Number(expirySec);
  return Math.max(0, expiry - nowMs / 1000) / YEAR_SECONDS;
}
