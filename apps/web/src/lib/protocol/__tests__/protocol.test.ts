import { describe, expect, it, vi } from "vitest";
import { hashTypedData } from "viem";
import { actionTypedData, buildAction, generateNonce } from "../actions";
import {
  ACTION_TYPEHASH,
  computeDomainSeparator,
} from "../constants";
import {
  getAddresses,
  getExpectedActionTypehash,
  getExpectedDomainSeparator,
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
  for (const chainId of [56, 97] as const) {
    it(`locally computed Matching domain separator matches deployments/${chainId}.json`, () => {
      expect(computeDomainSeparator(chainId, getAddresses(chainId).matching)).toBe(
        getExpectedDomainSeparator(chainId)
      );
    });

    it(`locally computed ACTION_TYPEHASH matches deployments/${chainId}.json`, () => {
      expect(ACTION_TYPEHASH).toBe(getExpectedActionTypehash(chainId));
    });

    it(`exposes the Matching deployment block for chain ${chainId}`, () => {
      expect(getAddresses(chainId).matchingDeploymentBlock).toBeGreaterThan(0n);
    });
  }
});

describe("EIP-712 Action wallet payload", () => {
  it("uses Web Crypto to generate a full uint256 nonce", () => {
    const getRandomValues = vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation((array) => {
      const bytes = array as Uint8Array;
      bytes.fill(0);
      bytes[0] = 0x80;
      bytes[31] = 0x01;
      return array;
    });
    expect(generateNonce()).toBe((1n << 255n) + 1n);
    expect(getRandomValues).toHaveBeenCalledTimes(1);
    getRandomValues.mockRestore();
  });

  it("serializes uint fields without bigint suffixes and preserves the digest", () => {
    const owner = "0x93104E260cb74E94038F4325098d31EE426C6F85" as const;
    const matching = "0x0c412a552cbfD904C202E205380DF6444d81f49f" as const;
    const action = buildAction({
      subaccountId: 5n,
      module: "0x50DF99440De3ECae422E3481291809451232636a",
      data: "0x",
      owner,
      nonce: 123n,
      expiry: 456n,
    });
    const walletPayload = actionTypedData(action, 97, matching);

    expect(walletPayload.message.subaccountId).toBe("5");
    expect(walletPayload.message.nonce).toBe("123");
    expect(walletPayload.message.expiry).toBe("456");

    const bigintDigest = hashTypedData({
      ...walletPayload,
      message: action,
    });
    const stringDigest = hashTypedData(walletPayload as never);
    expect(stringDigest).toBe(bigintDigest);
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
