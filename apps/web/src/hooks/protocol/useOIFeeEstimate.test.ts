// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOIFeeEstimate } from "./useOIFeeEstimate";

const ONE = 10n ** 18n;
const mocks = vi.hoisted(() => ({
  reads: {
    data: [
      { status: "success", result: 10n * 10n ** 18n },
      { status: "success", result: 10n ** 15n },
    ],
    isLoading: false,
    error: null,
  },
}));

vi.mock("wagmi", () => ({
  useReadContracts: () => mocks.reads,
}));

vi.mock("./useNetwork", () => ({
  useNetwork: () => ({
    chainId: 97,
    addresses: {
      standardManager: "0x1111111111111111111111111111111111111111",
      srmViewer: "0x2222222222222222222222222222222222222222",
      btcOptionAsset: "0x3333333333333333333333333333333333333333",
    },
  }),
}));

describe("useOIFeeEstimate", () => {
  beforeEach(() => {
    mocks.reads.data = [
      { status: "success", result: 10n * ONE },
      { status: "success", result: 10n ** 15n },
    ];
    mocks.reads.isLoading = false;
    mocks.reads.error = null;
  });

  it("applies the live minimum fee floor to a small covered call", () => {
    const { result } = renderHook(() =>
      useOIFeeEstimate({ amount: "0.05", forwardPrice: 70_000 }),
    );

    expect(result.current.isAvailable).toBe(true);
    expect(result.current.perSideFee18).toBe(10n * ONE);
    expect(result.current.perSideFeeUsd).toBe(10);
    expect(result.current.rate18).toBe(10n ** 15n);
  });

  it("uses the exact live rate math when it exceeds the floor", () => {
    const { result } = renderHook(() =>
      useOIFeeEstimate({ amount: "1", forwardPrice: 100_000 }),
    );

    expect(result.current.perSideFee18).toBe(100n * ONE);
    expect(result.current.perSideFeeUsd).toBe(100);
  });

  it("does not expose a fee before both live reads resolve", () => {
    mocks.reads.data = [];
    mocks.reads.isLoading = true;

    const { result } = renderHook(() =>
      useOIFeeEstimate({ amount: "0.05", forwardPrice: 70_000 }),
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAvailable).toBe(false);
    expect(result.current.perSideFeeUsd).toBeNull();
  });
});
