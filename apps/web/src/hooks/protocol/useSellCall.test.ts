// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import { encodeOptionSubId } from "@/lib/protocol/instruments";
import { hashRfqTrades } from "@/lib/protocol/rfq";
import { toUnit } from "@/lib/protocol/units";
import {
  acceptRfq,
  createRfq,
  getRfq,
  type PublicBestQuote,
  type RfqStatusResponse,
} from "@/lib/protocol/rfq-engine";
import { useSellCall, type SellParams } from "./useSellCall";

const optionAsset = "0x2222222222222222222222222222222222222222" as Address;

const mocks = vi.hoisted(() => ({
  signTypedDataAsync: vi.fn(),
  switchChainAsync: vi.fn(),
  network: {
    chainId: 97 as 56 | 97,
    addresses: {
      btcOptionAsset: "0x2222222222222222222222222222222222222222",
      rfqModule: "0x3333333333333333333333333333333333333333",
      matching: "0x4444444444444444444444444444444444444444",
    },
  },
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({
    address: "0x1111111111111111111111111111111111111111",
  }),
  useSignTypedData: () => ({ signTypedDataAsync: mocks.signTypedDataAsync }),
  useSwitchChain: () => ({ switchChainAsync: mocks.switchChainAsync }),
}));

vi.mock("./useNetwork", () => ({
  useNetwork: () => mocks.network,
}));

vi.mock("@/lib/protocol/rfq-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/protocol/rfq-engine")>();
  return {
    ...actual,
    createRfq: vi.fn(),
    getRfq: vi.fn(),
    acceptRfq: vi.fn(),
  };
});

const params: SellParams = {
  subaccountId: 7n,
  expiry: 1_900_000_000,
  strike: 75_000,
  amount: "0.5",
  instrumentName: "BTC-20300317-75000-C",
};

function bestQuote(now: number): PublicBestQuote {
  const trades = [
    {
      asset: optionAsset,
      subId: encodeOptionSubId({
        expiry: BigInt(params.expiry),
        strike: toUnit(params.strike),
        isCall: true,
      }),
      price: toUnit(1_000),
      amount: toUnit(params.amount),
    },
  ];
  return {
    quoteId: "quote-1",
    maker: "0x5555555555555555555555555555555555555555",
    makerSubaccountId: "9",
    premium: toUnit(1_000).toString(),
    totalPremium: toUnit(500).toString(),
    orderHash: hashRfqTrades(trades),
    trades: trades.map((trade) => ({
      asset: trade.asset,
      subId: trade.subId.toString(),
      price: trade.price.toString(),
      amount: trade.amount.toString(),
    })),
    actionExpiry: String(Math.floor(now / 1000) + 60),
  };
}

function closedStatus(now: number): RfqStatusResponse {
  return {
    rfq: {
      id: "rfq-1",
      takerSubaccountId: "7",
      direction: "sell",
      instrument: {
        name: params.instrumentName,
        currency: "BTC",
        optionAsset,
        expiry: String(params.expiry),
        strike: toUnit(params.strike).toString(),
        isCall: true,
        subId: "1",
      },
      amount: toUnit(params.amount).toString(),
      createdAt: now,
      auctionEndsAt: now,
      acceptDeadlineAt: now + 30_000,
      status: "closed",
    },
    quoteCount: 3,
    bestQuote: bestQuote(now),
    execution: null,
    error: null,
  };
}

