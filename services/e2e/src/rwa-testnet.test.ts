import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Address, Hex } from "viem";
import {
  mergeSidecarIntoManifest,
  parseDeployMarkets,
  setManifestMarketEnabled,
  type AddMarketSidecar,
  type ManifestFile,
} from "./rwa-testnet.js";

const A = (digit: string) => `0x${digit.repeat(40)}` as Address;
const PRICE_ID = `0x${"a".repeat(64)}` as Hex;

function xauManifest(): ManifestFile {
  return {
    chainId: 97,
    marketCount: 1,
    markets: [{
      id: "XAU",
      displayName: "Gold",
      kind: "metal",
      enabled: false,
      collateral: { symbol: "XAUt", address: null, decimals: 6, scaledUi: false },
      contracts: null,
      pythPriceId: null,
      marketHours: "24/5",
      strikeIncrement: 25,
      riskVolFloor: 0.18,
      maxSize: "10",
    }],
  };
}

function xauSidecar(): AddMarketSidecar {
  return {
    chainId: 97,
    name: "XAU",
    marketId: 2,
    underlying: A("1"),
    spotFeed: A("2"),
    forwardFeed: A("3"),
    volFeed: A("4"),
    rateFeed: A("5"),
    settlementFeed: A("0"),
    liveSettlementFeed: A("6"),
    pythSpotFeed: A("7"),
    scaledSpotFeed: A("0"),
    multiplierRegistry: A("0"),
    benchmarkSettlementFeed: A("8"),
    liveSpotFeed: A("7"),
    optionAsset: A("9"),
    pythPriceId: PRICE_ID,
    baseAsset: A("a"),
    underlyingDecimals: 6,
    scaledUi: false,
  };
}

describe("RWA testnet deployment helpers", () => {
  it("parses a deduplicated deployment market selection", () => {
    assert.deepEqual(parseDeployMarkets(["xau,nvda", "XAU"]), ["XAU", "NVDA"]);
    assert.deepEqual(parseDeployMarkets([]), ["XAU", "SPY", "NVDA"]);
    assert.throws(() => parseDeployMarkets(["BTC"]), /unsupported RWA market/);
  });

  it("merges a sidecar without enabling the market", () => {
    const next = mergeSidecarIntoManifest(xauManifest(), "XAU", xauSidecar());
    const market = next.markets[0]!;
    assert.equal(market.enabled, false);
    assert.equal(market.collateral.address, A("1"));
    assert.equal(market.contracts?.spotFeed, A("7"));
    assert.equal(market.contracts?.signedSpotFeed, A("2"));
    assert.equal(market.contracts?.settlementFeed, A("6"));
    assert.equal(market.pythPriceId, PRICE_ID);
  });

  it("preserves a chain-56 staging manifest when merging a sidecar", () => {
    const manifest = { ...xauManifest(), chainId: 56 };
    const sidecar = { ...xauSidecar(), chainId: 56 };
    const next = mergeSidecarIntoManifest(manifest, "XAU", sidecar);
    assert.equal(next.chainId, 56);
    assert.equal(next.markets[0]?.enabled, false);
  });

  it("only enables a fully staged market", () => {
    assert.throws(
      () => setManifestMarketEnabled(xauManifest(), "XAU", true),
      /has not been fully deployed/,
    );
    const staged = mergeSidecarIntoManifest(xauManifest(), "XAU", xauSidecar());
    assert.equal(setManifestMarketEnabled(staged, "XAU", true).markets[0]!.enabled, true);
    assert.equal(setManifestMarketEnabled(staged, "XAU", false).markets[0]!.enabled, false);
  });
});
