"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConfig, useReadContract, useReadContracts } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import {
  cashAssetAbi,
  mockErc20Abi,
  scaledUiTokenAbi,
  subAccountsAbi,
} from "@/lib/protocol/abis";
import {
  applyInterestAdjustedCashBalance,
  getWithdrawableAssetConfigs,
  resolveWithdrawableAssets,
  type ProtocolAssetBalance,
  type WithdrawalAssetId,
} from "@/lib/protocol/withdrawal-assets";
import { getMarkets } from "@/lib/protocol/markets";
import { useNetwork } from "./useNetwork";

export function useSubaccountAssets(subaccountId: bigint | null) {
  const config = useConfig();
  const { addresses, chainId } = useNetwork();
  const configs = useMemo(
    () => getWithdrawableAssetConfigs(chainId, addresses),
    [addresses, chainId],
  );

  const balancesQuery = useReadContract({
    abi: subAccountsAbi,
    address: addresses.subAccounts,
    functionName: "getAccountBalances",
    args: subaccountId === null ? undefined : [subaccountId],
    chainId,
    query: { enabled: subaccountId !== null, refetchInterval: 15_000 },
  });
  const cashDecimalsQuery = useReadContract({
    abi: mockErc20Abi,
    address: addresses.usdt,
    functionName: "decimals",
    chainId,
    query: { staleTime: 5 * 60_000 },
  });
  const interestCashQuery = useQuery({
    queryKey: ["cashBalanceWithInterest", chainId, addresses.cashAsset, subaccountId?.toString() ?? null],
    enabled: subaccountId !== null,
    refetchInterval: 15_000,
    queryFn: async () => {
      if (subaccountId === null) throw new Error("No account selected");
      const client = getPublicClient(config, { chainId });
      if (!client) throw new Error(`No RPC client configured for chain ${chainId}`);
      const simulation = await client.simulateContract({
        abi: cashAssetAbi,
        address: addresses.cashAsset,
        functionName: "calculateBalanceWithInterest",
        args: [subaccountId],
        account: addresses.matching,
      });
      return simulation.result;
    },
  });
  const scaledConfigs = configs.filter((config) => config.scaledUi);
  const multiplierReads = useReadContracts({
    contracts: scaledConfigs.map((config) => ({
      abi: scaledUiTokenAbi,
      address: config.tokenAddress,
      functionName: "uiMultiplier" as const,
      chainId,
    })),
    query: { enabled: scaledConfigs.length > 0, refetchInterval: 30_000 },
  });

  const multipliers = useMemo(() => {
    const values = new Map<WithdrawalAssetId, bigint>();
    scaledConfigs.forEach((config, index) => {
      const result = multiplierReads.data?.[index];
      if (result?.status === "success" && typeof result.result === "bigint" && result.result > 0n) {
        values.set(config.assetId, result.result);
      }
    });
    return values;
  }, [multiplierReads.data, scaledConfigs]);

  const rawAssets = useMemo(() => {
    if (cashDecimalsQuery.data === undefined) return [];
    return resolveWithdrawableAssets({
      configs,
      balances: (balancesQuery.data ?? []) as readonly ProtocolAssetBalance[],
      cashDecimals: cashDecimalsQuery.data,
      multipliers,
    });
  }, [balancesQuery.data, cashDecimalsQuery.data, configs, multipliers]);

  const cashBalanceWithInterest18 = interestCashQuery.data ?? null;
  const assets = useMemo(
    () => cashBalanceWithInterest18 === null
      ? rawAssets
      : applyInterestAdjustedCashBalance(rawAssets, cashBalanceWithInterest18),
    [cashBalanceWithInterest18, rawAssets],
  );

  const hasOptionPositions = useMemo(() => {
    const optionAssets = new Set(
      getMarkets(chainId)
        .flatMap((market) => market.contracts ? [market.contracts.optionAsset.toLowerCase()] : []),
    );
    return ((balancesQuery.data ?? []) as readonly ProtocolAssetBalance[]).some(
      (balance) => balance.balance !== 0n && optionAssets.has(balance.asset.toLowerCase()),
    );
  }, [balancesQuery.data, chainId]);

  const rawCash = rawAssets.find((asset) => asset.assetId === "cash") ?? null;
  const scaledUnavailable = assets.some((asset) => asset.scaledUi && !asset.conversionReady);
  return {
    assets,
    rawCashBalance18: rawCash?.balance18 ?? 0n,
    cashBalanceWithInterest18,
    cashDebt18: cashBalanceWithInterest18 !== null && cashBalanceWithInterest18 < 0n
      ? -cashBalanceWithInterest18
      : 0n,
    hasOptionPositions,
    isLoading:
      subaccountId !== null &&
      (balancesQuery.isLoading || cashDecimalsQuery.isLoading || multiplierReads.isLoading || interestCashQuery.isLoading),
    error: balancesQuery.error ?? cashDecimalsQuery.error ?? multiplierReads.error ?? interestCashQuery.error ??
      (scaledUnavailable ? new Error("A live collateral conversion rate is unavailable") : null),
    refetch: async () => {
      await Promise.all([
        balancesQuery.refetch(),
        cashDecimalsQuery.refetch(),
        multiplierReads.refetch(),
        interestCashQuery.refetch(),
      ]);
    },
  };
}
