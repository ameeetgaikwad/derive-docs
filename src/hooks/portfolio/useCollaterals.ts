"use client";

import { useQuery } from "@tanstack/react-query";
import { useDerive } from "@/providers/DeriveProvider";
import type { Collateral } from "@/lib/derive/types";

export function useCollaterals() {
  const { restClient, subaccountId, isAuthenticated } = useDerive();

  return useQuery<Collateral[]>({
    queryKey: ["collaterals", subaccountId],
    queryFn: () => restClient.getCollaterals(subaccountId!),
    enabled: isAuthenticated && !!subaccountId,
    refetchInterval: 15_000,
  });
}
