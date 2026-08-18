import { describe, expect, it, vi } from "vitest";
import {
  discoverSubaccounts,
  summarizeValidatedSubaccounts,
} from "../subaccounts";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const MATCHING = "0x2222222222222222222222222222222222222222" as const;
const SUB_ACCOUNTS = "0x3333333333333333333333333333333333333333" as const;
const MANAGER = "0x4444444444444444444444444444444444444444" as const;
const CASH = "0x5555555555555555555555555555555555555555" as const;

describe("subaccount discovery", () => {
  it("uses the directory as candidate discovery and live-validates unique ids", async () => {
    const scanDeposits = vi.fn();
    const validateCandidates = vi.fn(async (accountIds: bigint[]) =>
      accountIds.map((accountId) => ({
        accountId,
        cashBalance: accountId * 10n,
        nonZeroBalanceCount: 1,
      })),
    );

    const result = await discoverSubaccounts(
      { owner: OWNER, chainId: 97, matching: MATCHING },
      {
        loadDirectory: async () => ({
          chainId: 97,
          matching: MATCHING,
          indexedThroughBlock: 100n,
          indexedThroughBlockHash: `0x${"1".repeat(64)}`,
          accountIds: [7n, 7n, 9n],
        }),
        scanDeposits,
        validateCandidates,
      },
    );

    expect(scanDeposits).not.toHaveBeenCalled();
    expect(validateCandidates).toHaveBeenCalledWith([7n, 9n]);
    expect(result).toEqual({
      source: "directory",
      indexedThroughBlock: 100n,
      accounts: [
        { accountId: 7n, cashBalance: 70n, nonZeroBalanceCount: 1 },
        { accountId: 9n, cashBalance: 90n, nonZeroBalanceCount: 1 },
      ],
    });
  });

  it("falls back to wallet-filtered logs when the directory fails or is for another Matching", async () => {
    const scanDeposits = vi.fn(async () => [12n, 12n]);
    const validateCandidates = vi.fn(async (accountIds: bigint[]) => [
      { accountId: accountIds[0], cashBalance: 0n, nonZeroBalanceCount: 0 },
    ]);

    const result = await discoverSubaccounts(
      { owner: OWNER, chainId: 97, matching: MATCHING },
      {
        loadDirectory: async () => ({
          chainId: 97,
          matching: "0x3333333333333333333333333333333333333333",
          indexedThroughBlock: 100n,
          indexedThroughBlockHash: `0x${"2".repeat(64)}`,
          accountIds: [5n],
        }),
        scanDeposits,
        validateCandidates,
      },
    );

    expect(scanDeposits).toHaveBeenCalledOnce();
    expect(validateCandidates).toHaveBeenCalledWith([12n]);
    expect(result.source).toBe("rpc");
    expect(result.indexedThroughBlock).toBeNull();
  });

  it("surfaces discovery failure instead of turning it into an empty list", async () => {
    await expect(
      discoverSubaccounts(
        { owner: OWNER, chainId: 97, matching: MATCHING },
        {
          loadDirectory: async () => {
            throw new Error("directory unavailable");
          },
          scanDeposits: async () => {
            throw new Error("RPC unavailable");
          },
          validateCandidates: vi.fn(),
        },
      ),
    ).rejects.toThrow("directory unavailable; RPC fallback failed: RPC unavailable");
  });

  it("keeps only ids whose owner, manager, and holder match live protocol state", () => {
    const result = summarizeValidatedSubaccounts(
      {
        owner: OWNER,
        matching: MATCHING,
        standardManager: MANAGER,
        cashAsset: CASH,
      },
      [
        {
          accountId: 7n,
          logicalOwner: OWNER,
          manager: MANAGER,
          holder: MATCHING,
          balances: [
            { asset: CASH, subId: 0n, balance: 125n },
            { asset: SUB_ACCOUNTS, subId: 1n, balance: -2n },
            { asset: SUB_ACCOUNTS, subId: 2n, balance: 0n },
          ],
        },
        {
          accountId: 8n,
          logicalOwner: OWNER,
          manager: SUB_ACCOUNTS,
          holder: MATCHING,
          balances: [],
        },
        null,
      ],
    );

    expect(result).toEqual([
      { accountId: 7n, cashBalance: 125n, nonZeroBalanceCount: 2 },
    ]);
  });
});
