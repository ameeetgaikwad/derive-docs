import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

  it("enables only the deployed BTC mainnet staging market with a 0.01 BTC RFQ cap", () => {
    const path = fileURLToPath(
      new URL("../../../protocol/deployments/staging/markets/56.json", import.meta.url),
    );
    const manifest = validateMarketManifest(JSON.parse(readFileSync(path, "utf8")), 56);
    expect(manifest.markets).toHaveLength(1);
    expect(manifest.markets[0]).toMatchObject({
      id: "BTC",
      enabled: true,
      maxSize: "0.01",
      contracts: {
        marketId: 1,
        optionAsset: "0x3464351F36fb79Eb06a04785bDaF8DCb8FBC42bc",
        baseAsset: "0xb0fF629283DFF33675fCC3142771eBAF7dA5981D",
        spotFeed: "0xBa978A13b1bb2B83922c1f5eB6B6F1CbF6c518Ff",
        signedSpotFeed: "0xF496d4696AE9F86A7e18B03389225Fad5246104e",
        forwardFeed: "0x33a30E6F51aEf99C45886098628857a66737769c",
        volFeed: "0x88C7455d67eA9F79Ac3F69a8B96A998028d0C0AA",
        rateFeed: "0xa705887d409047c20ab3eB9A4595f6Aa5d15ed8E",
        settlementFeed: "0x05E16b2cB43ce1a69865C276604CBDcfCAE82AcF",
      },
    });
  });
});
