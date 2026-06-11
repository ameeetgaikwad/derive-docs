import { describe, expect, it } from "vitest";
import {
  decodeOptionSubId,
  encodeOptionSubId,
  instrumentName,
  instrumentNameFromSubId,
  parseInstrumentName,
} from "../src/instruments.js";
import { toUnit } from "../src/units.js";

describe("OptionEncoding subId (lyra-utils bit layout)", () => {
  const expiry = 1781712000n; // 2026-06-17 16:00 UTC (fits uint32)
  const strike = toUnit("110000"); // $110k, 18dp

  it("round-trips encode/decode", () => {
    const subId = encodeOptionSubId({ expiry, strike, isCall: true });
    const decoded = decodeOptionSubId(subId);
    expect(decoded.expiry).toBe(expiry);
    expect(decoded.strike).toBe(strike);
    expect(decoded.isCall).toBe(true);

    const putId = encodeOptionSubId({ expiry, strike, isCall: false });
    expect(decodeOptionSubId(putId)).toEqual({ expiry, strike, isCall: false });
  });

  it("matches the exact bit layout: isCall<<95 | (strike/1e10)<<32 | expiry", () => {
    const subId = encodeOptionSubId({ expiry, strike, isCall: true });
    const expected = (1n << 95n) | ((strike / 10n ** 10n) << 32n) | expiry;
    expect(subId).toBe(expected);
    expect(subId >> 96n).toBe(0n); // fits uint96
  });

  it("enforces the same constraints as the Solidity library", () => {
    expect(() => encodeOptionSubId({ expiry: 0n, strike, isCall: true })).toThrow("OE_ZeroExpiry");
    expect(() =>
      encodeOptionSubId({ expiry: 2n ** 32n, strike, isCall: true }),
    ).toThrow("OE_ExpiryTooLarge");
    expect(() =>
      encodeOptionSubId({ expiry, strike: strike + 1n, isCall: true }),
    ).toThrow("OE_StrikeTooGranular");
    expect(() =>
      encodeOptionSubId({ expiry, strike: toUnit("92233720369"), isCall: true }),
    ).toThrow("OE_StrikeTooLarge");
  });

  it("formats and parses instrument names", () => {
    const name = instrumentName({ expiry, strike, isCall: true });
    expect(name).toBe("BTC-20260617-110000-C");

    const subId = encodeOptionSubId({ expiry, strike, isCall: true });
    expect(instrumentNameFromSubId(subId)).toBe(name);

    const parsed = parseInstrumentName(name);
    expect(parsed.currency).toBe("BTC");
    expect(parsed.strike).toBe(strike);
    expect(parsed.isCall).toBe(true);
    expect(parsed.expiryDate).toBe("20260617");

    const parsedRaw = parseInstrumentName(`BTC-${expiry}-110000-C`);
    expect(parsedRaw.expiry).toBe(expiry);
  });
});
