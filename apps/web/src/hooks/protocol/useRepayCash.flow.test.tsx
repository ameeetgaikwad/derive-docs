// @vitest-environment jsdom

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRepayCash } from "./useRepayCash";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const USDT = "0x2222222222222222222222222222222222222222" as const;
const CASH = "0x3333333333333333333333333333333333333333" as const;
const MATCHING = "0x4444444444444444444444444444444444444444" as const;
const APPROVAL = `0x${"5".repeat(64)}` as const;
const DEPOSIT = `0x${"6".repeat(64)}` as const;
const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), wait: vi.fn(), switchChain: vi.fn(), refresh: vi.fn(), refetch: vi.fn() }));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: OWNER }), useConfig: () => ({}),
  useSwitchChain: () => ({ switchChainAsync: mocks.switchChain }),
  useReadContract: (input: { functionName: string }) => input.functionName === "decimals"
    ? { data: 6, isLoading: false }
    : { data: 2_000_000n, isLoading: false, refetch: mocks.refetch },
}));
vi.mock("wagmi/actions", () => ({ readContract: mocks.read, writeContract: mocks.write, waitForTransactionReceipt: mocks.wait }));
vi.mock("./useNetwork", () => ({ useNetwork: () => ({ chainId: 97, addresses: { usdt: USDT, cashAsset: CASH, matching: MATCHING } }) }));
vi.mock("./queryRefresh", () => ({ refreshFundsQueries: mocks.refresh }));

