"use client";

import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  decodeEventLog,
  isAddress,
  type Address,
  type ContractFunctionParameters,
} from "viem";
import { useAccount, useConfig, useSwitchChain } from "wagmi";
import {
  getPublicClient,
  readContract,
  waitForTransactionReceipt,
  writeContract,
} from "wagmi/actions";
import { matchingAbi, subAccountsAbi, mockErc20Abi, wrappedErc20AssetAbi } from "@/lib/protocol/abis";
import { getSubaccountDirectory } from "@/lib/protocol/rfq-engine";
import {
  discoverSubaccounts,
  summarizeValidatedSubaccounts,
  type SubaccountBalanceSnapshot,
  type SubaccountValidationSnapshot,
} from "@/lib/protocol/subaccounts";
import {
  readRememberedSubaccountId,
  subaccountScopeKey,
  useAccountStore,
} from "@/stores/account";
import { useNetwork } from "./useNetwork";

// SHORTCUT: serial 2,000-block fallback chunks favor public RPC compatibility;
// replace the browser scan with a redundant directory service if recovery latency becomes material.
const RPC_FALLBACK_BLOCK_CHUNK = 2_000n;

/**
 * The user's covered-call subaccount under Matching (SRM-managed).
 *
 * The directory supplies candidate ids. Every candidate is validated against
 * current protocol state before it can become the active selection.
 */
