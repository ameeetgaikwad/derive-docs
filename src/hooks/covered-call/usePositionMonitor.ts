"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useDerive } from "@/providers/DeriveProvider";
import { useMemo } from "react";
import type { Position, Collateral } from "@/lib/derive/types";

type PositionStatus = "loading" | "active" | "settled" | "empty";

interface UsePositionMonitorResult {
  positions: UseQueryResult<Position[]>;
  collaterals: UseQueryResult<Collateral[]>;
  status: PositionStatus;
  btcCollateral: Collateral | undefined;
  usdcCollateral: Collateral | undefined;
  hasActiveOption: boolean;
}

export function usePositionMonitor(subaccountId: number | null): UsePositionMonitorResult {
  const { restClient } = useDerive();

  const positions = useQuery({
    queryKey: ["cc-positions", subaccountId],
    queryFn: () => restClient.getPositions(subaccountId!),
    enabled: !!subaccountId,
    refetchInterval: 10_000,
  });

  const collaterals = useQuery({
    queryKey: ["cc-collaterals", subaccountId],
    queryFn: () => restClient.getCollaterals(subaccountId!),
    enabled: !!subaccountId,
    refetchInterval: 15_000,
  });

  const hasActiveOption = useMemo(() => {
    if (!positions.data) return false;
    return positions.data.some(p => p.instrument_name.includes("-C"));
  }, [positions.data]);

  const btcCollateral = useMemo(() => {
    return collaterals.data?.find(c => c.asset_name === "WBTC");
  }, [collaterals.data]);

  const usdcCollateral = useMemo(() => {
    return collaterals.data?.find(c => c.asset_name === "USDC");
  }, [collaterals.data]);

  const status = useMemo((): PositionStatus => {
    if (!positions.data || !collaterals.data) return "loading";
    if (!btcCollateral || parseFloat(btcCollateral.amount) === 0) return "empty";
    if (!hasActiveOption) return "settled";
    return "active";
  }, [positions.data, collaterals.data, hasActiveOption, btcCollateral]);

  return { positions, collaterals, status, btcCollateral, usdcCollateral, hasActiveOption };
}
