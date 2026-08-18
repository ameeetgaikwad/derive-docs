import type { Address } from "viem";
import type { SubaccountSummary } from "@/stores/account";
import type { AppChainId } from "@/stores/network";
import type { SubaccountDirectoryResult } from "./rfq-engine";

export interface SubaccountDiscoveryScope {
  owner: Address;
  chainId: AppChainId;
  matching: Address;
}

export interface SubaccountDiscoveryResult {
  source: "directory" | "rpc";
  indexedThroughBlock: bigint | null;
  accounts: SubaccountSummary[];
}

export interface SubaccountBalanceSnapshot {
  asset: Address;
  subId: bigint;
  balance: bigint;
}

export interface SubaccountValidationSnapshot {
  accountId: bigint;
  logicalOwner: Address;
  manager: Address;
  holder: Address;
  balances: readonly SubaccountBalanceSnapshot[];
}

interface SubaccountValidationScope {
  owner: Address;
  matching: Address;
  standardManager: Address;
  cashAsset: Address;
}

interface SubaccountDiscoveryDependencies {
  loadDirectory: () => Promise<SubaccountDirectoryResult>;
  scanDeposits: () => Promise<bigint[]>;
  validateCandidates: (accountIds: bigint[]) => Promise<SubaccountSummary[]>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function uniqueAccountIds(accountIds: bigint[]): bigint[] {
  return [...new Set(accountIds)];
}

function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/** Convert successful multicall snapshots into selector-safe summaries. */
export function summarizeValidatedSubaccounts(
  scope: SubaccountValidationScope,
  snapshots: readonly (SubaccountValidationSnapshot | null)[],
): SubaccountSummary[] {
  return snapshots.flatMap((snapshot) => {
    if (
      snapshot === null ||
      !sameAddress(snapshot.logicalOwner, scope.owner) ||
      !sameAddress(snapshot.manager, scope.standardManager) ||
      !sameAddress(snapshot.holder, scope.matching)
    ) {
      return [];
    }

    const cashBalance =
      snapshot.balances.find((balance) =>
        sameAddress(balance.asset, scope.cashAsset),
      )?.balance ?? 0n;
    return [{
      accountId: snapshot.accountId,
      cashBalance,
      nonZeroBalanceCount: snapshot.balances.filter(
        (balance) => balance.balance !== 0n,
      ).length,
    }];
  });
}

/**
 * Discover candidate ids from the directory, falling back to wallet-filtered
 * logs only when the directory cannot supply data for the active deployment.
 * Candidate ids are always live-validated by the caller before being exposed.
 */
export async function discoverSubaccounts(
  scope: SubaccountDiscoveryScope,
  dependencies: SubaccountDiscoveryDependencies,
): Promise<SubaccountDiscoveryResult> {
  let accountIds: bigint[];
  let source: SubaccountDiscoveryResult["source"] = "directory";
  let indexedThroughBlock: bigint | null = null;

  try {
    const directory = await dependencies.loadDirectory();
    if (
      directory.chainId !== scope.chainId ||
      directory.matching.toLowerCase() !== scope.matching.toLowerCase()
    ) {
      throw new Error("directory metadata does not match the active deployment");
    }
    accountIds = directory.accountIds;
    indexedThroughBlock = directory.indexedThroughBlock;
  } catch (directoryError) {
    source = "rpc";
    try {
      accountIds = await dependencies.scanDeposits();
    } catch (rpcError) {
      throw new Error(
        `${errorMessage(directoryError)}; RPC fallback failed: ${errorMessage(rpcError)}`,
      );
    }
  }

  const accounts = await dependencies.validateCandidates(
    uniqueAccountIds(accountIds),
  );
  return { source, indexedThroughBlock, accounts };
}
