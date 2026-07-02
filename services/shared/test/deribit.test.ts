import { describe, expect, it } from "vitest";
import {
  DeribitClient,
  buildBoard,
  parseDeribitExpiryDate,
  parseDeribitInstrument,
  type DeribitOption,
} from "../src/deribit.js";

// ---------------------------------------------------------------------------
// Fixture: a tiny synthetic BTC option board in Deribit's JSON-RPC shape.
// mark_iv is in PERCENTAGE POINTS, exactly as the real API returns it.
// ---------------------------------------------------------------------------
const NOW = 1_780_000_000; // fixed "now" for deterministic expiry filtering
const EXPIRY_SEC = parseDeribitExpiryDate("30MAY26"); // 2026-05-30 08:00 UTC

const bookSummaryFixture = {
  jsonrpc: "2.0",
  result: [
    // future in the book — must be ignored by the option-only fetch shape
    {
      instrument_name: "BTC-30MAY26-90000-C",
      mark_iv: 62.5,
      underlying_price: 100000,
      underlying_index: "BTC-30MAY26",
      mid_price: 0.12,
      bid_price: 0.11,
      ask_price: 0.13,
      mark_price: 0.12,
    },
    {
      instrument_name: "BTC-30MAY26-100000-C",
      mark_iv: 58.0,
      underlying_price: 100010,
      underlying_index: "BTC-30MAY26",
      mid_price: 0.06,
      bid_price: 0.055,
      ask_price: 0.065,
      mark_price: 0.06,
    },
    {
      instrument_name: "BTC-30MAY26-110000-P",
      mark_iv: 61.0,
      underlying_price: 99990,
      underlying_index: "BTC-30MAY26",
      mid_price: 0.09,
      bid_price: 0.085,
      ask_price: 0.095,
      mark_price: 0.09,
    },
    // expired (30MAY20) — must be filtered out by buildBoard
    {
      instrument_name: "BTC-30MAY20-100000-C",
      mark_iv: 55.0,
      underlying_price: 9000,
      underlying_index: "BTC-30MAY20",
      mid_price: 0.01,
      bid_price: 0.009,
      ask_price: 0.011,
      mark_price: 0.01,
    },
  ],
};

const indexFixture = { jsonrpc: "2.0", result: { index_price: 100000, estimated_delivery_price: 100000 } };

function fixtureFetch(): typeof fetch {
  return (async (input: string | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    let body: unknown;
    if (url.includes("get_book_summary_by_currency")) body = bookSummaryFixture;
    else if (url.includes("get_index_price")) body = indexFixture;
    else throw new Error(`unexpected fetch: ${url}`);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => body,
    } as Response;
  }) as unknown as typeof fetch;
}

describe("Deribit instrument name parsing", () => {
  it("parses DDMMMYY strike C/P at 08:00 UTC", () => {
    const p = parseDeribitInstrument("BTC-27JUN25-100000-C");
    expect(p.currency).toBe("BTC");
    expect(p.strike).toBe(100000);
    expect(p.isCall).toBe(true);
    expect(p.expiry).toBe(Math.floor(Date.UTC(2025, 5, 27, 8, 0, 0) / 1000));
    expect(parseDeribitInstrument("BTC-27JUN25-100000-P").isCall).toBe(false);
  });

  it("rejects malformed names", () => {
    expect(() => parseDeribitInstrument("BTC-27JUN25-100000")).toThrow();
    expect(() => parseDeribitInstrument("BTC-27JUN25-100000-X")).toThrow();
  });
});

describe("DeribitClient (mocked fetch)", () => {
  it("converts mark_iv % -> fraction and groups by expiry", async () => {
    const client = new DeribitClient({ fetchImpl: fixtureFetch() });
    const board = await client.getBoard("BTC", NOW);

    expect(board.indexPrice).toBe(100000);
    expect(board.expiries).toHaveLength(1); // expired slice dropped
    const slice = board.expiries[0]!;
    expect(slice.expiry).toBe(EXPIRY_SEC);
    // median of {90000,100010,99990} underlyings = 99990..100000; robust ~100k
    expect(slice.forward).toBeGreaterThan(99000);
    expect(slice.forward).toBeLessThan(101000);
    expect(slice.options).toHaveLength(3);

    const atm = slice.options.find((o) => o.strike === 100000)!;
    expect(atm.markIv).toBeCloseTo(0.58, 6); // 58.0% -> 0.58
    expect(atm.isCall).toBe(true);
  });

  it("getIndexPrice reads btc_usd", async () => {
    const client = new DeribitClient({ fetchImpl: fixtureFetch() });
    expect(await client.getIndexPrice("BTC")).toBe(100000);
  });
});

describe("buildBoard filtering", () => {
  it("drops options with null/zero mark_iv and past expiries", () => {
    const opts: DeribitOption[] = [
      { instrumentName: "BTC-30MAY26-100000-C", expiry: EXPIRY_SEC, strike: 100000, isCall: true, markIv: 0.5, underlyingPrice: 100000, underlyingIndex: "x", midPrice: 1, bidPrice: 1, askPrice: 1, markPrice: 1 },
      { instrumentName: "BTC-30MAY26-110000-C", expiry: EXPIRY_SEC, strike: 110000, isCall: true, markIv: null, underlyingPrice: 100000, underlyingIndex: "x", midPrice: 1, bidPrice: 1, askPrice: 1, markPrice: 1 },
    ];
    const board = buildBoard(opts, 100000, NOW);
    expect(board.expiries[0]!.options).toHaveLength(1);
  });
});
