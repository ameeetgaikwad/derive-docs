"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { formatInstrumentName, formatUsd } from "@/lib/derive/utils";
import type { OrderDirection } from "@/lib/derive/types";

interface TradeConfirmationProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  instrumentName: string;
  direction: OrderDirection;
  amount: string;
  limitPrice: string;
  isSubmitting: boolean;
}

export function TradeConfirmation({
  open,
  onOpenChange,
  onConfirm,
  instrumentName,
  direction,
  amount,
  limitPrice,
  isSubmitting,
}: TradeConfirmationProps) {
  const isBuy = direction === "buy";
  const total = parseFloat(amount) * parseFloat(limitPrice);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 shadow-xl">
          <Dialog.Title className="text-lg font-semibold">
            Confirm {isBuy ? "Buy" : "Sell"} Order
          </Dialog.Title>

          <div className="mt-4 space-y-3">
            <div className="rounded-md bg-secondary p-3 text-sm">
              <p className="font-medium">{formatInstrumentName(instrumentName)}</p>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Direction</span>
                <span className={isBuy ? "text-success" : "text-destructive"}>
                  {direction.toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount</span>
                <span>{amount} contracts</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Limit Price</span>
                <span>{formatUsd(limitPrice)}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-2">
                <span className="text-muted-foreground">Est. Total</span>
                <span className="font-semibold">{formatUsd(total)}</span>
              </div>
            </div>
          </div>

          <div className="mt-6 flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant={isBuy ? "success" : "destructive"}
              className="flex-1"
              onClick={onConfirm}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Submitting..." : "Confirm"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
