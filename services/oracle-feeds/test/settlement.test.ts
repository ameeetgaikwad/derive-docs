import { describe, expect, it } from "vitest";
import { readMarketManifest, type MarketDefinition } from "@hedge/shared";
import { settlementFeedsForMarket } from "../src/settlement.js";

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
      benchmarkSettlementFeed: btc.contracts!.settlementFeed,
    });
    expect(settlementFeedsForMarket(btc, btc.contracts!.settlementFeed)).toEqual({
      anchoredSettlementFeed: btc.contracts!.settlementFeed,
    });
  });
});
