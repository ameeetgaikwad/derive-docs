import { describe, expect, it } from "vitest";
import type { DeploymentsFile } from "@hedge/shared";
import { anchoredFeedFromDeployments } from "../src/anchored.js";

const FEED = "0xC496c4a67cBf83591ec24821D3afd1B94718055d" as const;

describe("anchoredFeedFromDeployments", () => {
  it("resolves btcSettlementFeed when present", () => {
    const d: DeploymentsFile = { chainId: 97, btcSettlementFeed: FEED };
    expect(anchoredFeedFromDeployments(d)).toBe(FEED);
  });

  it("returns undefined when the key is missing (signed-feed-only deployment)", () => {
    const d: DeploymentsFile = { chainId: 31337, btcOptionAsset: FEED };
    expect(anchoredFeedFromDeployments(d)).toBeUndefined();
  });

  it("returns undefined for the zero address (anvil fallback deployment)", () => {
    const d: DeploymentsFile = {
      chainId: 31337,
      btcSettlementFeed: "0x0000000000000000000000000000000000000000",
    };
    expect(anchoredFeedFromDeployments(d)).toBeUndefined();
  });

  it("ignores malformed values", () => {
    const d: DeploymentsFile = { chainId: 97, btcSettlementFeed: "not-an-address" };
    expect(anchoredFeedFromDeployments(d)).toBeUndefined();
  });
});
