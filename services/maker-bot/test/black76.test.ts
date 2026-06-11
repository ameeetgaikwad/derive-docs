import { describe, expect, it } from "vitest";
import { black76Price, normCdf, YEAR_SECONDS, yearsToExpiry } from "../src/black76.js";

/**
 * Reference price by direct numeric integration (Simpson's rule) of the
 * risk-neutral expectation — computed here, not from memory:
 *
 *   S_T = F * exp(sigma*sqrt(T)*z - 0.5*sigma^2*T),  z ~ N(0,1)
 *   call = e^(-rT) * Int φ(z) * max(S_T - K, 0) dz
 *   put  = e^(-rT) * Int φ(z) * max(K - S_T, 0) dz
 */
function referencePrice(params: {
  forward: number;
  strike: number;
  timeToExpiryYears: number;
  vol: number;
  rate?: number;
  isCall: boolean;
}): number {
  const { forward: F, strike: K, timeToExpiryYears: T, vol, isCall } = params;
  const rate = params.rate ?? 0;
  const sigSqrtT = vol * Math.sqrt(T);

  const payoff = (z: number): number => {
    const sT = F * Math.exp(sigSqrtT * z - 0.5 * sigSqrtT * sigSqrtT);
    const phi = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
    return phi * Math.max(isCall ? sT - K : K - sT, 0);
  };

  // Simpson's rule on z in [-12, 12] (mass beyond is ~1e-32).
  const a = -12;
  const b = 12;
  const n = 40_000; // even
  const h = (b - a) / n;
  let sum = payoff(a) + payoff(b);
  for (let i = 1; i < n; i++) {
    sum += payoff(a + i * h) * (i % 2 === 0 ? 2 : 4);
  }
  return Math.exp(-rate * T) * (sum * h) / 3;
}

function relErr(x: number, ref: number): number {
  return Math.abs(x - ref) / Math.abs(ref);
}

describe("normCdf", () => {
  it("matches known anchor points", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 7);
    expect(normCdf(1e9)).toBeCloseTo(1, 7);
    expect(normCdf(-1e9)).toBeCloseTo(0, 7);
    // symmetry
    for (const x of [0.3, 1, 1.96, 2.5]) {
      expect(normCdf(x) + normCdf(-x)).toBeCloseTo(1, 7);
    }
    // integral check: N(1) computed by integrating the pdf numerically
    const n = 100_000;
    const h = 13 / n; // integrate pdf from -12 to 1
    let sum = 0;
    for (let i = 0; i <= n; i++) {
      const z = -12 + i * h;
      const w = i === 0 || i === n ? 1 : i % 2 === 0 ? 2 : 4;
      sum += w * (Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI));
    }
    expect(relErr(normCdf(1), (sum * h) / 3)).toBeLessThan(1e-5);
  });
});

describe("black76Price vs numeric integration", () => {
  it("prices the spec case: F=100000 K=110000 T=7/365 vol=0.6 r=0 within 1%", () => {
    const params = {
      forward: 100_000,
      strike: 110_000,
      timeToExpiryYears: 7 / 365,
      vol: 0.6,
      rate: 0,
      isCall: true,
    };
    const theo = black76Price(params);
    const ref = referencePrice(params);
    expect(theo).toBeGreaterThan(0);
    expect(relErr(theo, ref)).toBeLessThan(0.01);
    // tighter sanity: A&S erf is good to ~1e-7, integration to ~1e-8
    expect(relErr(theo, ref)).toBeLessThan(1e-4);
  });

  it("prices an ATM call with non-zero rate within 1%", () => {
    const params = {
      forward: 100_000,
      strike: 100_000,
      timeToExpiryYears: 30 / 365,
      vol: 0.5,
      rate: 0.05,
      isCall: true,
    };
    const theo = black76Price(params);
    const ref = referencePrice(params);
    expect(relErr(theo, ref)).toBeLessThan(0.01);
    // ATM Black-76 ~ df * 0.3989 * F * sigma * sqrt(T) (first-order)
    const approx =
      Math.exp(-0.05 * (30 / 365)) * 0.3989 * 100_000 * 0.5 * Math.sqrt(30 / 365);
    expect(relErr(theo, approx)).toBeLessThan(0.02);
  });

  it("prices an ITM put within 1% and satisfies put-call parity", () => {
    const base = {
      forward: 100_000,
      strike: 120_000,
      timeToExpiryYears: 14 / 365,
      vol: 0.8,
      rate: 0.02,
    };
    const put = black76Price({ ...base, isCall: false });
    const call = black76Price({ ...base, isCall: true });
    const refPut = referencePrice({ ...base, isCall: false });
    expect(relErr(put, refPut)).toBeLessThan(0.01);

    // C - P = df * (F - K)
    const df = Math.exp(-base.rate * base.timeToExpiryYears);
    const parity = df * (base.forward - base.strike);
    expect(call - put).toBeCloseTo(parity, 4);
  });

  it("collapses to discounted intrinsic for T<=0 or vol<=0", () => {
    expect(
      black76Price({ forward: 100_000, strike: 90_000, timeToExpiryYears: 0, vol: 0.6, isCall: true }),
    ).toBe(10_000);
    expect(
      black76Price({ forward: 100_000, strike: 110_000, timeToExpiryYears: 0, vol: 0.6, isCall: true }),
    ).toBe(0);
    const df = Math.exp(-0.05 * 1);
    expect(
      black76Price({
        forward: 100_000,
        strike: 90_000,
        timeToExpiryYears: 1,
        vol: 0,
        rate: 0.05,
        isCall: true,
      }),
    ).toBeCloseTo(df * 10_000, 6);
  });

  it("respects monotonicity: higher vol and longer expiry cost more", () => {
    const base = {
      forward: 100_000,
      strike: 110_000,
      timeToExpiryYears: 7 / 365,
      rate: 0,
      isCall: true,
    };
    const lowVol = black76Price({ ...base, vol: 0.4 });
    const highVol = black76Price({ ...base, vol: 0.8 });
    expect(highVol).toBeGreaterThan(lowVol);
    const short = black76Price({ ...base, vol: 0.6 });
    const long = black76Price({ ...base, vol: 0.6, timeToExpiryYears: 30 / 365 });
    expect(long).toBeGreaterThan(short);
  });
});

describe("yearsToExpiry", () => {
  it("converts unix seconds to 365-day years, clamped at 0", () => {
    const nowMs = 1_750_000_000_000;
    const expiry = BigInt(Math.floor(nowMs / 1000) + 7 * 86_400);
    expect(yearsToExpiry(expiry, nowMs)).toBeCloseTo(7 / 365, 10);
    expect(yearsToExpiry(BigInt(Math.floor(nowMs / 1000) - 100), nowMs)).toBe(0);
    expect(YEAR_SECONDS).toBe(31_536_000);
  });
});
