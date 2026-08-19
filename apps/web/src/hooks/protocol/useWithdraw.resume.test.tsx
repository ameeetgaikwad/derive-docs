// @vitest-environment jsdom

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters } from "viem";
import { ACTION_TYPES } from "@/lib/protocol/constants";
import { useWithdraw } from "./useWithdraw";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const MATCHING = "0x2222222222222222222222222222222222222222" as const;
const MODULE = "0x3333333333333333333333333333333333333333" as const;
const mocks = vi.hoisted(() => ({
  getWithdrawal: vi.fn(), previewWithdrawal: vi.fn(), prepareWithdrawal: vi.fn(), submitWithdrawal: vi.fn(),
  refresh: vi.fn(), sign: vi.fn(), switchChain: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: OWNER }),
  useSignTypedData: () => ({ signTypedDataAsync: mocks.sign }),
  useSwitchChain: () => ({ switchChainAsync: mocks.switchChain }),
}));
vi.mock("./useNetwork", () => ({ useNetwork: () => ({ chainId: 97, addresses: { matching: MATCHING, withdrawalModule: MODULE } }) }));
vi.mock("./queryRefresh", () => ({ refreshFundsQueries: mocks.refresh }));
vi.mock("@/lib/protocol/withdrawals", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/protocol/withdrawals")>()),
  getWithdrawal: mocks.getWithdrawal,
  previewWithdrawal: mocks.previewWithdrawal, prepareWithdrawal: mocks.prepareWithdrawal, submitWithdrawal: mocks.submitWithdrawal,
}));

function record(status: "unknown" | "confirmed") {
  return {
    id: "w-resume", status, chainId: 97, matching: MATCHING, owner: OWNER, subaccountId: "7",
    asset: { assetId: "cash", kind: "cash", marketId: null, symbol: "USDT", assetAddress: MODULE, tokenAddress: OWNER, tokenDecimals: 6, scaledUi: false },
    tokenUnits: "1", maxWithdrawableAtPrepare: "1", previewBlockHash: `0x${"1".repeat(64)}`,
    preparedAtBlockNumber: "10", preparedAtBlockHash: `0x${"2".repeat(64)}`,
    action: { subaccountId: "7", nonce: "1", module: MODULE, data: "0x", expiry: "1900000000", owner: OWNER, signer: OWNER },
    actionDigest: `0x${"3".repeat(64)}`, createdAt: 1, expiresAt: Date.now() + 30_000,
    submittedAt: 1, confirmedAt: status === "confirmed" ? 2 : null, txHash: status === "confirmed" ? `0x${"4".repeat(64)}` : null,
    blockNumber: status === "confirmed" ? "11" : null, error: null,
  } as const;
}

function flowFixtures() {
  const asset = "0x4444444444444444444444444444444444444444" as const;
  const token = "0x5555555555555555555555555555555555555555" as const;
  const blockHash = `0x${"1".repeat(64)}` as const;
  const action = {
    subaccountId: "7", nonce: "1", module: MODULE,
    data: encodeAbiParameters([{ type: "tuple", components: [{ name: "asset", type: "address" }, { name: "assetAmount", type: "uint256" }] }], [{ asset, assetAmount: 1_250_000n }]),
    expiry: "1900000000", owner: OWNER, signer: OWNER,
  };
  const preview = {
    chainId: 97, matching: MATCHING, withdrawalModule: MODULE, owner: OWNER, subaccountId: "7",
    asset: { assetId: "cash", kind: "cash", marketId: null, symbol: "USDT", assetAddress: asset, tokenAddress: token, tokenDecimals: 6, scaledUi: false },
    internalBalance: "2000000000000000000", balanceTokenUnits: "2000000", cashWithInterest: "2000000000000000000", debtTokenUnits: "0",
    margin: { initial: { margin: "0", markToMarket: "0" }, maintenance: { margin: "0", markToMarket: "0" } }, protocolMaxTokenUnits: "2000000", recommendedMaxTokenUnits: "1900000", multiplier: "1000000000000000000",
    blockNumber: "10", blockHash, checkedAt: 1, expiresAt: Date.now() + 30_000, blocker: null,
  } as const;
  const prepared = {
    withdrawalId: "w-live", action,
    typedData: { domain: { name: "Matching", version: "1.0", chainId: 97, verifyingContract: MATCHING }, types: ACTION_TYPES, primaryType: "Action", message: action },
    review: { recipient: OWNER, assetId: "cash", assetAddress: asset, tokenAddress: token, tokenUnits: "1250000", displayAmount: "1.25", tokenDecimals: 6, multiplier: "1000000000000000000", preparedBlockNumber: "11", preparedBlockHash: `0x${"2".repeat(64)}` },
  } as const;
  const snapshot = { displayAmount: "1.25", tokenUnits: 1_250_000n, tokenDecimals: 6, multiplier: "1000000000000000000" };
  return { asset, token, action, preview, prepared, snapshot };
}

