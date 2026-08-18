import { describe, expect, it } from "vitest";

import {
  black76,
  forwardDeltaToHedgeUnderlying,
  type Black76Input,
} from "../src/pricing/black76.js";

const ATM_INPUT: Black76Input = {
  forwardUsdPerUnderlying: 100,
  strikeUsdPerUnderlying: 100,
  timeToExpiryYears: 1,
  volatilityDecimal: 0.2,
  annualRateDecimal: 0.05,
  kind: "CALL",
};

describe("black76", () => {
  it("matches a known at-the-money call value and Greeks", () => {
    const result = black76(ATM_INPUT);

    // The implementation intentionally uses a compact CDF approximation.
    expect(result.premiumUsdPerUnderlying).toBeCloseTo(7.577082, 4);
    expect(result.forwardDelta).toBeCloseTo(0.5135, 4);
    expect(result.forwardGammaPerUsd).toBeCloseTo(0.01888, 5);
    expect(result.vegaUsdPerVolPoint).toBeCloseTo(0.377593, 5);
    expect(result.discountFactor).toBeCloseTo(Math.exp(-0.05), 12);
    expect(result.d1).toBeCloseTo(0.1, 12);
    expect(result.d2).toBeCloseTo(-0.1, 12);
  });

  it("satisfies discounted call-put parity", () => {
    const input = {
      ...ATM_INPUT,
      forwardUsdPerUnderlying: 112,
      strikeUsdPerUnderlying: 103,
      timeToExpiryYears: 0.75,
      annualRateDecimal: 0.03,
      volatilityDecimal: 0.45,
    };
    const call = black76({ ...input, kind: "CALL" });
    const put = black76({ ...input, kind: "PUT" });
    const parity = Math.exp(-0.03 * 0.75) * (112 - 103);

    expect(call.premiumUsdPerUnderlying - put.premiumUsdPerUnderlying).toBeCloseTo(
      parity,
      10,
    );
    expect(call.forwardDelta - put.forwardDelta).toBeCloseTo(
      Math.exp(-0.03 * 0.75),
      10,
    );
  });

  it("matches central finite differences for delta, gamma, vega, and theta", () => {
    const base = black76(ATM_INPUT);
    const forwardStep = 0.01;
    const up = black76({
      ...ATM_INPUT,
      forwardUsdPerUnderlying: ATM_INPUT.forwardUsdPerUnderlying + forwardStep,
    });
    const down = black76({
      ...ATM_INPUT,
      forwardUsdPerUnderlying: ATM_INPUT.forwardUsdPerUnderlying - forwardStep,
    });
    const finiteDelta =
      (up.premiumUsdPerUnderlying - down.premiumUsdPerUnderlying) /
      (2 * forwardStep);
    const finiteGamma =
      (up.premiumUsdPerUnderlying -
        2 * base.premiumUsdPerUnderlying +
        down.premiumUsdPerUnderlying) /
      forwardStep ** 2;

    const volatilityStep = 0.0001;
    const volUp = black76({
      ...ATM_INPUT,
      volatilityDecimal: ATM_INPUT.volatilityDecimal + volatilityStep,
    });
    const volDown = black76({
      ...ATM_INPUT,
      volatilityDecimal: ATM_INPUT.volatilityDecimal - volatilityStep,
    });
    const finiteVegaPerPoint =
      ((volUp.premiumUsdPerUnderlying - volDown.premiumUsdPerUnderlying) /
        (2 * volatilityStep)) *
      0.01;

    const oneDay = 1 / 365;
    const oneDayLater = black76({
      ...ATM_INPUT,
      timeToExpiryYears: ATM_INPUT.timeToExpiryYears - oneDay,
    });
    const finiteCalendarTheta =
      oneDayLater.premiumUsdPerUnderlying - base.premiumUsdPerUnderlying;

    expect(base.forwardDelta).toBeCloseTo(finiteDelta, 7);
    expect(base.forwardGammaPerUsd).toBeCloseTo(finiteGamma, 4);
    expect(base.vegaUsdPerVolPoint).toBeCloseTo(finiteVegaPerPoint, 5);
    expect(base.calendarThetaUsdPerDay).toBeCloseTo(finiteCalendarTheta, 4);
  });

  it.each([
    ["non-finite forward", { forwardUsdPerUnderlying: Number.NaN }],
    ["zero forward", { forwardUsdPerUnderlying: 0 }],
    ["negative strike", { strikeUsdPerUnderlying: -1 }],
    ["zero time", { timeToExpiryYears: 0 }],
    ["zero volatility", { volatilityDecimal: 0 }],
    ["non-finite rate", { annualRateDecimal: Number.POSITIVE_INFINITY }],
  ])("rejects %s", (_label, override) => {
    expect(() => black76({ ...ATM_INPUT, ...override })).toThrow(RangeError);
  });

  it("converts forward delta to a signed perpetual-equivalent quantity", () => {
    expect(forwardDeltaToHedgeUnderlying(0.5, 102, 100, 0.9)).toBeCloseTo(
      0.459,
      12,
    );
    expect(forwardDeltaToHedgeUnderlying(-0.5, 102, 100, 0.9)).toBeCloseTo(
      -0.459,
      12,
    );
    expect(() =>
      forwardDeltaToHedgeUnderlying(0.5, 102, 100, 0),
    ).toThrow(RangeError);
  });
});
