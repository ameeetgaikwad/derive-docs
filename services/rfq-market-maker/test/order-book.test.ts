import { describe, expect, it } from "vitest";

import {
  roundPriceForIoc,
  simulateBoundedIoc,
} from "../src/market/order-book.js";

describe("simulateBoundedIoc", () => {
  it("sorts and consumes asks up to the buy slippage boundary", () => {
    const execution = simulateBoundedIoc(
      "BUY",
      1,
      100,
      100,
      [],
      [
        { priceUsdPerUnderlying: 101.1, quantityUnderlying: 5 },
        { priceUsdPerUnderlying: 100.5, quantityUnderlying: 0.7 },
        { priceUsdPerUnderlying: -1, quantityUnderlying: 10 },
        { priceUsdPerUnderlying: 100.2, quantityUnderlying: 0.4 },
      ],
    );

    expect(execution.executable).toBe(true);
    expect(execution.filledQuantityUnderlying).toBeCloseTo(1, 12);
    expect(execution.unfilledQuantityUnderlying).toBe(0);
    expect(execution.vwapUsdPerUnderlying).toBeCloseTo(100.38, 12);
    expect(execution.worstPriceUsdPerUnderlying).toBe(100.5);
    expect(execution.adverseSlippageBps).toBeCloseTo(38, 10);
    expect(execution.tradedNotionalUsd).toBeCloseTo(100.38, 12);
  });

  it("uses bids for sells and never consumes levels outside the bound", () => {
    const execution = simulateBoundedIoc(
      "SELL",
      0.5,
      100,
      100,
      [
        { priceUsdPerUnderlying: 98.9, quantityUnderlying: 10 },
        { priceUsdPerUnderlying: 99.5, quantityUnderlying: 0.4 },
        { priceUsdPerUnderlying: 100.1, quantityUnderlying: 0.2 },
      ],
      [],
    );

    expect(execution.executable).toBe(true);
    expect(execution.vwapUsdPerUnderlying).toBeCloseTo(99.74, 12);
    expect(execution.worstPriceUsdPerUnderlying).toBe(99.5);
    expect(execution.adverseSlippageBps).toBeCloseTo(26, 10);
  });

  it("reports a partial simulation as non-executable when bounded depth is short", () => {
    const execution = simulateBoundedIoc(
      "BUY",
      1,
      100,
      100,
      [],
      [
        { priceUsdPerUnderlying: 100.2, quantityUnderlying: 0.4 },
        { priceUsdPerUnderlying: 101.1, quantityUnderlying: 2 },
      ],
    );

    expect(execution.executable).toBe(false);
    expect(execution.filledQuantityUnderlying).toBeCloseTo(0.4, 12);
    expect(execution.unfilledQuantityUnderlying).toBeCloseTo(0.6, 12);
    expect(execution.tradedNotionalUsd).toBeCloseTo(40.08, 12);
  });

  it.each([
    [0, 100, 10],
    [1, 0, 10],
    [1, 100, -1],
  ])("rejects invalid simulation inputs", (quantity, reference, slippage) => {
    expect(() =>
      simulateBoundedIoc("BUY", quantity, reference, slippage, [], []),
    ).toThrow(RangeError);
  });
});

describe("roundPriceForIoc", () => {
  it("rounds buys up and sells down without moving exact ticks", () => {
    expect(roundPriceForIoc("BUY", 100.01, 0.1)).toBeCloseTo(100.1, 12);
    expect(roundPriceForIoc("SELL", 100.09, 0.1)).toBeCloseTo(100, 12);
    expect(roundPriceForIoc("BUY", 100.1, 0.1)).toBeCloseTo(100.1, 12);
    expect(roundPriceForIoc("SELL", 100.1, 0.1)).toBeCloseTo(100.1, 12);
  });

  it("rejects non-positive prices and ticks", () => {
    expect(() => roundPriceForIoc("BUY", 0, 0.1)).toThrow(RangeError);
    expect(() => roundPriceForIoc("SELL", 100, 0)).toThrow(RangeError);
  });
});
