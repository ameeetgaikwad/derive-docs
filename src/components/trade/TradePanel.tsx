"use client";

import { useTradeStore } from "@/stores/trade";
import { useMarketsStore } from "@/stores/markets";
import { useDerive } from "@/providers/DeriveProvider";
import { useSubmitOrder } from "@/hooks/mutations/useSubmitOrder";
import { useLiveTicker } from "@/hooks/market/useLiveTicker";
import { useInstruments } from "@/hooks/market/useInstruments";
import { formatInstrumentName, formatUsd } from "@/lib/derive/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useMemo } from "react";

export function TradePanel() {
  const { selectedInstrument } = useMarketsStore();
  const { isAuthenticated } = useDerive();
  const {
    direction,
    setDirection,
    amount,
    setAmount,
    limitPrice,
    setLimitPrice,
    status,
  } = useTradeStore();
  const submitOrder = useSubmitOrder();
  const { ticker } = useLiveTicker(selectedInstrument);
  const { data: instruments } = useInstruments("ETH", "option");

  const instrument = useMemo(
    () => instruments?.find((i) => i.instrument_name === selectedInstrument),
    [instruments, selectedInstrument]
  );

  const handleSubmit = () => {
    if (!selectedInstrument || !instrument) return;

    submitOrder.mutate({
      instrumentName: selectedInstrument,
      direction,
      amount,
      limitPrice,
      baseAssetAddress: instrument.base_asset_address,
      baseAssetSubId: instrument.base_asset_sub_id,
    });
  };

  const isBuy = direction === "buy";
  const isSubmitting = status === "signing" || status === "submitting";
  const canSubmit =
    isAuthenticated &&
    selectedInstrument &&
    parseFloat(amount) > 0 &&
    parseFloat(limitPrice) > 0 &&
    !isSubmitting;

  return (
    <Card className="space-y-4">
      <h3 className="text-sm font-semibold text-muted-foreground">
        Trade
      </h3>

      {/* Instrument Info */}
      {selectedInstrument ? (
        <div className="rounded-md bg-secondary p-3">
          <p className="text-sm font-medium">
            {formatInstrumentName(selectedInstrument)}
          </p>
          {ticker && (
            <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
              <span>Mark: {formatUsd(ticker.mark_price)}</span>
              {ticker.option_pricing?.delta && (
                <span>Delta: {parseFloat(ticker.option_pricing.delta).toFixed(3)}</span>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-md bg-secondary p-3 text-sm text-muted-foreground">
          Select an instrument from the option chain
        </div>
      )}

      {/* Direction Toggle */}
      <div className="flex gap-1 rounded-md bg-secondary p-1">
        <button
          onClick={() => setDirection("buy")}
          className={cn(
            "flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors",
            isBuy
              ? "bg-success text-white"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Buy
        </button>
        <button
          onClick={() => setDirection("sell")}
          className={cn(
            "flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors",
            !isBuy
              ? "bg-destructive text-white"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Sell
        </button>
      </div>

      {/* Amount */}
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          Amount (contracts)
        </label>
        <Input
          type="number"
          placeholder="0.0"
          min="0"
          step={instrument?.amount_step ?? "0.1"}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>

      {/* Limit Price */}
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          Limit Price (USD)
        </label>
        <Input
          type="number"
          placeholder="0.00"
          min="0"
          step={instrument?.tick_size ?? "0.01"}
          value={limitPrice}
          onChange={(e) => setLimitPrice(e.target.value)}
        />
        {ticker && (
          <div className="mt-1 flex gap-2">
            <button
              className="text-xs text-primary hover:underline"
              onClick={() =>
                setLimitPrice(ticker.best_bid_price)
              }
            >
              Bid: {formatUsd(ticker.best_bid_price)}
            </button>
            <button
              className="text-xs text-primary hover:underline"
              onClick={() =>
                setLimitPrice(ticker.best_ask_price)
              }
            >
              Ask: {formatUsd(ticker.best_ask_price)}
            </button>
          </div>
        )}
      </div>

      {/* Cost estimate */}
      {amount && limitPrice && (
        <div className="rounded-md bg-secondary p-3 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Est. Cost</span>
            <span className="font-medium">
              {formatUsd(parseFloat(amount) * parseFloat(limitPrice))}
            </span>
          </div>
        </div>
      )}

      {/* Submit */}
      <Button
        onClick={handleSubmit}
        disabled={!canSubmit}
        variant={isBuy ? "success" : "destructive"}
        className="w-full"
      >
        {!isAuthenticated
          ? "Connect Wallet"
          : !selectedInstrument
          ? "Select Instrument"
          : isSubmitting
          ? status === "signing"
            ? "Signing..."
            : "Submitting..."
          : `${isBuy ? "Buy" : "Sell"} ${selectedInstrument ? formatInstrumentName(selectedInstrument) : ""}`}
      </Button>

      {/* Error */}
      {status === "error" && (
        <p className="text-xs text-destructive">{useTradeStore.getState().error}</p>
      )}
    </Card>
  );
}
