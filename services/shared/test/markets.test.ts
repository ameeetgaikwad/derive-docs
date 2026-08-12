import { describe, expect, it } from "vitest";
import { enabledMarkets, readMarketManifest, validateMarketManifest } from "../src/markets.js";

describe("market manifests", () => {
  it("loads the production manifest with BTC enabled and RWA markets staged", () => {
    const manifest = readMarketManifest(56);
    expect(manifest.markets.map((market) => market.id)).toEqual(["BTC", "XAU", "SPY", "NVDA", "SPCX"]);
    expect(enabledMarkets(manifest).map((market) => market.id)).toEqual(["BTC"]);
    expect(manifest.markets.find((market) => market.id === "NVDA")?.collateral.scaledUi).toBe(true);
  });

  it("rejects duplicate ids", () => {
    const manifest = readMarketManifest(56);
    expect(() => validateMarketManifest({ ...manifest, markets: [manifest.markets[0], manifest.markets[0]] })).toThrow(/duplicate market id BTC/);
  });

  it("rejects enabled markets without deployed contracts", () => {
    const manifest = readMarketManifest(56);
    const xau = manifest.markets.find((market) => market.id === "XAU")!;
    expect(() => validateMarketManifest({ ...manifest, markets: [{ ...xau, enabled: true }] })).toThrow(/enabled without contracts/);
  });

  it("rejects a zero collateral token address", () => {
    const manifest = readMarketManifest(56);
    const btc = manifest.markets.find((market) => market.id === "BTC")!;
    const invalid = {
      ...btc,
      collateral: { ...btc.collateral, address: "0x0000000000000000000000000000000000000000" },
    };
    expect(() => validateMarketManifest({ ...manifest, markets: [invalid] })).toThrow(
      /collateral.address is zero/,
    );
  });

  it("uses production symbols for testnet mock markets", () => {
    const manifest = readMarketManifest(97);
    expect(manifest.markets.map((market) => market.collateral.symbol)).toEqual([
      "BTCB",
      "XAUt",
      "SPYB",
      "NVDAB",
      "SPCXB",
    ]);
  });
});
