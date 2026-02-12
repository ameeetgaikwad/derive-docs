"use client";

import { useQuery } from "@tanstack/react-query";
import { getSharedRestClient } from "@/hooks/account/useDeriveAuth";
import type { Ticker } from "@/lib/derive/types";

export function useTicker(instrumentName: string | null) {
  return useQuery<Ticker>({
    queryKey: ["ticker", instrumentName],
    queryFn: () => getSharedRestClient().getTicker(instrumentName!),
    enabled: !!instrumentName,
    staleTime: 5_000,
    refetchInterval: 10_000,
  });
}