describe("useSellCall paused RFQ lifecycle", () => {
  beforeEach(() => {
    const now = Date.now();
    mocks.network.chainId = 97;
    mocks.signTypedDataAsync.mockReset().mockResolvedValue(`0x${"11".repeat(65)}`);
    mocks.switchChainAsync.mockReset().mockResolvedValue(undefined);
    vi.mocked(createRfq).mockReset().mockResolvedValue({ id: "rfq-1" } as never);
    vi.mocked(getRfq).mockReset().mockResolvedValue(closedStatus(now));
    vi.mocked(acceptRfq).mockReset().mockResolvedValue({
      txHash: `0x${"22".repeat(32)}` as Hex,
      status: "success",
      blockNumber: "1",
      fill: {
        rfqId: "rfq-1",
        quoteId: "quote-1",
        instrument: params.instrumentName,
        maker: "0x5555555555555555555555555555555555555555",
        makerSubaccountId: "9",
        takerSubaccountId: "7",
        amount: toUnit(params.amount).toString(),
        premium: toUnit(1_000).toString(),
        totalPremium: toUnit(500).toString(),
        makerFee: "0",
        takerFee: "0",
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("pauses on a verified winning quote before signing", async () => {
    const { result } = renderHook(() => useSellCall());

    await act(async () => {
      await result.current.requestQuote(params);
    });

    expect(result.current.phase).toBe("quoted");
    expect(result.current.quote?.totalPremium).toBe(500);
    expect(mocks.signTypedDataAsync).not.toHaveBeenCalled();
    expect(acceptRfq).not.toHaveBeenCalled();
  });

  it("accepts only after the explicit sign action and keeps the captured chain", async () => {
    const { result, rerender } = renderHook(() => useSellCall());
    await act(async () => {
      await result.current.requestQuote(params);
    });

    mocks.network.chainId = 56;
    rerender();

    await act(async () => {
      await result.current.acceptQuote();
    });

    expect(mocks.switchChainAsync).toHaveBeenCalledWith({ chainId: 97 });
    expect(vi.mocked(acceptRfq).mock.calls[0]?.[3]).toBe(97);
    expect(result.current.phase).toBe("done");
    expect(result.current.result?.totalPremium).toBe(500);
  });

  it("returns to the quoted state after a rejected wallet signature", async () => {
    const { result } = renderHook(() => useSellCall());
    await act(async () => {
      await result.current.requestQuote(params);
    });
    mocks.signTypedDataAsync.mockRejectedValueOnce(new Error("User rejected"));

    await act(async () => {
      await expect(result.current.acceptQuote()).rejects.toThrow("User rejected");
    });

    expect(result.current.phase).toBe("quoted");
    expect(result.current.error).toBe("User rejected");
  });

  it("does not retry a quote after execution has been submitted", async () => {
    const { result } = renderHook(() => useSellCall());
    await act(async () => {
      await result.current.requestQuote(params);
    });
    vi.mocked(acceptRfq).mockRejectedValueOnce(new Error("Execution failed"));

    await act(async () => {
      await expect(result.current.acceptQuote()).rejects.toThrow("Execution failed");
    });

    expect(result.current.phase).toBe("error");
  });

  it("surfaces an error when no maker quote wins the auction", async () => {
    vi.mocked(getRfq).mockResolvedValueOnce({
      ...closedStatus(Date.now()),
      rfq: { ...closedStatus(Date.now()).rfq, status: "expired" },
      bestQuote: null,
      quoteCount: 0,
    });
    const { result } = renderHook(() => useSellCall());

    await act(async () => {
      await expect(result.current.requestQuote(params)).rejects.toThrow(
        "No executable quotes",
      );
    });

    expect(result.current.phase).toBe("error");
  });

  it("expires a prepared quote at the server deadline", async () => {
    vi.useFakeTimers();
    const now = 1_800_000_000_000;
    vi.setSystemTime(now);
    vi.mocked(getRfq).mockResolvedValueOnce({
      ...closedStatus(now),
      rfq: { ...closedStatus(now).rfq, acceptDeadlineAt: now + 1_000 },
    });
    const { result } = renderHook(() => useSellCall());

    await act(async () => {
      await result.current.requestQuote(params);
    });
    await act(async () => {
      vi.advanceTimersByTime(1_100);
    });

    expect(result.current.phase).toBe("expired");
  });

  it("does not submit when the quote expires inside the wallet prompt", async () => {
    vi.useFakeTimers();
    const now = 1_800_000_000_000;
    vi.setSystemTime(now);
    vi.mocked(getRfq).mockResolvedValueOnce({
      ...closedStatus(now),
      rfq: { ...closedStatus(now).rfq, acceptDeadlineAt: now + 1_000 },
    });
    mocks.signTypedDataAsync.mockImplementationOnce(async () => {
      vi.setSystemTime(now + 1_100);
      return `0x${"11".repeat(65)}`;
    });
    const { result } = renderHook(() => useSellCall());

    await act(async () => {
      await result.current.requestQuote(params);
    });
    await act(async () => {
      await expect(result.current.acceptQuote()).rejects.toThrow(
        "expired before it could be submitted",
      );
    });

    expect(acceptRfq).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("expired");
  });
});
