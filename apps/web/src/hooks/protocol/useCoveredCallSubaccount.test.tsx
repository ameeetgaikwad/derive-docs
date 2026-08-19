// @vitest-environment jsdom

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { encodeEventTopics } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { matchingAbi } from "@/lib/protocol/abis";
import {
  subaccountSelectionStorageKey,
  subaccountScopeKey,
  useAccountStore,
} from "@/stores/account";
import { useCoveredCallSubaccount } from "./useCoveredCallSubaccount";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const OTHER_OWNER = "0x9999999999999999999999999999999999999999" as const;
const MATCHING = "0x2222222222222222222222222222222222222222" as const;
const SUB_ACCOUNTS = "0x3333333333333333333333333333333333333333" as const;
const MANAGER = "0x4444444444444444444444444444444444444444" as const;
const CASH = "0x5555555555555555555555555555555555555555" as const;

const mocks = vi.hoisted(() => ({
  getBlockNumber: vi.fn(),
  getContractEvents: vi.fn(),
  getSubaccountDirectory: vi.fn(),
  getPublicClient: vi.fn(),
  multicall: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  writeContract: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: OWNER }),
  useConfig: () => ({}),
  useSwitchChain: () => ({ switchChainAsync: vi.fn(async () => undefined) }),
}));

vi.mock("wagmi/actions", () => ({
  getPublicClient: mocks.getPublicClient,
  readContract: vi.fn(),
  waitForTransactionReceipt: mocks.waitForTransactionReceipt,
  writeContract: mocks.writeContract,
}));

vi.mock("@/lib/protocol/rfq-engine", () => ({
  getSubaccountDirectory: mocks.getSubaccountDirectory,
}));

vi.mock("./useNetwork", () => ({
  useNetwork: () => ({
    chainId: 97,
    addresses: {
      matching: MATCHING,
      matchingDeploymentBlock: 100n,
      subAccounts: SUB_ACCOUNTS,
      standardManager: MANAGER,
      cashAsset: CASH,
    },
  }),
}));

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("useCoveredCallSubaccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    useAccountStore.setState({
      scopeKey: null,
      accounts: [],
      selectedAccountId: null,
      rememberedAccountId: null,
      selectionLocked: false,
    });
    mocks.getSubaccountDirectory.mockResolvedValue({
      chainId: 97,
      matching: MATCHING,
      indexedThroughBlock: 123n,
      indexedThroughBlockHash: `0x${"1".repeat(64)}`,
      accountIds: [7n],
    });
    mocks.getBlockNumber.mockResolvedValue(4_100n);
    mocks.getContractEvents.mockResolvedValue([]);
    mocks.multicall.mockImplementation(
      async ({ contracts }: { contracts: Array<{ functionName: string }> }) =>
        contracts.map((contract) => ({
          status: "success",
          result:
            contract.functionName === "subAccountToOwner"
              ? OWNER
              : contract.functionName === "manager"
                ? MANAGER
                : contract.functionName === "ownerOf"
                  ? MATCHING
                  : [{ asset: CASH, subId: 0n, balance: 5n * 10n ** 18n }],
        })),
    );
    mocks.getPublicClient.mockReturnValue({
      getBlockNumber: mocks.getBlockNumber,
      getContractEvents: mocks.getContractEvents,
      multicall: mocks.multicall,
    });
    mocks.writeContract.mockResolvedValue(`0x${"a".repeat(64)}`);
    mocks.waitForTransactionReceipt.mockResolvedValue({
      status: "success",
      logs: [{
        address: MATCHING,
        data: "0x",
        topics: encodeEventTopics({
          abi: matchingAbi,
          eventName: "DepositedSubAccount",
          args: { accountId: 12n, owner: OWNER },
        }),
      }],
    });
  });

  it("auto-selects the lowest validated id, then inserts and selects a receipt id", async () => {
    const { result } = renderHook(() => useCoveredCallSubaccount(), { wrapper });

    await waitFor(() => expect(result.current.accounts).toHaveLength(1));
    expect(result.current.subaccountId).toBe(7n);
    expect(result.current.accounts[0]).toEqual({
      accountId: 7n,
      cashBalance: 5n * 10n ** 18n,
      nonZeroBalanceCount: 1,
    });

    await act(async () => {
      expect(await result.current.createSubaccount()).toBe(12n);
    });
    await waitFor(() => expect(result.current.subaccountId).toBe(12n));
    expect(result.current.accounts.map((account) => account.accountId)).toContain(12n);
  });

  it("includes and restores a cached account while the directory catches up", async () => {
    const scope = subaccountScopeKey(OWNER, 97, MATCHING);
    window.localStorage.setItem(subaccountSelectionStorageKey(scope), "6");

    const { result } = renderHook(() => useCoveredCallSubaccount(), { wrapper });

    await waitFor(() => expect(result.current.accounts).toHaveLength(2));
    expect(result.current.accounts.map((account) => account.accountId)).toEqual([6n, 7n]);
    expect(result.current.subaccountId).toBe(6n);
  });

  it("rejects a cached candidate that fails current on-chain validation", async () => {
    const scope = subaccountScopeKey(OWNER, 97, MATCHING);
    window.localStorage.setItem(subaccountSelectionStorageKey(scope), "6");
    mocks.multicall.mockImplementation(
      async ({ contracts }: {
        contracts: Array<{ functionName: string; args?: readonly unknown[] }>;
      }) => contracts.map((contract) => ({
        status: "success",
        result:
          contract.functionName === "subAccountToOwner"
            ? contract.args?.[0] === 6n ? OTHER_OWNER : OWNER
            : contract.functionName === "manager"
              ? MANAGER
              : contract.functionName === "ownerOf"
                ? MATCHING
                : [{ asset: CASH, subId: 0n, balance: 5n * 10n ** 18n }],
      })),
    );

    const { result } = renderHook(() => useCoveredCallSubaccount(), { wrapper });

    await waitFor(() => expect(result.current.accounts).toHaveLength(1));
    expect(result.current.accounts[0]?.accountId).toBe(7n);
    expect(result.current.subaccountId).toBe(7n);
    expect(window.localStorage.getItem(subaccountSelectionStorageKey(scope))).toBe("7");
  });

  it("chunks the wallet-filtered RPC fallback only after a directory failure", async () => {
    mocks.getSubaccountDirectory.mockRejectedValue(new Error("directory unavailable"));
    mocks.getContractEvents.mockImplementation(async ({ fromBlock }: { fromBlock: bigint }) =>
      fromBlock === 2_100n ? [{ args: { accountId: 8n } }] : [],
    );

    const { result } = renderHook(() => useCoveredCallSubaccount(), { wrapper });

    await waitFor(() => expect(result.current.accounts[0]?.accountId).toBe(8n));
    expect(mocks.getContractEvents.mock.calls.map(([input]) => [
      input.fromBlock,
      input.toBlock,
    ])).toEqual([
      [100n, 2_099n],
      [2_100n, 4_099n],
      [4_100n, 4_100n],
    ]);
  });
});
