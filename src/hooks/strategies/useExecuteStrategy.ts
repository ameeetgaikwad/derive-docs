"use client";

import { useSubmitOrder } from "@/hooks/mutations/useSubmitOrder";
import type { StrategyPreview } from "@/lib/strategies/types";

export function useExecuteStrategy() {
  const submitOrder = useSubmitOrder();

  const execute = (preview: StrategyPreview, amount: string) => {
    const price =
      preview.strategy.direction === "buy"
        ? preview.ticker?.best_ask_price
        : preview.ticker?.best_bid_price;

    if (!price) {
      throw new Error("No price available");
    }

    submitOrder.mutate({
      instrumentName: preview.instrument.instrument_name,
      direction: preview.strategy.direction,
      amount,
      limitPrice: price,
      baseAssetAddress: preview.instrument.base_asset_address,
      baseAssetSubId: preview.instrument.base_asset_sub_id,
    });
  };

  return {
    execute,
    isPending: submitOrder.isPending,
    isSuccess: submitOrder.isSuccess,
    isError: submitOrder.isError,
    error: submitOrder.error,
  };
}
