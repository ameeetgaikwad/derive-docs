import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Address, Hex } from "viem";
import {
  mergeSidecarIntoManifest,
  parseAddMarketSidecar,
  parseDeployMarkets,
  priceIdForMarket,
  setManifestMarketEnabled,
  type AddMarketSidecar,
  type ManifestFile,
} from "./rwa-testnet.js";
import { readOracleBinding } from "./rwa-testnet-operator.js";
import {
  verifyChainlinkSource,
  verifyStagingSequence,
} from "./rwa-mainnet-staging-operator.js";

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
      oracleProvider: "pyth",
      pythPriceId: null,
      chainlinkAggregator: null,
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
    oracleProvider: "pyth",
    pythSpotFeed: A("7"),
    chainlinkSpotFeed: A("0"),
    scaledSpotFeed: A("0"),
    scaledSettlementFeed: A("0"),
    multiplierRegistry: A("0"),
    benchmarkSettlementFeed: A("8"),
    liveSpotFeed: A("7"),
    optionAsset: A("9"),
    pythPriceId: PRICE_ID,
    chainlinkAggregator: null,
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

  it("parses, stages, and verifies a Chainlink binding without any Pyth call", async () => {
    const aggregator = "0xea5c2Cbb5cD57daC24E26180b19a929F3E9699B8" as Address;
    const manifest: ManifestFile = {
      ...xauManifest(),
      markets: [{
        ...xauManifest().markets[0]!,
        oracleProvider: "chainlink",
        pythPriceId: null,
        chainlinkAggregator: aggregator,
      }],
    };
    const parsed = parseAddMarketSidecar({
      ...xauSidecar(),
      oracleProvider: "chainlink",
      pythSpotFeed: A("0"),
      chainlinkSpotFeed: A("b"),
      liveSpotFeed: A("b"),
      benchmarkSettlementFeed: A("0"),
      settlementFeed: A("c"),
      liveSettlementFeed: A("c"),
      pythPriceId: `0x${"0".repeat(64)}`,
      chainlinkAggregator: aggregator,
    }, "XAU");

    assert.equal(parsed.pythPriceId, null);
    const staged = mergeSidecarIntoManifest(manifest, "XAU", parsed);
    assert.equal(staged.markets[0]!.oracleProvider, "chainlink");
    assert.equal(staged.markets[0]!.chainlinkAggregator, aggregator);
    assert.equal(
      staged.markets[0]!.contracts?.settlementFixingFeed?.toLowerCase(),
      A("c").toLowerCase(),
    );
    assert.equal(setManifestMarketEnabled(staged, "XAU", true).markets[0]!.enabled, true);

    const calls: string[] = [];
    const binding = await readOracleBinding({
      readContract: async ({ functionName }: { functionName: string }) => {
        calls.push(functionName);
        if (functionName === "aggregator") return aggregator;
        throw new Error(`unexpected read ${functionName}`);
      },
    } as never, staged.markets[0]!);
    assert.equal(binding.provider, "chainlink");
    assert.equal(binding.adapter.toLowerCase(), A("b").toLowerCase());
    if (binding.provider === "chainlink") assert.equal(binding.aggregator, aggregator);
    assert.deepEqual(calls, ["aggregator"]);

    let description = "XAU / USD";
    let blockTimestamp = 1_781_000_100n;
    const sourceClient = {
      getCode: async () => "0x01",
      getBlock: async () => ({ timestamp: blockTimestamp }),
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === "description") return description;
        if (functionName === "decimals") return 8;
        if (functionName === "latestRoundData") {
          return [10n, 12_345_678_900n, 0n, 1_781_000_000n, 10n];
        }
        throw new Error(`unexpected read ${functionName}`);
      },
    };
    await assert.doesNotReject(verifyChainlinkSource(sourceClient as never, manifest.markets[0]!));
    description = "NOT XAU / USD";
    await assert.rejects(
      verifyChainlinkSource(sourceClient as never, manifest.markets[0]!),
      /description/,
    );
    description = "XAU / USD";
    blockTimestamp = 1_781_100_000n;
    await assert.rejects(
      verifyChainlinkSource(sourceClient as never, manifest.markets[0]!),
      (error: unknown) => error instanceof Error && error.name === "StaleChainlinkSourceError",
    );
    assert.equal(priceIdForMarket(manifest, "XAU", {}), null);
    assert.throws(() => parseAddMarketSidecar({
      ...xauSidecar(),
      oracleProvider: "chainlink",
      pythSpotFeed: A("0"),
      chainlinkSpotFeed: A("b"),
      scaledUi: true,
      scaledSpotFeed: A("d"),
      liveSpotFeed: A("d"),
      multiplierRegistry: A("e"),
      scaledSettlementFeed: A("0"),
      settlementFeed: A("c"),
      liveSettlementFeed: A("c"),
      benchmarkSettlementFeed: A("0"),
      pythPriceId: `0x${"0".repeat(64)}`,
      chainlinkAggregator: aggregator,
    }, "XAU"), /scaled settlement feed/);
    assert.throws(() => parseAddMarketSidecar({
      ...xauSidecar(),
      oracleProvider: "chainlink",
      pythSpotFeed: A("0"),
      chainlinkSpotFeed: A("b"),
      liveSpotFeed: A("b"),
      benchmarkSettlementFeed: A("0"),
      settlementFeed: A("c"),
      liveSettlementFeed: A("d"),
      pythPriceId: `0x${"0".repeat(64)}`,
      chainlinkAggregator: aggregator,
    }, "XAU"), /live settlement feed is not the Chainlink fixing feed/);

  });

  it("allows NVDA before SPY after XAU and enforces the staging slot cap", async () => {
    let lastMarketId = 2n;
    const client = {
      readContract: async ({ functionName }: { functionName: string }) =>
        functionName === "lastMarketId" ? lastMarketId : false,
    };

    await assert.doesNotReject(
      verifyStagingSequence(client as never, { standardManager: A("1") } as never, "NVDA"),
    );
    lastMarketId = 3n;
    await assert.doesNotReject(
      verifyStagingSequence(client as never, { standardManager: A("1") } as never, "SPY"),
    );
    lastMarketId = 4n;
    await assert.rejects(
      verifyStagingSequence(client as never, { standardManager: A("1") } as never, "SPY"),
      /no remaining RWA market slot/,
    );
  });
});
