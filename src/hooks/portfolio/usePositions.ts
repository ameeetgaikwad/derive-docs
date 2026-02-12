"use client";

import { useQuery } from "@tanstack/react-query";
import { useDerive } from "@/providers/DeriveProvider";
import type { Position } from "@/lib/derive/types";

export function usePositions() {
  const { restClient, subaccountId, isAuthenticated } = useDerive();

  return useQuery<Position[]>({
    queryKey: ["positions", subaccountId],
    queryFn: () => restClient.getPositions(subaccountId!),
    enabled: isAuthenticated && !!subaccountId,
    refetchInterval: 10_000,
  });
}
