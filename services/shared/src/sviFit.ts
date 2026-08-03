/**
 * Raw-SVI calibration, dependency-light.
 *
 * SVI parametrizes total implied variance w(k) = iv(k)^2 * T as a function of
 * log-moneyness k = ln(strike / forward):
 *
 *   w(k) = a + b * ( rho * (k - m) + sqrt( (k - m)^2 + sigma^2 ) )
 *
 * This is EXACTLY the on-chain form in
 * protocol/lib/v2-core/lib/lyra-utils/src/math/SVI.sol
 *   w = a + b*(sqrt((k-m)^2 + sigma^2) + rho*(k-m)),  vol = sqrt(w / tau)
 * so the 5 params (a, b, rho, m, sigma) fit here drop straight into LyraVolFeed
 * via encodeVolData (a, rho, m are int; b, sigma, fwd, refTau are uint; all
 * 18dp; refTau = tau = T in years).
 *
 * Objective: weighted least squares on TOTAL VARIANCE
 *   minimize  sum_i weight_i * ( w_model(k_i) - w_mkt_i )^2,
 *   w_mkt_i = iv_i^2 * T,   weight_i = vega-ish (defaults to 1).
 * We fit variance (not vol) because the on-chain curve is linear-ish in
 * variance and it keeps near-ATM points from dominating.
 *
 * Constraints (raw-SVI no-arb necessary conditions, Gatheral):
 *   b >= 0,  |rho| < 1,  sigma > 0,
 *   a + b*sigma*sqrt(1 - rho^2) >= 0   (min of w over k is non-negative)
 * enforced via a smooth penalty so the simplex stays in the feasible region.
 * The returned params are re-projected to be strictly feasible.
 *
 * Solver: Nelder-Mead (downhill simplex) with multi-start — no external deps.
 */

export interface SviRawParams {
  a: number;
  b: number;
  rho: number;
  m: number;
  sigma: number;
}

export interface SviFitPoint {
  /** log-moneyness ln(strike/forward) */
  k: number;
  /** total variance iv^2 * T */
  w: number;
  /** optional weight (default 1) */
  weight?: number;
}

export interface SviFitInput {
  /** forward price for the expiry */
  forward: number;
  /** time to expiry in years */
  tau: number;
  /** (strike, iv-fraction) market points */
  points: { strike: number; iv: number; weight?: number }[];
}

export interface SviFitResult {
  params: SviRawParams;
  /** RMSE in vol terms (fraction) across the fitted points */
  rmseVol: number;
  /** RMSE in total-variance terms */
  rmseVar: number;
  /** number of points used */
  n: number;
  /** solver iterations of the best start */
  iterations: number;
}

/** Total variance at log-moneyness k for raw-SVI params. */
export function sviTotalVariance(p: SviRawParams, k: number): number {
  const km = k - p.m;
  return p.a + p.b * (p.rho * km + Math.sqrt(km * km + p.sigma * p.sigma));
}

/** Implied vol (fraction) at strike for raw-SVI params + forward + tau. */
export function sviVol(p: SviRawParams, strike: number, forward: number, tau: number): number {
  if (!(strike > 0) || !(forward > 0) || !(tau > 0)) return 0;
  const k = Math.log(strike / forward);
  const w = Math.max(sviTotalVariance(p, k), 0);
  return Math.sqrt(w / tau);
}

/** Smallest total variance attainable (as k -> m + ...): the wing floor. */
export function sviMinVariance(p: SviRawParams): number {
  // min over k of a + b*(rho*(k-m) + sqrt((k-m)^2 + sigma^2))
  // = a + b*sigma*sqrt(1 - rho^2)  (standard raw-SVI result, |rho|<1)
  return p.a + p.b * p.sigma * Math.sqrt(Math.max(1 - p.rho * p.rho, 0));
}

function clampParams(p: SviRawParams): SviRawParams {
  const rho = Math.max(-0.999, Math.min(0.999, p.rho));
  const b = Math.max(0, p.b);
  const sigma = Math.max(1e-6, p.sigma);
  let a = p.a;
  // project a up so the wing floor is >= 0
  const floor = b * sigma * Math.sqrt(Math.max(1 - rho * rho, 0));
  if (a + floor < 0) a = -floor;
  return { a, b, rho, m: p.m, sigma };
}

/** Penalized objective: SSE on total variance + soft constraint penalties. */
function objective(p: SviRawParams, pts: SviFitPoint[]): number {
  let penalty = 0;
  if (p.b < 0) penalty += 1e6 * p.b * p.b;
  if (Math.abs(p.rho) >= 1) penalty += 1e6 * (Math.abs(p.rho) - 0.999) ** 2;
  if (p.sigma <= 0) penalty += 1e6 * (1e-6 - p.sigma) ** 2 + 1e3;
  const minVar = sviMinVariance(p);
  if (minVar < 0) penalty += 1e6 * minVar * minVar;

  let sse = 0;
  for (const pt of pts) {
    const wModel = sviTotalVariance(p, pt.k);
    const r = wModel - pt.w;
    sse += (pt.weight ?? 1) * r * r;
  }
  return sse + penalty;
}

