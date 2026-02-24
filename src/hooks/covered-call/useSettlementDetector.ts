"use client";

import { useQuery } from "@tanstack/react-query";
import { useDerive } from "@/providers/DeriveProvider";
import { useMemo } from "react";

interface SettlementInfo {
  isNearExpiry: boolean;
  isSettled: boolean;
  outcome: "otm" | "itm" | null;
  settlementPrice: number | null;
  usdcDeficit: number | null;
  btcAmount: number | null;
}

export function useSettlementDetector(params: {
  subaccountId: number | null;
  instrumentName: string | null;
  expiry: number | null;
  strike: number | null;
}): SettlementInfo {
  const { restClient } = useDerive();
  const { subaccountId, instrumentName, expiry } = params;

  // Consider "near expiry" if within 2 hours
  const isNearExpiry = useMemo(() => {
    if (!expiry) return false;
    return Date.now() > (expiry * 1000 - 2 * 60 * 60 * 1000);
  }, [expiry]);

  // Poll positions more frequently near expiry
  const positions = useQuery({
    queryKey: ["cc-settlement-positions", subaccountId],
    queryFn: () => restClient.getPositions(subaccountId!),
    enabled: !!subaccountId && isNearExpiry,
    refetchInterval: isNearExpiry ? 10_000 : 60_000,
  });

  // Poll collaterals to check USDC balance after settlement
  const collaterals = useQuery({
    queryKey: ["cc-settlement-collaterals", subaccountId],
    queryFn: () => restClient.getCollaterals(subaccountId!),
    enabled: !!subaccountId && isNearExpiry,
    refetchInterval: isNearExpiry ? 10_000 : 60_000,
  });

  // Detect settlement: option disappears from positions
  const isSettled = useMemo(() => {
    if (!positions.data || !instrumentName) return false;
    return !positions.data.some(p => p.instrument_name === instrumentName);
  }, [positions.data, instrumentName]);

  // Determine outcome from collaterals
  const outcome = useMemo((): "otm" | "itm" | null => {
    if (!isSettled || !collaterals.data) return null;
    const usdc = collaterals.data.find(c => c.asset_name === "USDC");
    const usdcAmount = usdc ? parseFloat(usdc.amount) : 0;
    // Negative USDC = ITM (settlement debited USDC)
    return usdcAmount < 0 ? "itm" : "otm";
  }, [isSettled, collaterals.data]);

  const usdcDeficit = useMemo(() => {
    if (!isSettled || !collaterals.data) return null;
    const usdc = collaterals.data.find(c => c.asset_name === "USDC");
    const amount = usdc ? parseFloat(usdc.amount) : 0;
    return amount < 0 ? Math.abs(amount) : null;
  }, [isSettled, collaterals.data]);

  const btcAmount = useMemo(() => {
    if (!collaterals.data) return null;
    const btc = collaterals.data.find(c => c.asset_name === "WBTC");
    return btc ? parseFloat(btc.amount) : null;
  }, [collaterals.data]);

  // Settlement price - will be populated by settlement service
  const settlementPrice = useMemo(() => {
    if (!isSettled) return null;
    return null;
  }, [isSettled]);

  return {
    isNearExpiry,
    isSettled,
    outcome,
    settlementPrice,
    usdcDeficit,
    btcAmount,
  };
}
