"use client";

import { useQuery } from "@tanstack/react-query";
import { useDerive } from "@/providers/DeriveProvider";
import type { OrderDirection } from "@/lib/derive/types";

export function useMarginEstimate(
  instrumentName: string | null,
  direction: OrderDirection,
  amount: string,
  limitPrice: string
) {
  const { restClient, subaccountId, isAuthenticated } = useDerive();

  return useQuery({
    queryKey: ["marginEstimate", subaccountId, instrumentName, direction, amount, limitPrice],
    queryFn: () =>
      restClient.estimateOrderMargin({
        subaccount_id: subaccountId!,
        instrument_name: instrumentName!,
        direction,
        amount,
        limit_price: limitPrice,
      }),
    enabled:
      isAuthenticated &&
      !!subaccountId &&
      !!instrumentName &&
      !!amount &&
      parseFloat(amount) > 0 &&
      !!limitPrice &&
      parseFloat(limitPrice) > 0,
    staleTime: 5_000,
  });
}
