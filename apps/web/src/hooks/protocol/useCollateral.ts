"use client";

import { useCallback } from "react";
import { zeroAddress } from "viem";
import { useAccount, useConfig, useReadContract, useSwitchChain } from "wagmi";
import { readContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { mockErc20Abi, wrappedErc20AssetAbi } from "@/lib/protocol/abis";
import {
  amount18ToToken,
  getMarket,
  rawAmount18ToUi18,
  tokenAmountTo18,
  uiAmount18ToRaw18,
  type MarketId,
} from "@/lib/protocol/markets";
import { toUnit, unitToNumber } from "@/lib/protocol/units";
import { useNetwork } from "./useNetwork";

export function useCollateralBalance(marketId: MarketId, multiplier: bigint | null) {
  const { address } = useAccount();
  const { chainId } = useNetwork();
  const market = getMarket(chainId, marketId);
  const query = useReadContract({
    abi: mockErc20Abi,
    address: market.collateral.address ?? zeroAddress,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId,
    query: { enabled: market.enabled && !!market.collateral.address && !!address, refetchInterval: 15_000 },
  });
  const raw18 = tokenAmountTo18(query.data ?? 0n, market.collateral.decimals);
  const ui18 = rawAmount18ToUi18(raw18, multiplier);
  return {
    balance: query.data ?? 0n,
    balanceNumber: unitToNumber(ui18),
    rawBalance18: raw18,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}

export function useDepositCollateral(marketId: MarketId, multiplier: bigint | null) {
  const { address } = useAccount();
  const config = useConfig();
  const { switchChainAsync } = useSwitchChain();
  const { chainId } = useNetwork();
  const market = getMarket(chainId, marketId);

  return useCallback(async (subaccountId: bigint, uiAmount: string): Promise<void> => {
    if (!address) throw new Error("Wallet not connected");
    if (!market.enabled || !market.contracts || !market.collateral.address) {
      throw new Error(`${market.displayName} market is not enabled`);
    }
    await switchChainAsync({ chainId }).catch(() => {});
    const raw18 = uiAmount18ToRaw18(toUnit(uiAmount), multiplier);
    const tokenAmount = amount18ToToken(raw18, market.collateral.decimals);
    const allowance = await readContract(config, {
      abi: mockErc20Abi,
      address: market.collateral.address,
      functionName: "allowance",
      args: [address, market.contracts.baseAsset],
      chainId,
    });
    if (allowance < tokenAmount) {
      const approveHash = await writeContract(config, {
        abi: mockErc20Abi,
        address: market.collateral.address,
        functionName: "approve",
        args: [market.contracts.baseAsset, tokenAmount],
        chainId,
      });
      await waitForTransactionReceipt(config, { hash: approveHash, chainId });
    }
    const depositHash = await writeContract(config, {
      abi: wrappedErc20AssetAbi,
      address: market.contracts.baseAsset,
      functionName: "deposit",
      args: [subaccountId, tokenAmount],
      chainId,
    });
    const receipt = await waitForTransactionReceipt(config, { hash: depositHash, chainId });
    if (receipt.status !== "success") throw new Error(`${market.collateral.symbol} deposit reverted`);
  }, [address, chainId, config, market, multiplier, switchChainAsync]);
}
