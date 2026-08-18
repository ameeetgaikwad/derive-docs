import { describe, expect, it } from "vitest";
import {
  amount18ToToken,
  getMarkets,
  getSelectableMarkets,
  rawAmount18ToUi18,
  tokenAmountTo18,
  uiAmount18ToRaw18,
} from "./markets";

describe("multi-asset amount conversion", () => {
  it("loads enabled NVDA and the disabled SPY placeholder from the mainnet staging manifest", () => {
    const markets = getMarkets(56);
    expect(markets.map((market) => market.id)).toEqual(["BTC", "XAU", "SPY", "NVDA"]);
    expect(markets.filter((market) => market.enabled).map((market) => market.id)).toEqual([
      "BTC",
      "XAU",
      "NVDA",
    ]);
    expect(markets[0]?.contracts?.optionAsset).toBe("0x3464351F36fb79Eb06a04785bDaF8DCb8FBC42bc");
    expect(markets[3]).toMatchObject({ id: "NVDA", enabled: true, maxSize: "0.25" });
  });

  it("keeps SpaceX out of the user-facing market selector", () => {
    expect(getSelectableMarkets(97).map((market) => market.id)).toEqual([
      "BTC",
      "XAU",
      "SPY",
      "NVDA",
    ]);
  });

  it("round-trips BEP-8056 display and raw amounts", () => {
    const multiplier = 250_000_000_000_000_000n;
    const uiAmount = 2n * 10n ** 18n;
    const raw = uiAmount18ToRaw18(uiAmount, multiplier);
    expect(raw).toBe(8n * 10n ** 18n);
    expect(rawAmount18ToUi18(raw, multiplier)).toBe(uiAmount);
  });

  it("converts six-decimal XAUt amounts without losing protocol precision", () => {
    const native = 1_250_000n;
    const normalized = tokenAmountTo18(native, 6);
    expect(normalized).toBe(1_250_000_000_000_000_000n);
    expect(amount18ToToken(normalized, 6)).toBe(native);
  });
});
