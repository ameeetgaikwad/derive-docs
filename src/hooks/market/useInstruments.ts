"use client";

import { useQuery } from "@tanstack/react-query";
import { getSharedRestClient } from "@/hooks/account/useDeriveAuth";
import type { Instrument, Currency, InstrumentType } from "@/lib/derive/types";

export function useInstruments(
  currency: Currency = "ETH",
  instrumentType: InstrumentType = "option"
) {
  return useQuery<Instrument[]>({
    queryKey: ["instruments", currency, instrumentType],
    queryFn: () => getSharedRestClient().getInstruments(currency, instrumentType),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
