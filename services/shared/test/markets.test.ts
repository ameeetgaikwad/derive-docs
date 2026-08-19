import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { enabledMarkets, readMarketManifest, validateMarketManifest } from "../src/markets.js";

describe("market manifests", () => {
  it("loads the production manifest with BTC enabled and RWA markets staged", () => {
    const manifest = readMarketManifest(56);
    expect(manifest.markets.map((market) => market.id)).toEqual(["BTC", "XAU", "SPY", "NVDA", "SPCX"]);
    expect(enabledMarkets(manifest).map((market) => market.id)).toEqual(["BTC"]);
    expect(manifest.markets.find((market) => market.id === "NVDA")).toMatchObject({
      collateral: { scaledUi: true },
      oracleProvider: "chainlink",
      pythPriceId: null,
      chainlinkAggregator: "0xea5c2Cbb5cD57daC24E26180b19a929F3E9699B8",
    });
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

  it("accepts an enabled Chainlink market without a Pyth price id", () => {
    const manifest = readMarketManifest(56);
    const btc = manifest.markets.find((market) => market.id === "BTC")!;
    const chainlink = {
      ...btc,
      oracleProvider: "chainlink",
      pythPriceId: null,
      chainlinkAggregator: "0xea5c2Cbb5cD57daC24E26180b19a929F3E9699B8",
      contracts: {
        ...btc.contracts!,
        settlementFixingFeed: btc.contracts!.settlementFeed,
      },
    };

    expect(validateMarketManifest({ ...manifest, markets: [chainlink] }).markets[0]).toMatchObject({
      oracleProvider: "chainlink",
      pythPriceId: null,
      chainlinkAggregator: "0xea5c2Cbb5cD57daC24E26180b19a929F3E9699B8",
    });
  });

  it("rejects an enabled Chainlink market without an aggregator", () => {
    const manifest = readMarketManifest(56);
    const btc = manifest.markets.find((market) => market.id === "BTC")!;
    const chainlink = {
      ...btc,
      oracleProvider: "chainlink",
      pythPriceId: null,
      chainlinkAggregator: null,
    };

    expect(() => validateMarketManifest({ ...manifest, markets: [chainlink] })).toThrow(
      /BTC is enabled without a Chainlink aggregator/,
    );
  });

  it("rejects an enabled Chainlink market without a settlement fixing feed", () => {
    const manifest = readMarketManifest(56);
    const btc = manifest.markets.find((market) => market.id === "BTC")!;
    const chainlink = {
      ...btc,
      oracleProvider: "chainlink",
      pythPriceId: null,
      chainlinkAggregator: "0xea5c2Cbb5cD57daC24E26180b19a929F3E9699B8",
    };

    expect(() => validateMarketManifest({ ...manifest, markets: [chainlink] })).toThrow(
      /BTC is enabled without a Chainlink settlement fixing feed/,
    );
  });

  it("rejects a zero Pyth price id", () => {
    const manifest = readMarketManifest(56);
    const btc = manifest.markets.find((market) => market.id === "BTC")!;

    expect(() => validateMarketManifest({
      ...manifest,
      markets: [{ ...btc, pythPriceId: `0x${"0".repeat(64)}` }],
    })).toThrow(/BTC.pythPriceId is zero/);
  });

  it("normalizes legacy provider fields to Pyth", () => {
    const manifest = readMarketManifest(56);
    const btc = manifest.markets.find((market) => market.id === "BTC")!;
    const legacy = Object.fromEntries(
      Object.entries(btc).filter(([key]) => key !== "oracleProvider" && key !== "chainlinkAggregator"),
    );

    expect(validateMarketManifest({ ...manifest, markets: [legacy] }).markets[0]).toMatchObject({
      oracleProvider: "pyth",
      chainlinkAggregator: null,
    });
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

  it("loads deployed BTC, XAU, SPY, and NVDA mainnet staging markets with conservative RFQ caps", () => {
    const path = fileURLToPath(
      new URL("../../../protocol/deployments/staging/markets/56.json", import.meta.url),
    );
    const manifest = validateMarketManifest(JSON.parse(readFileSync(path, "utf8")), 56);
    expect(manifest.markets).toHaveLength(4);
    expect(enabledMarkets(manifest).map((market) => market.id)).toEqual(["BTC", "XAU", "SPY", "NVDA"]);
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
    expect(manifest.markets[1]).toMatchObject({ id: "XAU", enabled: true, maxSize: "0.01" });
    expect(manifest.markets[2]).toMatchObject({
      id: "SPY",
      enabled: true,
      maxSize: "0.1",
      oracleProvider: "chainlink",
      pythPriceId: null,
      chainlinkAggregator: "0xb24D1DeE5F9a3f761D286B56d2bC44CE1D02DF7e",
      contracts: {
        marketId: 4,
        optionAsset: "0x393e13a7104A6F3FF79BD9B83180C9Df6dB8950D",
        spotFeed: "0x7DcF2a26E80F16ae85F22F412bA6C00c0d94ECF8",
        signedSpotFeed: "0xcB1d64B06E3673d8F11acdc69c0AC0d6AE14c1b7",
        settlementFixingFeed: "0x83A12D6c5c122c5666Ac26Ef2313Cf392aa918d7",
        multiplierRegistry: "0xe1f96f15f0C4cA688AA4C0F1980dbE6aCC92aA56",
      },
    });
    expect(manifest.markets[3]).toMatchObject({
      id: "NVDA",
      enabled: true,
      oracleProvider: "chainlink",
      pythPriceId: null,
      chainlinkAggregator: "0xea5c2Cbb5cD57daC24E26180b19a929F3E9699B8",
      contracts: {
        marketId: 3,
        settlementFixingFeed: "0xF6e9cCbF35242Da3B4920Ed6b4A9A6F3026076C7",
        multiplierRegistry: "0x0eDd73fFE1D6539d5dF27b79692E50A799493f91",
      },
    });
    expect(manifest.markets.slice(2).map((market) => market.enabled)).toEqual([true, true]);
  });
});
