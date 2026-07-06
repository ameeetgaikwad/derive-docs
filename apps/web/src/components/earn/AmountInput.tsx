"use client";

import { TokenIcon } from "@/components/ui/TokenIcon";

interface AmountInputProps {
  amount: string;
  onAmountChange: (val: string) => void;
  balance: number;
  collateralLabel: string;
  insufficientBalance: boolean;
  step?: number;
}

export function AmountInput({
  amount,
  onAmountChange,
  balance,
  collateralLabel,
  insufficientBalance,
  step = 0.01,
}: AmountInputProps) {
  const amountNum = parseFloat(amount) || 0;

  return (
    <div className="rounded-[10px] border-[0.5px] border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => onAmountChange(balance.toString())}
          className="rounded-md border-[0.5px] border-border bg-background px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:border-accent hover:text-accent"
        >
          MAX
        </button>
        <button
          onClick={() => onAmountChange(Math.max(0, amountNum - step).toString())}
          className="flex h-8 w-8 items-center justify-center rounded-md border-[0.5px] border-border bg-background text-sm text-muted-foreground transition-colors hover:border-secondary-foreground"
        >
          −
        </button>
        <input
          type="number"
          step="any"
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
          placeholder="0.00"
          className="flex-1 bg-transparent text-center text-2xl font-semibold text-foreground outline-none placeholder:text-muted-foreground"
        />
        <button
          onClick={() => onAmountChange((amountNum + step).toString())}
          className="flex h-8 w-8 items-center justify-center rounded-md border-[0.5px] border-border bg-background text-sm text-muted-foreground transition-colors hover:border-secondary-foreground"
        >
          +
        </button>
        <span className="flex items-center gap-2 rounded-[10px] border-[0.5px] border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground">
          <TokenIcon symbol={collateralLabel} size={18} />
          {collateralLabel}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Balance: {balance.toFixed(4)} {collateralLabel}</span>
        {insufficientBalance && (
          <span className="font-semibold uppercase text-destructive">
            Insufficient Balance
          </span>
        )}
      </div>
    </div>
  );
}
