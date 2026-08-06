import { describe, expect, it } from "vitest";
import {
  calculateCoveredCallScenario,
  scenarioRange,
} from "./covered-call-scenario";

describe("covered-call expiry scenarios", () => {
  it("keeps the BTC value and premium below the strike", () => {
    expect(
      calculateCoveredCallScenario({
        spotPrice: 70_000,
        strikePrice: 75_000,
        expiryPrice: 65_000,
        amount: 0.5,
        totalPremium: 500,
      }),
    ).toEqual({
      settlementPayment: 0,
      btcValue: 32_500,
      coveredPositionValue: 33_000,
      isAboveStrike: false,
    });
  });

  it("has no settlement payment exactly at the strike", () => {
    const result = calculateCoveredCallScenario({
      spotPrice: 70_000,
      strikePrice: 75_000,
      expiryPrice: 75_000,
      amount: 0.25,
      totalPremium: 250,
    });

    expect(result.settlementPayment).toBe(0);
    expect(result.coveredPositionValue).toBe(19_000);
    expect(result.isAboveStrike).toBe(false);
  });

  it("offsets BTC gains above the strike through cash settlement", () => {
    const result = calculateCoveredCallScenario({
      spotPrice: 70_000,
      strikePrice: 75_000,
      expiryPrice: 90_000,
      amount: 0.5,
      totalPremium: 500,
    });

    expect(result.settlementPayment).toBe(7_500);
    expect(result.btcValue).toBe(45_000);
    expect(result.coveredPositionValue).toBe(38_000);
    expect(result.isAboveStrike).toBe(true);
  });

  it("builds a rounded 50–150% simulation range", () => {
    expect(scenarioRange(70_050)).toEqual({
      min: 35_000,
      max: 105_100,
      step: 100,
    });
  });
});
