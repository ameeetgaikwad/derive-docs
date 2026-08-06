import { describe, expect, it } from "vitest";

import {
  buildOracleExpirySet,
  parseExpiryList,
  tradeableFridayExpiries,
} from "../src/expiryPolicy.js";

describe("oracle expiry policy", () => {
  it("keeps active positions after they leave the frontend's >24h tradeable window", () => {
    // Thursday 09:00 UTC: Friday 08:00 is only 23h away and no longer tradeable.
    const now = BigInt(Date.UTC(2026, 7, 6, 9, 0, 0) / 1000);
    const nearExpiry = BigInt(Date.UTC(2026, 7, 7, 8, 0, 0) / 1000);
    const tradeable = tradeableFridayExpiries(2, now);

    expect(tradeable).not.toContain(nearExpiry);
    expect(
      buildOracleExpirySet({ nowSec: now, tradeable, active: [nearExpiry] }).posting,
    ).toEqual([nearExpiry, ...tradeable]);
  });

  it("sorts, deduplicates, and removes already-expired live-feed entries", () => {
    const now = 1_000n;
    expect(
      buildOracleExpirySet({
        nowSec: now,
        tradeable: [3_000n, 2_000n],
        active: [2_000n, 900n],
        extra: [4_000n, 3_000n],
      }),
    ).toEqual({
      tradeable: [2_000n, 3_000n],
      active: [2_000n],
      extra: [3_000n, 4_000n],
      posting: [2_000n, 3_000n, 4_000n],
    });
  });

  it("validates break-glass expiry configuration", () => {
    expect(parseExpiryList("1786089600, 1786694400")).toEqual([1786089600n, 1786694400n]);
    expect(() => parseExpiryList("tomorrow", "ORACLE_EXTRA_EXPIRIES")).toThrow(
      /non-integer expiry/,
    );
  });
});
