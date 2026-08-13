// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAvailableStrikes } from "./useAvailableStrikes";

const mocks = vi.hoisted(() => ({
  feedReads: {
    data: undefined,
    isLoading: true,
  } as { data: unknown[] | undefined; isLoading: boolean },
  spot: {
    spotPrice: 70_000,
    indicative: false,
    isLoading: false,
  },
}));

vi.mock("wagmi", () => ({
  useReadContracts: () => mocks.feedReads,
}));

vi.mock("./useSpotPrice", () => ({
  useSpotPrice: () => mocks.spot,
}));

vi.mock("./useNetwork", () => ({
  useNetwork: () => ({
    chainId: 97,
    addresses: {
      btcForwardFeed: "0x1111111111111111111111111111111111111111",
      btcRateFeed: "0x2222222222222222222222222222222222222222",
      btcVolFeed: "0x3333333333333333333333333333333333333333",
    },
  }),
}));

describe("useAvailableStrikes loading behavior", () => {
  beforeEach(() => {
    mocks.feedReads.data = undefined;
    mocks.feedReads.isLoading = true;
    mocks.spot.spotPrice = 70_000;
    mocks.spot.indicative = false;
    mocks.spot.isLoading = false;
  });

  it("keeps fallback-priced rows visible while feed pricing loads", () => {
    const { result } = renderHook(() => useAvailableStrikes(null));

    expect(result.current.strikes.length).toBeGreaterThan(0);
    expect(result.current.strikes.every((strike) => strike.usedFallback)).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it("uses the skeleton only while the initial spot is unavailable", () => {
    mocks.spot.spotPrice = 0;
    mocks.spot.isLoading = true;
    const { result } = renderHook(() => useAvailableStrikes(null));

    expect(result.current.strikes).toHaveLength(0);
    expect(result.current.isLoading).toBe(true);
  });

  it("exposes the live forward and marks every pricing-input fallback", () => {
    const { result, rerender } = renderHook(() => useAvailableStrikes(null));
    const strikeCount = result.current.strikes.length;

    mocks.feedReads.data = [
      { status: "success", result: [71_000n * 10n ** 18n, 0n] },
      { status: "success", result: [5n * 10n ** 16n, 0n] },
      ...Array.from({ length: strikeCount }, () => ({
        status: "success",
        result: [6n * 10n ** 17n, 0n],
      })),
    ];
    mocks.feedReads.isLoading = false;
    rerender();

    expect(result.current.forwardPrice).toBe(71_000);
    expect(result.current.strikes.every((strike) => !strike.usedFallback)).toBe(true);

    mocks.feedReads.data = mocks.feedReads.data.map((entry, index) =>
      index === 1 ? { status: "failure", error: new Error("rate") } : entry,
    );
    rerender();
    expect(result.current.strikes.every((strike) => strike.usedFallback)).toBe(true);

    mocks.feedReads.data = mocks.feedReads.data.map((entry, index) =>
      index === 1
        ? { status: "success", result: [5n * 10n ** 16n, 0n] }
        : entry,
    );
    mocks.spot.indicative = true;
    rerender();
    expect(result.current.strikes.every((strike) => strike.usedFallback)).toBe(true);
  });
});
