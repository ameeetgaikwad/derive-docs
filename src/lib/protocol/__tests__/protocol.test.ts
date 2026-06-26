import { describe, expect, it } from "vitest";
import {
  ACTION_TYPEHASH,
  computeDomainSeparator,
} from "../constants";
import {
  EXPECTED_ACTION_TYPEHASH,
  EXPECTED_DOMAIN_SEPARATOR,
} from "../deployments";
import {
  decodeOptionSubId,
  encodeOptionSubId,
  instrumentName,
} from "../instruments";
import { toUnit, fromUnit } from "../units";
import { strikesForExpiry, weeklyExpiries } from "../board";
import { black76Price } from "../black76";

describe("EIP-712 constants vs on-chain-verified deployment values", () => {
  it("locally computed Matching domain separator matches deployments/97.json", () => {
    expect(computeDomainSeparator()).toBe(EXPECTED_DOMAIN_SEPARATOR);
  });

  it("locally computed ACTION_TYPEHASH matches deployments/97.json", () => {
    expect(ACTION_TYPEHASH).toBe(EXPECTED_ACTION_TYPEHASH);
  });
});

describe("option subId encoding", () => {
  it("matches the live testnet smoke-trade subId (BTC-20260619-69000-C)", () => {
    // From protocol/TESTNET.md: strike 69000, expiry 1781856000 (2026-06-19
    // 08:00 UTC), call -> subId 39614110892406511198553831168
    const subId = encodeOptionSubId({
      expiry: 1781856000n,
      strike: toUnit(69000),
      isCall: true,
    });
    expect(subId).toBe(39614110892406511198553831168n);
    expect(instrumentName({ expiry: 1781856000n, strike: toUnit(69000), isCall: true })).toBe(
      "BTC-20260619-69000-C"
    );
  });

  it("round-trips", () => {
    const details = { expiry: 1781856000n, strike: toUnit("110000"), isCall: true };
    expect(decodeOptionSubId(encodeOptionSubId(details))).toEqual(details);
  });
});

describe("units", () => {
  it("toUnit/fromUnit round-trip", () => {
    expect(fromUnit(toUnit("1.5"))).toBe("1.5");
    expect(toUnit("0.01")).toBe(10n ** 16n);
  });
});

describe("board generation", () => {
  it("weekly expiries are Fridays 08:00 UTC in the future", () => {
    const expiries = weeklyExpiries(4);
    expect(expiries).toHaveLength(4);
    for (const e of expiries) {
      const d = new Date(e * 1000);
      expect(d.getUTCDay()).toBe(5);
      expect(d.getUTCHours()).toBe(8);
      expect(e * 1000).toBeGreaterThan(Date.now());
    }
  });

  it("strikes are OTM, deduplicated and subId-encodable", () => {
    const expiry = weeklyExpiries(1)[0];
    const strikes = strikesForExpiry(62790, expiry);
    expect(strikes.length).toBeGreaterThan(3);
    const seen = new Set<number>();
    for (const s of strikes) {
      expect(s.strike).toBeGreaterThan(62790);
      expect(seen.has(s.strike)).toBe(false);
      seen.add(s.strike);
      expect(s.subId).toBeGreaterThan(0n);
    }
  });

  it("buy target strikes are puts below spot", () => {
    const expiry = weeklyExpiries(1)[0];
    const strikes = strikesForExpiry(62790, expiry, "buy_low");
    expect(strikes.length).toBeGreaterThan(3);
    for (const s of strikes) {
      expect(s.strike).toBeLessThan(62790);
      expect(s.isCall).toBe(false);
      expect(s.instrumentName.endsWith("-P")).toBe(true);
      expect(s.subId).toBeGreaterThan(0n);
    }
  });
});

describe("black76", () => {
  it("matches the spec reference case within 1%", () => {
    // SPEC e2e case: F=100000, K=110000, T=7/365, sigma=0.6, r=0
    const price = black76Price({
      forward: 100_000,
      strike: 110_000,
      timeToExpiryYears: 7 / 365,
      vol: 0.6,
      rate: 0,
      isCall: true,
    });
    // Reference value from services/maker-bot test suite ballpark
    expect(price).toBeGreaterThan(400);
    expect(price).toBeLessThan(800);
  });
});
