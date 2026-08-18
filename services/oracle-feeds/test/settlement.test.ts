import { describe, expect, it } from "vitest";
import { readMarketManifest, type MarketDefinition } from "@hedge/shared";
import { SettlementRunner, settlementFeedsForMarket } from "../src/settlement.js";

describe("settlement feed selection", () => {
  const manifest = readMarketManifest(56);
  const btc = manifest.markets.find((market) => market.id === "BTC")!;
  const nvda = manifest.markets.find((market) => market.id === "NVDA")!;

  it("uses the Chainlink fixing feed without exposing a Pyth benchmark path", () => {
    const market = {
      ...nvda,
      oracleProvider: "chainlink",
      contracts: {
        ...btc.contracts!,
        settlementFixingFeed: btc.contracts!.signedSpotFeed,
      },
    } as MarketDefinition;

    expect(settlementFeedsForMarket(market)).toEqual({
      settlementFeed: btc.contracts!.settlementFeed,
      anchoredSettlementFeed: btc.contracts!.signedSpotFeed,
    });

    expect(() => settlementFeedsForMarket({
      ...market,
      contracts: btc.contracts,
    } as MarketDefinition)).toThrow(/Chainlink settlement fixing feed/);
  });

  it("keeps Pyth RWA benchmark and legacy crypto anchor selection", () => {
    const rwa = { ...nvda, oracleProvider: "pyth", contracts: btc.contracts } as MarketDefinition;
    expect(settlementFeedsForMarket(rwa)).toEqual({
      settlementFeed: btc.contracts!.settlementFeed,
      benchmarkSettlementFeed: btc.contracts!.settlementFeed,
    });
    expect(settlementFeedsForMarket(btc, btc.contracts!.settlementFeed)).toEqual({
      settlementFeed: btc.contracts!.settlementFeed,
      anchoredSettlementFeed: btc.contracts!.settlementFeed,
    });
  });

  it("reports the live scaled settlement price after fixing the Chainlink anchor", async () => {
    const expiry = 1_800_000_000n;
    const fixingFeed = btc.contracts!.signedSpotFeed;
    const liveSettlementFeed = btc.contracts!.settlementFeed;
    const publicClient = {
      readContract: async ({ address, functionName }: { address: string; functionName: string }) => {
        if (functionName !== "getSettlementPrice") {
          throw new Error(`unexpected read ${functionName}`);
        }
        if (address.toLowerCase() === fixingFeed.toLowerCase()) {
          return [true, 240_000_000_000_000_000_000n] as const;
        }
        if (address.toLowerCase() === liveSettlementFeed.toLowerCase()) {
          return [true, 60_000_000_000_000_000_000n] as const;
        }
        throw new Error(`unexpected settlement feed ${address}`);
      },
    };
    const runner = new SettlementRunner(
      publicClient as never,
      {} as never,
      {} as never,
      { chainNow: async () => expiry } as never,
      {
        standardManager: btc.contracts!.optionAsset,
        optionAsset: btc.contracts!.optionAsset,
        subAccounts: btc.contracts!.optionAsset,
        cashAsset: btc.contracts!.baseAsset,
        baseAsset: btc.contracts!.baseAsset,
        assetSymbol: "NVDA",
        collateralSymbol: "NVDAB",
        settlementFeed: liveSettlementFeed,
        anchoredSettlementFeed: fixingFeed,
      },
    );

    const report = await runner.run({ expiry, subaccounts: [] });

    expect(report.settlementPrice).toBe(60_000_000_000_000_000_000n);
  });
});