export function useCoveredCallSubaccount() {
  const { address } = useAccount();
  const config = useConfig();
  const { switchChainAsync } = useSwitchChain();
  const queryClient = useQueryClient();
  const { addresses, chainId } = useNetwork();
  const accounts = useAccountStore((state) => state.accounts);
  const selectedAccountId = useAccountStore((state) => state.selectedAccountId);
  const setScope = useAccountStore((state) => state.setScope);
  const replaceAccounts = useAccountStore((state) => state.replaceAccounts);
  const selectAccount = useAccountStore((state) => state.selectAccount);
  const upsertAccount = useAccountStore((state) => state.upsertAccount);
  const scopeKey = address
    ? subaccountScopeKey(address, chainId, addresses.matching)
    : null;

  useEffect(() => {
    setScope(scopeKey);
  }, [scopeKey, setScope]);

  const ensureChain = useCallback(async () => {
    await switchChainAsync({ chainId }).catch(() => {
      // ignore "already on chain" / user-handled cases; writes will re-check
    });
  }, [switchChainAsync, chainId]);

  const validateCandidates = useCallback(
    async (accountIds: bigint[]) => {
      if (!address || accountIds.length === 0) return [];

      const contracts = accountIds.flatMap((accountId) => [
        {
          abi: matchingAbi,
          address: addresses.matching,
          functionName: "subAccountToOwner",
          args: [accountId],
        },
        {
          abi: subAccountsAbi,
          address: addresses.subAccounts,
          functionName: "manager",
          args: [accountId],
        },
        {
          abi: subAccountsAbi,
          address: addresses.subAccounts,
          functionName: "ownerOf",
          args: [accountId],
        },
        {
          abi: subAccountsAbi,
          address: addresses.subAccounts,
          functionName: "getAccountBalances",
          args: [accountId],
        },
      ]) satisfies ContractFunctionParameters[];
      const publicClient = getPublicClient(config, { chainId });
      if (!publicClient) {
        throw new Error(`No RPC client configured for chain ${chainId}`);
      }
      const results = await publicClient.multicall({
        contracts,
        allowFailure: true,
      });

      const snapshots = accountIds.map<SubaccountValidationSnapshot | null>(
        (accountId, accountIndex) => {
          const offset = accountIndex * 4;
          const ownerResult = results[offset];
          const managerResult = results[offset + 1];
          const holderResult = results[offset + 2];
          const balancesResult = results[offset + 3];
          if (
            ownerResult?.status !== "success" ||
            managerResult?.status !== "success" ||
            holderResult?.status !== "success" ||
            balancesResult?.status !== "success" ||
            typeof ownerResult.result !== "string" ||
            !isAddress(ownerResult.result) ||
            typeof managerResult.result !== "string" ||
            !isAddress(managerResult.result) ||
            typeof holderResult.result !== "string" ||
            !isAddress(holderResult.result) ||
            !Array.isArray(balancesResult.result)
          ) {
            return null;
          }

          const balances: SubaccountBalanceSnapshot[] = [];
          for (const value of balancesResult.result) {
            if (
              typeof value !== "object" ||
              value === null ||
              !("asset" in value) ||
              !("subId" in value) ||
              !("balance" in value) ||
              !isAddress(String(value.asset)) ||
              typeof value.subId !== "bigint" ||
              typeof value.balance !== "bigint"
            ) {
              return null;
            }
            balances.push({
              asset: value.asset as Address,
              subId: value.subId,
              balance: value.balance,
            });
          }

          return {
            accountId,
            logicalOwner: ownerResult.result as Address,
            manager: managerResult.result as Address,
            holder: holderResult.result as Address,
            balances,
          };
        },
      );

      return summarizeValidatedSubaccounts(
        {
          owner: address,
          matching: addresses.matching,
          standardManager: addresses.standardManager,
          cashAsset: addresses.cashAsset,
        },
        snapshots,
      );
    },
    [address, addresses, chainId, config],
  );

  const scanDeposits = useCallback(async (): Promise<bigint[]> => {
    if (!address) throw new Error("Wallet not connected");
    const publicClient = getPublicClient(config, { chainId });
    if (!publicClient) throw new Error(`No RPC client configured for chain ${chainId}`);
    const latestBlock = await publicClient.getBlockNumber();
    const accountIds: bigint[] = [];
    for (
      let fromBlock = addresses.matchingDeploymentBlock;
      fromBlock <= latestBlock;
      fromBlock += RPC_FALLBACK_BLOCK_CHUNK
    ) {
      const toBlock = fromBlock + RPC_FALLBACK_BLOCK_CHUNK - 1n < latestBlock
        ? fromBlock + RPC_FALLBACK_BLOCK_CHUNK - 1n
        : latestBlock;
      const logs = await publicClient.getContractEvents({
        abi: matchingAbi,
        address: addresses.matching,
        eventName: "DepositedSubAccount",
        args: { owner: address },
        fromBlock,
        toBlock,
      });
      for (const log of logs) {
        if (typeof log.args.accountId === "bigint") accountIds.push(log.args.accountId);
      }
    }
    return accountIds;
  }, [address, addresses.matching, addresses.matchingDeploymentBlock, chainId, config]);

  const directoryQuery = useQuery({
    queryKey: ["subaccounts", scopeKey],
    enabled: scopeKey !== null,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!address || !scopeKey) throw new Error("Wallet not connected");
      const includeRememberedAccount = (accountIds: bigint[]) => {
        const state = useAccountStore.getState();
        const remembered = state.scopeKey === scopeKey
          ? state.selectedAccountId ?? state.rememberedAccountId
          : readRememberedSubaccountId(scopeKey);
        return remembered === null || accountIds.includes(remembered)
          ? accountIds
          : [...accountIds, remembered];
      };
      return discoverSubaccounts(
        { owner: address, chainId, matching: addresses.matching },
        {
          loadDirectory: async () => {
            const directory = await getSubaccountDirectory(address, chainId);
            return {
              ...directory,
              accountIds: includeRememberedAccount(directory.accountIds),
            };
          },
          scanDeposits: async () => {
            const ids = await scanDeposits();
            return includeRememberedAccount(ids);
          },
          validateCandidates,
        },
      );
    },
  });

  useEffect(() => {
    if (scopeKey && directoryQuery.data) {
      replaceAccounts(scopeKey, directoryQuery.data.accounts);
    }
  }, [directoryQuery.data, replaceAccounts, scopeKey]);

  const selectSubaccount = useCallback(
    (accountId: bigint | null) => {
      if (scopeKey) selectAccount(scopeKey, accountId);
    },
    [scopeKey, selectAccount],
  );

  /** Creates, validates, inserts, and explicitly selects one new subaccount. */
  const createSubaccount = useCallback(async (): Promise<bigint> => {
    if (!address || !scopeKey) throw new Error("Wallet not connected");

    await ensureChain();
    const hash = await writeContract(config, {
      abi: matchingAbi,
      address: addresses.matching,
      functionName: "createSubAccount",
      args: [addresses.standardManager],
      chainId,
    });
    const receipt = await waitForTransactionReceipt(config, {
      hash,
      chainId,
    });
    if (receipt.status !== "success") {
      throw new Error(`Subaccount creation reverted (tx ${hash})`);
    }

    let accountId: bigint | null = null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== addresses.matching.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: matchingAbi,
          data: log.data,
          topics: log.topics,
        });
        if (
          decoded.eventName === "DepositedSubAccount" &&
          decoded.args.owner.toLowerCase() === address.toLowerCase()
        ) {
          accountId = decoded.args.accountId;
          break;
        }
      } catch {
        // Not the Matching event emitted by createSubAccount.
      }
    }
    if (accountId === null) {
      throw new Error("Subaccount created but id not found in receipt logs");
    }

    const [summary] = await validateCandidates([accountId]);
    if (!summary || summary.accountId !== accountId) {
      throw new Error(`Created subaccount ${accountId} failed live protocol validation`);
    }
    upsertAccount(scopeKey, summary, true);
    void queryClient.invalidateQueries({ queryKey: ["subaccounts", scopeKey] });
    return accountId;
  }, [
    address,
    addresses.matching,
    addresses.standardManager,
    chainId,
    config,
    ensureChain,
    queryClient,
    scopeKey,
    upsertAccount,
    validateCandidates,
  ]);

  return {
    accounts: scopeKey ? accounts : [],
    subaccountId: scopeKey ? selectedAccountId : null,
    isLoading: directoryQuery.isLoading,
    isFetching: directoryQuery.isFetching,
    error: directoryQuery.error,
    source: directoryQuery.data?.source ?? null,
    selectSubaccount,
    createSubaccount,
    refetch: directoryQuery.refetch,
  };
}

