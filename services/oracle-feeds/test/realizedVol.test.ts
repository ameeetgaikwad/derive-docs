import { describe, expect, it } from "vitest";
import { annualizedRealizedVol, referenceRwaVolatility } from "../src/realizedVol.js";

describe("RWA reference volatility", () => {
  const closes = Array.from({ length: 60 }, (_, index) => 100 * Math.exp(index % 2 === 0 ? index * 0.001 : -index * 0.001));

  it("annualizes close-to-close log returns", () => {
    expect(annualizedRealizedVol(closes, 20)).toBeGreaterThan(0);
  });

  it("uses the largest of the floor, RV20 and RV60 buffers", () => {
    const result = referenceRwaVolatility(closes, 0.1);
    expect(result.reference).toBeCloseTo(Math.max(0.1, 1.25 * result.rv20, 1.25 * result.rv60));
  });

  it("fails closed on missing or invalid close history", () => {
    expect(() => referenceRwaVolatility(closes.slice(0, 59), 0.2)).toThrow(/60 positive closes/);
    expect(() => annualizedRealizedVol([...closes.slice(0, 19), 0], 20)).toThrow(/positive closes/);
  });
});
