import { describe, expect, it } from "vitest";
import {
  mergeHistoryWithSpot,
  parseBinanceKlines,
  parseCoinbaseCandles,
} from "./bitcoin-history";

describe("BTC price history", () => {
  it("parses Binance daily closes and ignores malformed rows", () => {
    expect(
      parseBinanceKlines([
        [1_700_000_000_000, "1", "2", "0.5", "42000"],
        ["bad", "1", "2", "0.5", "43000"],
        [1_700_086_400_000, "1", "2", "0.5", "not-a-price"],
      ]),
    ).toEqual([{ time: 1_700_000_000, value: 42_000 }]);
  });

  it("sorts Coinbase candles from oldest to newest", () => {
    expect(
      parseCoinbaseCandles([
        [1_700_086_400, 0, 0, 0, 43_000, 1],
        [1_700_000_000, 0, 0, 0, 42_000, 1],
      ]),
    ).toEqual([
      { time: 1_700_000_000, value: 42_000 },
      { time: 1_700_086_400, value: 43_000 },
    ]);
  });

  it("keeps only the latest 30 unique daily points", () => {
    const candles = Array.from({ length: 32 }, (_, index) => [
      1_700_000_000 + index * 86_400,
      0,
      0,
      0,
      40_000 + index,
      1,
    ]);
    candles.push([...candles.at(-1)!]);

    const result = parseCoinbaseCandles(candles);
    expect(result).toHaveLength(30);
    expect(result[0].value).toBe(40_002);
    expect(result.at(-1)?.value).toBe(40_031);
  });

  it("ends the exchange history at the authoritative on-chain spot", () => {
    const history = [
      { time: 1, value: 41_000 },
      { time: 2, value: 42_000 },
    ];

    expect(mergeHistoryWithSpot(history, 43_500)).toEqual([
      { time: 1, value: 41_000 },
      { time: 2, value: 43_500 },
    ]);
    expect(history.at(-1)?.value).toBe(42_000);
  });
});