type Vec = [number, number, number, number, number];

function toVec(p: SviRawParams): Vec {
  return [p.a, p.b, p.rho, p.m, p.sigma];
}
function fromVec(v: Vec): SviRawParams {
  return { a: v[0], b: v[1], rho: v[2], m: v[3], sigma: v[4] };
}

/**
 * Nelder-Mead downhill simplex over the 5 SVI params.
 * Standard coefficients (reflect 1, expand 2, contract 0.5, shrink 0.5).
 */
function nelderMead(
  f: (v: Vec) => number,
  start: Vec,
  opts: { maxIter?: number; tol?: number; step?: number } = {},
): { x: Vec; fx: number; iterations: number } {
  const maxIter = opts.maxIter ?? 4000;
  const tol = opts.tol ?? 1e-12;
  const n = start.length;

  // build initial simplex
  const simplex: Vec[] = [start.slice() as Vec];
  for (let i = 0; i < n; i++) {
    const pt = start.slice() as Vec;
    const s = opts.step ?? 0.05;
    const cur = pt[i]!;
    pt[i] = cur !== 0 ? cur * (1 + s) + s : s;
    simplex.push(pt);
  }
  let fvals = simplex.map(f);
  let iterations = 0;

  const order = (): void => {
    const idx = fvals.map((_, i) => i).sort((a, b) => fvals[a]! - fvals[b]!);
    const ns = idx.map((i) => simplex[i]!);
    const nf = idx.map((i) => fvals[i]!);
    for (let i = 0; i <= n; i++) {
      simplex[i] = ns[i]!;
      fvals[i] = nf[i]!;
    }
  };

  for (; iterations < maxIter; iterations++) {
    order();
    const best = fvals[0]!;
    const worst = fvals[n]!;
    if (Math.abs(worst - best) <= tol * (Math.abs(best) + tol)) break;

    // centroid of all but worst
    const centroid: Vec = [0, 0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) centroid[j]! += simplex[i]![j]!;
    }
    for (let j = 0; j < n; j++) centroid[j]! /= n;

    const reflect = combine(centroid, simplex[n]!, 1);
    const fr = f(reflect);
    if (fr < fvals[0]!) {
      const expand = combine(centroid, simplex[n]!, 2);
      const fe = f(expand);
      if (fe < fr) {
        simplex[n] = expand;
        fvals[n] = fe;
      } else {
        simplex[n] = reflect;
        fvals[n] = fr;
      }
    } else if (fr < fvals[n - 1]!) {
      simplex[n] = reflect;
      fvals[n] = fr;
    } else {
      const contract = combine(centroid, simplex[n]!, -0.5);
      const fc = f(contract);
      if (fc < fvals[n]!) {
        simplex[n] = contract;
        fvals[n] = fc;
      } else {
        // shrink toward best
        for (let i = 1; i <= n; i++) {
          simplex[i] = combine(simplex[0]!, simplex[i]!, -0.5, true);
          fvals[i] = f(simplex[i]!);
        }
      }
    }
  }
  order();
  return { x: simplex[0]!, fx: fvals[0]!, iterations };
}

/**
 * centroid + coeff*(centroid - worst) for reflect/expand/contract.
 * When `shrinkToBest` is set, interpret args as best + coeff*(pt - best).
 */
function combine(a: Vec, b: Vec, coeff: number, shrinkToBest = false): Vec {
  const out: Vec = [0, 0, 0, 0, 0];
  for (let j = 0; j < a.length; j++) {
    out[j] = shrinkToBest ? a[j]! - coeff * (b[j]! - a[j]!) : a[j]! + coeff * (a[j]! - b[j]!);
  }
  return out;
}

/**
 * Fit raw-SVI params to a single expiry's (strike, iv) points.
 * Requires >= 3 usable points; throws otherwise (caller should fall back).
 */