describe("useWithdraw persisted reconciliation", () => {
  let queryClient: QueryClient;
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;

  beforeEach(() => {
    vi.useFakeTimers(); window.localStorage.clear();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mocks.getWithdrawal.mockReset().mockRejectedValueOnce(new Error("temporary outage")).mockResolvedValueOnce(record("unknown")).mockResolvedValueOnce(record("confirmed"));
    mocks.refresh.mockReset().mockResolvedValue(undefined);
    mocks.sign.mockReset().mockResolvedValue(`0x${"9".repeat(130)}`);
    mocks.switchChain.mockReset().mockResolvedValue(undefined);
    mocks.previewWithdrawal.mockReset(); mocks.prepareWithdrawal.mockReset(); mocks.submitWithdrawal.mockReset();
    window.localStorage.setItem(`hedge.withdrawal-operation:97:${MATCHING.toLowerCase()}:${OWNER.toLowerCase()}`, "w-resume");
  });
  afterEach(() => vi.useRealTimers());

  it("keeps retrying a stored id after the first GET fails and clears it only after refresh", async () => {
    const { result } = renderHook(() => useWithdraw(), { wrapper });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.phase).toBe("unknown");
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(mocks.getWithdrawal).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
    expect(result.current.phase).toBe("done");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(window.localStorage.length).toBe(0);
  });

  it("previews, freezes, signs, submits, and refreshes before done", async () => {
    window.localStorage.clear(); vi.clearAllTimers();
    const { asset, token, action, preview, prepared, snapshot } = flowFixtures();
    mocks.previewWithdrawal.mockResolvedValue(preview);
    mocks.prepareWithdrawal.mockResolvedValue(prepared);
    mocks.submitWithdrawal.mockResolvedValue({ ...record("confirmed"), id: "w-live", tokenUnits: "1250000", action });
    const { result } = renderHook(() => useWithdraw(), { wrapper });
    await act(async () => {
      await result.current.requestPreview({
        subaccountId: 7n,
        assetId: "cash",
        protocolAsset: asset,
        tokenAddress: token,
        formSnapshot: snapshot,
      });
    });
    await act(async () => { await result.current.prepare(snapshot); });
    await act(async () => { await result.current.signAndSubmit(); });
    expect(mocks.switchChain).toHaveBeenCalledWith({ chainId: 97 });
    expect(mocks.sign).toHaveBeenCalledTimes(1); expect(mocks.submitWithdrawal).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(1); expect(result.current.phase).toBe("done");
  });

  it("fails closed before signing when the operation id cannot be persisted", async () => {
    window.localStorage.clear(); vi.clearAllTimers();
    const { asset, token, preview, prepared, snapshot } = flowFixtures();
    mocks.previewWithdrawal.mockResolvedValue(preview);
    mocks.prepareWithdrawal.mockResolvedValue(prepared);
    const { result } = renderHook(() => useWithdraw(), { wrapper });

    await act(async () => {
      await result.current.requestPreview({
        subaccountId: 7n,
        assetId: "cash",
        protocolAsset: asset,
        tokenAddress: token,
        formSnapshot: snapshot,
      });
    });
    await act(async () => { await result.current.prepare(snapshot); });

    const storageFailure = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("storage disabled", "SecurityError");
    });
    await act(async () => {
      await expect(result.current.signAndSubmit()).rejects.toThrow(/tracking is unavailable/i);
    });
    storageFailure.mockRestore();

    expect(result.current.phase).toBe("ready");
    expect(result.current.error?.code).toBe("OPERATION_STORAGE_UNAVAILABLE");
    expect(mocks.switchChain).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.submitWithdrawal).not.toHaveBeenCalled();
  });
});
