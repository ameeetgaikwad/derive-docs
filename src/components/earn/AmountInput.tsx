"use client";

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
    <div className="rounded-lg border p-4" style={{ borderColor: "#1e293b", background: "#111827" }}>
      <div className="flex items-center gap-3">
        <button
          onClick={() => onAmountChange(balance.toString())}
          className="rounded border px-2.5 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider transition-colors hover:border-[#22c55e] hover:text-[#22c55e]"
          style={{ borderColor: "#1e293b", background: "#0b1018", color: "#6b7280" }}
        >
          MAX
        </button>
        <button
          onClick={() => onAmountChange(Math.max(0, amountNum - step).toString())}
          className="flex h-8 w-8 items-center justify-center rounded border font-mono text-sm transition-colors hover:border-[#9ca3af]"
          style={{ borderColor: "#1e293b", background: "#0b1018", color: "#6b7280" }}
        >
          −
        </button>
        <input
          type="number"
          step="any"
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
          placeholder="0.00"
          className="flex-1 bg-transparent text-center font-mono text-2xl font-semibold outline-none placeholder:text-[#4b5563]"
          style={{ color: "#e5e7eb" }}
        />
        <button
          onClick={() => onAmountChange((amountNum + step).toString())}
          className="flex h-8 w-8 items-center justify-center rounded border font-mono text-sm transition-colors hover:border-[#9ca3af]"
          style={{ borderColor: "#1e293b", background: "#0b1018", color: "#6b7280" }}
        >
          +
        </button>
        <span className="rounded-lg border px-3 py-1.5 font-mono text-xs font-medium" style={{ borderColor: "#1e293b", background: "#0b1018", color: "#e5e7eb" }}>
          {collateralLabel}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between font-mono text-[10px]" style={{ color: "#6b7280" }}>
        <span>Balance: {balance.toFixed(4)} {collateralLabel}</span>
        {insufficientBalance && (
          <span className="font-semibold uppercase" style={{ color: "#ef4444" }}>
            Insufficient Balance
          </span>
        )}
      </div>
    </div>
  );
}