export function fitSvi(input: SviFitInput): SviFitResult {
  const { forward, tau } = input;
  if (!(forward > 0)) throw new Error(`fitSvi: forward must be > 0 (${forward})`);
  if (!(tau > 0)) throw new Error(`fitSvi: tau must be > 0 (${tau})`);

  const pts: SviFitPoint[] = input.points
    .filter((p) => p.strike > 0 && p.iv > 0 && Number.isFinite(p.iv))
    .map((p) => ({
      k: Math.log(p.strike / forward),
      w: p.iv * p.iv * tau,
      weight: p.weight,
    }));
  if (pts.length < 3) {
    throw new Error(`fitSvi: need >= 3 valid points, got ${pts.length}`);
  }

  // ATM total variance as a scale anchor for the multi-start guesses.
  const ks = pts.map((p) => p.k);
  const ws = pts.map((p) => p.w);
  const atmIdx = ks.reduce((best, k, i) => (Math.abs(k) < Math.abs(ks[best]!) ? i : best), 0);
  const wAtm = Math.max(ws[atmIdx]!, 1e-8);
  const kMin = Math.min(...ks);
  const kMax = Math.max(...ks);
  const spread = Math.max(kMax - kMin, 0.05);

  const f = (v: Vec): number => objective(fromVec(v), pts);

  // Multi-start over plausible (b, rho, sigma) regimes; m near ATM (k=0).
  const starts: Vec[] = [];
  for (const b of [wAtm / spread, wAtm / (spread * 2), 0.1]) {
    for (const rho of [-0.3, 0, -0.6]) {
      for (const sigma of [spread / 2, spread, 0.1]) {
        starts.push([Math.max(wAtm - b * sigma, 0), Math.max(b, 1e-4), rho, 0, Math.max(sigma, 1e-3)]);
      }
    }
  }

  let best: { x: Vec; fx: number; iterations: number } | null = null;
  for (const s of starts) {
    const res = nelderMead(f, s);
    if (!best || res.fx < best.fx) best = res;
  }
  const params = clampParams(fromVec(best!.x));

  // report errors on the projected params (what actually gets posted)
  let sseVar = 0;
  for (const pt of pts) {
    const r = sviTotalVariance(params, pt.k) - pt.w;
    sseVar += r * r;
  }
  const rmseVar = Math.sqrt(sseVar / pts.length);

  let sseVol = 0;
  for (let i = 0; i < input.points.length; i++) {
    const mp = input.points[i]!;
    if (!(mp.strike > 0) || !(mp.iv > 0)) continue;
    const modelVol = sviVol(params, mp.strike, forward, tau);
    sseVol += (modelVol - mp.iv) ** 2;
  }
  const rmseVol = Math.sqrt(sseVol / pts.length);

  return { params, rmseVar, rmseVol, n: pts.length, iterations: best!.iterations };
}

// ---------------------------------------------------------------------------
// Float SVI params -> 18dp bigint params for encodeVolData / LyraVolFeed.
// ---------------------------------------------------------------------------

const ONE = 10n ** 18n;
const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n;

/** 18dp bigint from a float, banker's-free round-half-up on the 18th place. */
function toUnit18(x: number): bigint {
  if (!Number.isFinite(x)) throw new Error(`toUnit18: non-finite ${x}`);
  const neg = x < 0;
  const ax = Math.abs(x);
  // split to avoid float precision loss on large magnitudes
  const whole = Math.floor(ax);
  const frac = ax - whole;
  const fracScaled = BigInt(Math.round(frac * 1e18));
  const v = BigInt(whole) * ONE + fracScaled;
  return neg ? -v : v;
}

/** seconds -> 18dp year fraction (matches oracle-feeds annualise / Black76). */
export function annualise18(seconds: bigint): bigint {
  if (seconds < 0n) throw new Error(`annualise18: negative ${seconds}`);
  return (seconds * ONE) / SECONDS_PER_YEAR;
}

/** 18dp SVI params ready for encodeVolData (a/rho/m are int, b/sigma/fwd/refTau uint). */
export interface SviParams18 {
  SVI_a: bigint;
  SVI_b: bigint;
  SVI_rho: bigint;
  SVI_m: bigint;
  SVI_sigma: bigint;
  SVI_fwd: bigint;
  SVI_refTau: bigint;
}

/**
 * Convert a fitted float SVI curve to the on-chain 18dp layout.
 * `forward` is the expiry's forward price (quote units), `tau` its
 * time-to-expiry in years. SVI_refTau is tau in 18dp (packed into uint64
 * on-chain — safe for any realistic expiry).
 */
export function sviParamsToUnits(p: SviRawParams, forward: number, tau: number): SviParams18 {
  if (!(forward > 0)) throw new Error(`sviParamsToUnits: forward must be > 0 (${forward})`);
  if (!(tau > 0)) throw new Error(`sviParamsToUnits: tau must be > 0 (${tau})`);
  return {
    SVI_a: toUnit18(p.a),
    SVI_b: toUnit18(Math.max(p.b, 0)),
    SVI_rho: toUnit18(Math.max(-0.999, Math.min(0.999, p.rho))),
    SVI_m: toUnit18(p.m),
    SVI_sigma: toUnit18(Math.max(p.sigma, 1e-6)),
    SVI_fwd: toUnit18(forward),
    SVI_refTau: toUnit18(tau),
  };
}
