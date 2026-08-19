import { describe, expect, it } from "vitest";
import { bufferedRepayTokenUnits, cashDebtToTokenUnits } from "./useRepayCash";

describe("cashDebtToTokenUnits", () => {
  it("rounds a sub-token cash debt up so repayment cannot leave dust", () => {
    expect(cashDebtToTokenUnits(1_234_567_000_000_000_001n, 6)).toBe(1_234_568n);
    expect(cashDebtToTokenUnits(1_234_567_000_000_000_000n, 6)).toBe(1_234_567n);
  });

  it("does not use floating point for large debts", () => {
    expect(cashDebtToTokenUnits(90_071_992_547_409_931_234_567_890n, 18))
      .toBe(90_071_992_547_409_931_234_567_890n);
  });

  it("adds the exact one-basis-point repayment buffer before native-unit rounding", () => {
    expect(bufferedRepayTokenUnits(1_000n * 10n ** 18n, 6)).toBe(1_000_100_000n);
    expect(bufferedRepayTokenUnits(1n, 6)).toBe(1n);
  });
});
