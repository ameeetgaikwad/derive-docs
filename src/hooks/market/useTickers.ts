"use client";

import { useQueries } from "@tanstack/react-query";
import { getSharedRestClient } from "@/hooks/account/useDeriveAuth";
import type { Ticker } from "@/lib/derive/types";

export function useTickers(instrumentNames: string[]) {
  return useQueries({
    queries: instrumentNames.map((name) => ({
      queryKey: ["ticker", name],
      queryFn: () => getSharedRestClient().getTicker(name),
      staleTime: 5_000,
      refetchInterval: 10_000,
    })),
  });
}
