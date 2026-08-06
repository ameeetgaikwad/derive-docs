import type { DeribitClient } from "@hedge/shared";
import { describe, expect, it } from "vitest";

import { buildDeribitSnapshot } from "../src/deribitSnapshot.js";

describe("Deribit snapshot fail-closed mode", () => {
  const client = {
    getBoard: async () => ({ currency: "BTC", indexPrice: 65_000, expiries: [] }),
  } as unknown as DeribitClient;

  it("rejects a missing surface when flat fallback is disabled", async () => {
    await expect(
      buildDeribitSnapshot({
        expiries: [1_800_000_000n],
        now: 1_790_000_000,
        client,
        allowFlatFallback: false,
      }),
    ).rejects.toThrow(/flat-IV fallback is disabled/);
  });

  it("retains the explicit testnet/local fallback mode", async () => {
    const result = await buildDeribitSnapshot({
      expiries: [1_800_000_000n],
      now: 1_790_000_000,
      client,
      allowFlatFallback: true,
    });
    expect(result.snapshot.expiries).toHaveLength(1);
    expect(result.fitted[0]?.used).toBe(false);
  });
});
