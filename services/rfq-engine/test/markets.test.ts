import { describe, expect, it } from "vitest";
import { readMarketManifest, type MarketDefinition } from "@hedge/shared";
import {
  assertMarketTradeable,
  isMarketOpen,
  isUsEarlyCloseSession,
  isUsExchangeHoliday,
  marketStatus,
  rwaExpiries,
} from "../src/markets.js";

describe("market readiness", () => {
  const btc = readMarketManifest(56).markets.find((market) => market.id === "BTC")!;
  const staged = readMarketManifest(56).markets.find((market) => market.id === "NVDA")!;

  it("keeps BTC open 24/7", () => {
    expect(isMarketOpen(btc, Date.UTC(2026, 7, 8))).toBe(true);
  });

  it("reports staged markets as disabled", () => {
    expect(marketStatus(staged).status).toBe("disabled");
    expect(() => assertMarketTradeable(staged, 1n, 1n)).toThrow(/disabled/);
  });

  it("generates Friday 16:00 New York expiries across DST", () => {
    const [summer] = rwaExpiries(1, Date.UTC(2026, 6, 1));
    const [winter] = rwaExpiries(1, Date.UTC(2026, 11, 1));
    expect(new Date(summer * 1000).getUTCHours()).toBe(20);
    expect(new Date(winter * 1000).getUTCHours()).toBe(21);
  });

  it("excludes exchange holidays and early-close Fridays", () => {
    expect(isUsExchangeHoliday(2026, 4, 3)).toBe(true); // Good Friday
    expect(isUsEarlyCloseSession(2026, 11, 27)).toBe(true); // after Thanksgiving
    const [afterThanksgiving] = rwaExpiries(1, Date.UTC(2026, 10, 25));
    expect(new Date(afterThanksgiving * 1000).toISOString().slice(0, 10)).toBe("2026-12-04");
  });

  it("enforces per-market maximum size", () => {
    const enabled = { ...staged, enabled: true, contracts: btc.contracts, pythPriceId: btc.pythPriceId } as MarketDefinition;
    const [expiry] = rwaExpiries(1, Date.UTC(2026, 7, 6));
    expect(() => assertMarketTradeable(enabled, 101n * 10n ** 18n, BigInt(expiry), Date.UTC(2026, 7, 6))).toThrow(/maximum size/);
  });
});
