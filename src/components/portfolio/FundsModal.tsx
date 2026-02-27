"use client";

import { useState, useEffect } from "react";
import {
  useDeposit,
  useWithdraw,
  type DepositStep,
  type WithdrawStep,
} from "@/hooks/mutations/useDeposit";
import { cn } from "@/lib/utils";
import type { Collateral } from "@/lib/derive/types";
import { BridgeForm } from "@/components/account/BridgeModal";
import { TokenIcon } from "@/components/ui/TokenIcon";

type Tab = "deposit" | "withdraw" | "bridge";

const DEPOSIT_STEP_LABELS: Record<DepositStep, string> = {
  idle: "",
  transferring: "Transferring to wallet...",
  signing: "Signing deposit...",
  confirming: "Confirming deposit...",
  done: "Done!",
};

const WITHDRAW_STEP_LABELS: Record<WithdrawStep, string> = {
  idle: "",
  signing: "Signing withdrawal...",
  confirming: "Confirming withdrawal...",
  transferring: "Transferring to your wallet...",
  done: "Done!",
};

interface FundsModalProps {
  open: boolean;
  onClose: () => void;
  collaterals: Collateral[];
  initialTab?: Tab;
}

export function FundsModal({ open, onClose, collaterals, initialTab = "deposit" }: FundsModalProps) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [amount, setAmount] = useState("");
  const [asset, setAsset] = useState<"USDC" | "BTC">("USDC");
  const deposit = useDeposit();
  const withdraw = useWithdraw();

  // Sync tab when initialTab changes
  useEffect(() => {
    if (open) setTab(initialTab);
  }, [initialTab, open]);

  if (!open) return null;

  const usdcCollateral = collaterals.find((c) => c.asset_name === "USDC");
  const btcCollateral = collaterals.find((c) =>
    ["WBTC", "CBBTC", "LBTC", "BTC"].includes(c.asset_name)
  );
  const usdcBalance = usdcCollateral ? parseFloat(usdcCollateral.amount) : 0;
  const btcBalance = btcCollateral ? parseFloat(btcCollateral.amount) : 0;
  const selectedBalance = asset === "USDC" ? usdcBalance : btcBalance;
  const displayAsset = asset; // already "USDC" or "BTC"

  const isDeposit = tab === "deposit";
  const isSubmitting = isDeposit ? deposit.isPending : withdraw.isPending;

  const handleSubmit = () => {
    const val = parseFloat(amount);
    if (!val || val <= 0) return;
    if (isDeposit) {
      deposit.mutate({ amount }, { onSuccess: () => setAmount("") });
    } else {
      withdraw.mutate({ amount }, { onSuccess: () => setAmount("") });
    }
  };

  const handleMaxClick = () => {
    if (selectedBalance > 0) {
      setAmount(selectedBalance.toString());
    }
  };

  const error = isDeposit ? deposit.error : withdraw.error;
  const isError = isDeposit ? deposit.isError : withdraw.isError;
  const stepLabel = isDeposit
    ? DEPOSIT_STEP_LABELS[deposit.depositStep]
    : WITHDRAW_STEP_LABELS[withdraw.withdrawStep];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-md overflow-hidden rounded-[10px] border-[0.5px] border-border bg-card">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3 bg-card-elevated">
          <span className="text-sm font-bold tracking-[-0.03em] text-foreground font-heading">
            Manage Funds
          </span>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* Tab toggle */}
          <div className="flex gap-1 rounded-[10px] bg-background p-1">
            {(["deposit", "withdraw", "bridge"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "flex-1 rounded-md py-2 text-xs font-semibold capitalize transition-colors",
                  tab !== t && "text-muted-foreground hover:text-secondary-foreground",
                  tab === t && "bg-card-elevated",
                  tab === t && t === "deposit" && "text-accent",
                  tab === t && t === "withdraw" && "text-destructive",
                  tab === t && t === "bridge" && "text-blue-500",
                )}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === "bridge" ? (
            <BridgeForm />
          ) : (
            <>
              {/* Asset selector */}
              <div className="flex gap-2">
                {(["USDC", "BTC"] as const).map((a) => (
                  <button
                    key={a}
                    onClick={() => setAsset(a)}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-2 rounded-[10px] border-[0.5px] py-2.5 text-xs font-semibold transition-colors",
                      asset === a
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border bg-background text-muted-foreground hover:text-secondary-foreground"
                    )}
                  >
                    <TokenIcon symbol={a} size={18} />
                    {a}
                  </button>
                ))}
              </div>

              {/* Balance display */}
              <div className="rounded-[10px] border-[0.5px] border-border bg-background p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{displayAsset} Balance on Derive</span>
                  <span className="text-foreground">
                    {selectedBalance.toFixed(asset === "USDC" ? 2 : 6)} {displayAsset}
                  </span>
                </div>
              </div>

              {/* Amount input */}
              <div className="relative">
                <input
                  type="number"
                  placeholder="0.00"
                  min="0"
                  step={asset === "USDC" ? "1" : "0.0001"}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full rounded-[10px] border-[0.5px] border-border bg-background py-3 pl-4 pr-20 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground disabled:opacity-50 focus:border-accent"
                />
                <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
                  {selectedBalance > 0 && tab === "withdraw" && (
                    <button onClick={handleMaxClick} className="text-[10px] font-semibold text-accent">
                      MAX
                    </button>
                  )}
                  <span className="text-xs text-muted-foreground">{asset}</span>
                </div>
              </div>

              {/* Step indicator */}
              {(deposit.isPending || withdraw.isPending) && stepLabel && (
                <div className="flex items-center gap-2 text-xs text-secondary-foreground">
                  <span className={cn(
                    "inline-block h-2 w-2 animate-pulse rounded-full",
                    isDeposit ? "bg-accent" : "bg-destructive"
                  )} />
                  {stepLabel}
                </div>
              )}

              {/* Submit button */}
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || !amount || parseFloat(amount) <= 0}
                className={cn(
                  "w-full rounded-md py-3 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-30",
                  isDeposit
                    ? "bg-accent text-black"
                    : "bg-destructive text-white"
                )}
              >
                {isSubmitting
                  ? stepLabel || "Processing..."
                  : isDeposit
                    ? `Deposit ${asset}`
                    : `Withdraw ${asset}`}
              </button>

              {/* Error display */}
              {isError && error && (
                <p className="text-xs text-destructive">{error.message}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