describe("useRepayCash flow", () => {
  let queryClient: QueryClient;
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  beforeEach(() => {
    window.localStorage.clear();
    queryClient = new QueryClient();
    mocks.read.mockReset().mockResolvedValue(0n);
    mocks.write.mockReset().mockResolvedValueOnce(APPROVAL).mockResolvedValueOnce(DEPOSIT);
    mocks.wait.mockReset().mockResolvedValue({ status: "success" });
    mocks.switchChain.mockReset().mockResolvedValue(undefined);
    mocks.refresh.mockReset().mockResolvedValue(undefined); mocks.refetch.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("switches chain, confirms approval and deposit, then refreshes before done", async () => {
    const { result } = renderHook(() => useRepayCash(), { wrapper });
    await act(async () => { await result.current.repay(7n, 1_000_100n); });
    expect(mocks.switchChain).toHaveBeenCalledWith({ chainId: 97 });
    expect(mocks.write.mock.calls.map(([, call]) => call.functionName)).toEqual(["approve", "deposit"]);
    expect(mocks.wait).toHaveBeenNthCalledWith(2, {}, { hash: DEPOSIT, chainId: 97 });
    expect(mocks.refresh).toHaveBeenCalledTimes(1); expect(mocks.refetch).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("done");
  });

  it("persists an uncertain broadcast and reconciles it without another deposit", async () => {
    mocks.wait
      .mockReset()
      .mockResolvedValueOnce({ status: "success" })
      .mockRejectedValueOnce(new Error("receipt RPC unavailable"));
    const first = renderHook(() => useRepayCash(), { wrapper });

    await act(async () => { await first.result.current.repay(7n, 1_000_100n); });
    expect(first.result.current.phase).toBe("unknown");
    expect(first.result.current.txHash).toBe(DEPOSIT);
    expect(mocks.write.mock.calls.map(([, call]) => call.functionName)).toEqual(["approve", "deposit"]);

    await act(async () => {
      await expect(first.result.current.repay(7n, 1_000_100n)).rejects.toThrow("still unresolved");
    });
    expect(mocks.write).toHaveBeenCalledTimes(2);

    first.unmount();
    const resumed = renderHook(() => useRepayCash(), { wrapper });
    expect(resumed.result.current.phase).toBe("unknown");
    expect(resumed.result.current.txHash).toBe(DEPOSIT);

    mocks.wait.mockResolvedValueOnce({ status: "success" });
    await act(async () => { await resumed.result.current.reconcile(); });
    expect(resumed.result.current.phase).toBe("done");
    expect(mocks.write).toHaveBeenCalledTimes(2);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });

  it("locks a hashless wallet submission until the user verifies no transaction", async () => {
    mocks.wait.mockReset().mockResolvedValueOnce({ status: "success" });
    mocks.write
      .mockReset()
      .mockResolvedValueOnce(APPROVAL)
      .mockRejectedValueOnce(new Error("wallet RPC disconnected"));
    const first = renderHook(() => useRepayCash(), { wrapper });

    await act(async () => { await first.result.current.repay(7n, 1_000_100n); });
    expect(first.result.current.phase).toBe("unknown");
    expect(first.result.current.txHash).toBeNull();
    await act(async () => {
      await expect(first.result.current.repay(7n, 1_000_100n)).rejects.toThrow("still unresolved");
    });
    expect(mocks.write).toHaveBeenCalledTimes(2);

    first.unmount();
    const resumed = renderHook(() => useRepayCash(), { wrapper });
    expect(resumed.result.current.phase).toBe("unknown");
    act(() => { resumed.result.current.acknowledgeNoTransaction(); });
    expect(resumed.result.current.phase).toBe("idle");
  });

  it("does not lock repayment when the wallet explicitly rejects the deposit", async () => {
    const rejected = Object.assign(new Error("User rejected"), { name: "UserRejectedRequestError" });
    mocks.wait.mockReset().mockResolvedValueOnce({ status: "success" });
    mocks.write.mockReset().mockResolvedValueOnce(APPROVAL).mockRejectedValueOnce(rejected);
    const { result } = renderHook(() => useRepayCash(), { wrapper });

    await act(async () => {
      await expect(result.current.repay(7n, 1_000_100n)).rejects.toBe(rejected);
    });
    expect(result.current.phase).toBe("error");
    expect(result.current.txHash).toBeNull();
  });

  it("keeps a confirmed repayment locked until debt and wallet refresh succeed", async () => {
    mocks.refresh.mockRejectedValueOnce(new Error("query RPC unavailable"));
    const { result } = renderHook(() => useRepayCash(), { wrapper });

    await act(async () => { await result.current.repay(7n, 1_000_100n); });
    expect(result.current.phase).toBe("unknown");
    expect(result.current.confirmedAwaitingRefresh).toBe(true);
    expect(window.localStorage.length).toBe(1);
    await act(async () => {
      await expect(result.current.repay(7n, 1_000_100n)).rejects.toThrow("still unresolved");
    });

    mocks.refresh.mockResolvedValueOnce(undefined);
    await act(async () => { await result.current.reconcile(); });
    expect(result.current.phase).toBe("done");
    expect(window.localStorage.length).toBe(0);
    // Approval + deposit receipts only; confirmed refresh reconciliation does
    // not wait for or submit another transaction.
    expect(mocks.wait).toHaveBeenCalledTimes(2);
    expect(mocks.write).toHaveBeenCalledTimes(2);
  });

  it("fails before deposit when the repayment intent cannot be stored durably", async () => {
    mocks.read.mockResolvedValue(2_000_000n);
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage denied");
    });
    const { result } = renderHook(() => useRepayCash(), { wrapper });

    await act(async () => {
      await expect(result.current.repay(7n, 1_000_100n)).rejects.toThrow(/safety record/i);
    });
    expect(mocks.write).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("error");
    storage.mockRestore();
  });

  it("fails closed when browser storage cannot be read", async () => {
    mocks.read.mockResolvedValue(2_000_000n);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage denied");
    });
    const { result } = renderHook(() => useRepayCash(), { wrapper });

    await act(async () => {
      await expect(result.current.repay(7n, 1_000_100n)).rejects.toThrow(/storage is unavailable/i);
    });
    expect(mocks.write).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("error");
  });
});
