"use client";

import { useQuery } from "@tanstack/react-query";
import { useDerive } from "@/providers/DeriveProvider";
import type { TradeHistoryEntry } from "@/lib/derive/types";

export function useTradeHistory() {
  const { restClient, subaccountId, isAuthenticated } = useDerive();

  return useQuery<TradeHistoryEntry[]>({
    queryKey: ["tradeHistory", subaccountId],
    queryFn: () => restClient.getTradeHistory(subaccountId!, { page_size: 50 }),
    enabled: isAuthenticated && !!subaccountId,
    refetchInterval: 30_000,
    retry: false,
  });
}
