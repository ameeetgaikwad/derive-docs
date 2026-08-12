import { describe, expect, it } from "vitest";
import type { MarketDefinition } from "@hedge/shared";
import type { MakerBotConfig } from "../src/config.js";
import { makePriceSource, pricingConfigForMarket } from "../src/pricing.js";

function config(): MakerBotConfig {
  return {
    chainId: 56,
    rpcUrl: "http://localhost:8545",
    wsUrl: "ws://localhost:3030/maker",
    bidRatio: 0.95,
    askRatio: 1.05,
    maxFee: "0",
    depositUsdt: "1000",
    subaccountId: null,
    stateFile: "maker-state.json",
    forwardOverride: 100_000,
    spotOverride: null,
    ivOverride: 0.6,
    rate: 0.05,
    quoteTtlSec: 300,
    deribitVol: false,
    marketBidRatios: {},
    marketAskRatios: {},
    marketForwardOverrides: {},
    marketSpotOverrides: {},
    marketIvOverrides: {},
    marketRates: {},
  };
}

const nvda = { id: "NVDA" } as MarketDefinition;

describe("multi-market price-source isolation", () => {
  it("does not apply legacy BTC overrides to an RWA market", () => {
    const resolved = pricingConfigForMarket(config(), "NVDA");
    expect(resolved.forwardOverride).toBeNull();
    expect(resolved.ivOverride).toBeNull();
    expect(() => makePriceSource(config(), null, nvda)).toThrow(/Pricing needs/);
  });

  it("uses market-qualified overrides for that market only", async () => {
    const cfg = config();
    cfg.marketForwardOverrides.NVDA = 220;
    cfg.marketIvOverrides.NVDA = 0.35;
    cfg.marketRates.NVDA = 0.02;
    const source = makePriceSource(cfg, null, nvda);
    await expect(source.getInputs({ expiry: 1n, strike: 1n })).resolves.toEqual({
      forward: 220,
      vol: 0.35,
      rate: 0.02,
    });
  });
});