/**
 * Deposit BTCB collateral into a subaccount:
 * BTCB.approve(btcBaseAsset) (skipped if allowance suffices) then
 * WrappedERC20Asset.deposit(subaccountId, amount) — one regular tx each.
 * Deposits into Matching-held subaccounts are permissionless by design.
 */
export function useDepositBtcb() {
  const { address } = useAccount();
  const config = useConfig();
  const { switchChainAsync } = useSwitchChain();
  const { addresses, chainId } = useNetwork();

  return useCallback(
    async (subaccountId: bigint, amount: bigint): Promise<void> => {
      if (!address) throw new Error("Wallet not connected");
      await switchChainAsync({ chainId }).catch(() => {});

      const allowance = await readContract(config, {
        abi: mockErc20Abi,
        address: addresses.btcb,
        functionName: "allowance",
        args: [address, addresses.btcBaseAsset],
        chainId,
      });

      if (allowance < amount) {
        const approveHash = await writeContract(config, {
          abi: mockErc20Abi,
          address: addresses.btcb,
          functionName: "approve",
          args: [addresses.btcBaseAsset, amount],
          chainId,
        });
        await waitForTransactionReceipt(config, {
          hash: approveHash,
          chainId,
        });
      }

      const depositHash = await writeContract(config, {
        abi: wrappedErc20AssetAbi,
        address: addresses.btcBaseAsset,
        functionName: "deposit",
        args: [subaccountId, amount],
        chainId,
      });
      const receipt = await waitForTransactionReceipt(config, {
        hash: depositHash,
        chainId,
      });
      if (receipt.status !== "success") {
        throw new Error(`BTCB deposit reverted (tx ${depositHash})`);
      }
    },
    [address, config, switchChainAsync, addresses, chainId]
  );
}
