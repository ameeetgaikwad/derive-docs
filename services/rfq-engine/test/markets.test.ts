import { describe, expect, it } from "vitest";
import { readMarketManifest, type MarketDefinition } from "@hedge/shared";
import {
  assertMarketFeedsReady,
  assertMarketTradeable,
  isMarketOpen,
  isUsEarlyCloseSession,
  isUsExchangeHoliday,
  marketStatus,
  marketFeedUpdatedAt,
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
    const enabled = {
      ...staged,
      enabled: true,
      collateral: { ...staged.collateral, scaledUi: false },
      contracts: btc.contracts,
      pythPriceId: btc.pythPriceId,
    } as MarketDefinition;
    const [expiry] = rwaExpiries(1, Date.UTC(2026, 7, 6));
    expect(() => assertMarketTradeable(enabled, 101n * 10n ** 18n, BigInt(expiry), Date.UTC(2026, 7, 6))).toThrow(/maximum size/);
  });

  it("defers scaled maximum-size validation to the live multiplier check", () => {
    const enabled = { ...staged, enabled: true, contracts: btc.contracts, pythPriceId: btc.pythPriceId } as MarketDefinition;
    const [expiry] = rwaExpiries(1, Date.UTC(2026, 7, 6));
    expect(() => assertMarketTradeable(
      enabled,
      101n * 10n ** 18n,
      BigInt(expiry),
      Date.UTC(2026, 7, 6),
    )).not.toThrow();
  });

  it("rejects a scaled raw amount above the displayed market cap", async () => {
    const scaled = {
      ...staged,
      enabled: true,
      maxSize: "0.1",
      collateral: { ...staged.collateral, address: "0x0000000000000000000000000000000000000011" },
      contracts: {
        ...btc.contracts!,
        multiplierRegistry: "0x0000000000000000000000000000000000000012",
      },
      pythPriceId: btc.pythPriceId,
    } as MarketDefinition;
    const currentMultiplier = 2n * 10n ** 18n;
    const client = {
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === "getSpot") return [1n, 1n];
        if (functionName === "getForwardPrice") return [1n, 1n];
        if (functionName === "getVol") return [1n, 1n];
        if (functionName === "getInterestRate") return [0n, 1n];
        if (functionName === "uiMultiplier" || functionName === "multiplierAt") {
          return currentMultiplier;
        }
        if (functionName === "newUIMultiplier" || functionName === "effectiveAt") return 0n;
        throw new Error(`unexpected read ${functionName}`);
      },
      getBlock: async () => ({ timestamp: 1_000n }),
    };

    await expect(assertMarketFeedsReady(
      client as never,
      scaled,
      2_000n,
      100n,
      50_000_000_000_000_001n,
    )).rejects.toThrow(/maximum size 0.1/);
    await expect(assertMarketFeedsReady(
      client as never,
      scaled,
      2_000n,
      100n,
      50_000_000_000_000_000n,
    )).resolves.toBeUndefined();
  });

  it("reads Chainlink freshness without calling a Pyth contract", async () => {
    const chainlink = {
      ...staged,
      enabled: true,
      oracleProvider: "chainlink",
      pythPriceId: null,
      chainlinkAggregator: "0xea5c2Cbb5cD57daC24E26180b19a929F3E9699B8",
      contracts: btc.contracts,
    } as MarketDefinition;
    const calls: string[] = [];
    const client = {
      readContract: async ({ functionName }: { functionName: string }) => {
        calls.push(functionName);
        if (functionName === "uiSpotFeed") return "0x0000000000000000000000000000000000000011";
        if (functionName === "aggregator") return chainlink.chainlinkAggregator;
        if (functionName === "latestRoundData") return [10n, 12_345_678_900n, 0n, 1_781_000_000n, 10n];
        throw new Error(`unexpected read ${functionName}`);
      },
    };

    await expect(marketFeedUpdatedAt(client as never, chainlink)).resolves.toBe(1_781_000_000);
    expect(calls).toEqual(["uiSpotFeed", "aggregator", "latestRoundData"]);
  });
});
