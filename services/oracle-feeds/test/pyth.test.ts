import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_HERMES_URL,
  fetchHermesUpdate,
  formatPythPrice,
  selectFreshPythMarkets,
} from "../src/pyth.js";

const BTC_ID = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43" as const;
const SPY_ID = `0x${"1".repeat(64)}` as const;
const NVDA_ID = `0x${"2".repeat(64)}` as const;

describe("formatPythPrice", () => {
  it("renders negative exponents", () => {
    expect(formatPythPrice("6294482013451", -8)).toBe("62944.82013451");
    expect(formatPythPrice("4095852786", -8)).toBe("40.95852786");
    expect(formatPythPrice("5", -2)).toBe("0.05");
  });

  it("renders zero/positive exponents", () => {
    expect(formatPythPrice("62000", 0)).toBe("62000");
    expect(formatPythPrice("620", 2)).toBe("62000");
  });

  it("strips trailing zeros and handles negatives", () => {
    expect(formatPythPrice("6200000000", -8)).toBe("62");
    expect(formatPythPrice("-6200000000", -8)).toBe("-62");
  });
});

describe("fetchHermesUpdate", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses the Hermes latest-update response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        binary: { encoding: "hex", data: ["504e4155deadbeef"] },
        parsed: [
          { id: BTC_ID.slice(2), price: { price: "6294482013451", conf: "4095852786", expo: -8, publish_time: 1781250765 } },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const update = await fetchHermesUpdate(BTC_ID);
    expect(update.data).toBe("0x504e4155deadbeef");
    expect(update.price).toEqual({
      price: "6294482013451",
      conf: "4095852786",
      expo: -8,
      publishTime: 1781250765,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${DEFAULT_HERMES_URL}/v2/updates/price/latest?ids[]=${BTC_ID}&encoding=hex`,
    );
  });

  it("throws on HTTP errors and missing data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" }));
    await expect(fetchHermesUpdate(BTC_ID)).rejects.toThrow(/Hermes 404/);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    await expect(fetchHermesUpdate(BTC_ID)).rejects.toThrow(/missing binary update data/);
  });
});

describe("selectFreshPythMarkets", () => {
  it("keeps live markets updating while deferred markets are stale or missing", () => {
    const markets = [
      { marketId: "BTC", priceId: BTC_ID },
      { marketId: "SPY", priceId: SPY_ID },
      { marketId: "NVDA", priceId: NVDA_ID },
    ];
    const prices = new Map([
      [BTC_ID.toLowerCase(), { price: "65000", conf: "1", expo: 0, publishTime: 990 }],
      [SPY_ID.toLowerCase(), { price: "770", conf: "1", expo: 0, publishTime: 800 }],
    ]);

    const selected = selectFreshPythMarkets(markets, prices, 1_000n, 45n);
    expect(selected.fresh.map((market) => market.marketId)).toEqual(["BTC"]);
    expect(selected.skipped).toEqual([
      { marketId: "SPY", age: 200n, reason: "stale Hermes source" },
      { marketId: "NVDA", age: null, reason: "missing parsed Hermes price" },
    ]);
  });
});
