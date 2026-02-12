"use client";

import { useQuery } from "@tanstack/react-query";
import { useDerive } from "@/providers/DeriveProvider";
import type { Order } from "@/lib/derive/types";

export function useOpenOrders() {
  const { restClient, subaccountId, isAuthenticated } = useDerive();

  return useQuery<Order[]>({
    queryKey: ["openOrders", subaccountId],
    queryFn: () => restClient.getOpenOrders(subaccountId!),
    enabled: isAuthenticated && !!subaccountId,
    refetchInterval: 5_000,
  });
}
