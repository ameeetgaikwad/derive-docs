"use client";

import { useState } from "react";
import {
  useDeposit,
  useWithdraw,
  type DepositStep,
  type WithdrawStep,
} from "@/hooks/mutations/useDeposit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatUsd } from "@/lib/derive/utils";
import type { Collateral } from "@/lib/derive/types";
import { BridgeForm } from "@/components/account/BridgeModal";

type Tab = "deposit" | "withdraw" | "bridge";

const DEPOSIT_STEP_LABELS: Record<DepositStep, string> = {
  idle: "",
  transferring: "Transferring USDC to wallet...",
  signing: "Signing deposit...",
  confirming: "Confirming deposit...",
  done: "Done!",
};

const WITHDRAW_STEP_LABELS: Record<WithdrawStep, string> = {
  idle: "",
  signing: "Signing withdrawal...",
  confirming: "Confirming withdrawal...",
  transferring: "Transferring USDC to your wallet...",
  done: "Done!",
};

interface FundsModalProps {
  open: boolean;
  onClose: () => void;
  collaterals: Collateral[];
}

export function FundsModal({ open, onClose, collaterals }: FundsModalProps) {
  const [tab, setTab] = useState<Tab>("deposit");
  const [amount, setAmount] = useState("");
  const deposit = useDeposit();
  const withdraw = useWithdraw();

  if (!open) return null;

  const usdcCollateral = collaterals.find((c) => c.asset_name === "USDC");
  const usdcBalance = usdcCollateral ? parseFloat(usdcCollateral.amount) : 0;

  const isDeposit = tab === "deposit";
  const isSubmitting = isDeposit ? deposit.isPending : withdraw.isPending;

  const handleSubmit = () => {
    const val = parseFloat(amount);
    if (!val || val <= 0) return;
    if (isDeposit) {
      deposit.mutate(
        { amount },
        { onSuccess: () => setAmount("") }
      );
    } else {
      withdraw.mutate(
        { amount },
        { onSuccess: () => setAmount("") }
      );
    }
  };

  const handleMaxClick = () => {
    if (tab === "withdraw" && usdcBalance > 0) {
      setAmount(usdcBalance.toString());
    }
  };

  const buttonLabel = () => {
    if (isDeposit && deposit.isPending) {
      return DEPOSIT_STEP_LABELS[deposit.depositStep] || "Processing...";
    }
    if (!isDeposit && withdraw.isPending) {
      return WITHDRAW_STEP_LABELS[withdraw.withdrawStep] || "Processing...";
    }
    return isDeposit
      ? `Deposit ${amount ? formatUsd(amount) : "USDC"}`
      : `Withdraw ${amount ? formatUsd(amount) : "USDC"}`;
  };

  const error = isDeposit ? deposit.error : withdraw.error;
  const isError = isDeposit ? deposit.isError : withdraw.isError;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-background/80" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-md rounded-md border-2 border-border bg-card overflow-hidden">
        {/* Terminal header */}
        <div className="flex items-center justify-between border-b-2 border-border bg-foreground px-3 py-1.5">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-success" />
            <span className="font-mono text-xs text-primary-foreground">
              ~/portfolio/funds
            </span>
          </div>
          <button
            onClick={onClose}
            className="font-mono text-xs text-primary-foreground hover:text-white"
          >
            [x]
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Tab toggle */}
          <div className="flex gap-1">
            <button
              onClick={() => setTab("deposit")}
              className={cn(
                "flex-1 rounded-md border-2 px-3 py-1.5 font-mono text-sm font-medium transition-colors",
                tab === "deposit"
                  ? "border-success bg-success text-white"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              Deposit
            </button>
            <button
              onClick={() => setTab("withdraw")}
              className={cn(
                "flex-1 rounded-md border-2 px-3 py-1.5 font-mono text-sm font-medium transition-colors",
                tab === "withdraw"
                  ? "border-destructive bg-destructive text-white"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              Withdraw
            </button>
            <button
              onClick={() => setTab("bridge")}
              className={cn(
                "flex-1 rounded-md border-2 px-3 py-1.5 font-mono text-sm font-medium transition-colors",
                tab === "bridge"
                  ? "border-accent bg-accent text-white"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              Bridge
            </button>
          </div>

          {tab === "bridge" ? (
            <BridgeForm />
          ) : (
            <>
              {/* Balance display */}
              <div className="rounded-md border-2 border-border/30 bg-secondary p-3 font-mono text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">USDC Balance</span>
                  <span className="font-medium">{formatUsd(usdcBalance)}</span>
                </div>
              </div>

              {/* Amount input */}
              <div>
                <label className="mb-1 block font-mono text-xs text-muted-foreground">
                  Amount (USDC)
                </label>
                <div className="relative">
                  <Input
                    type="number"
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={isSubmitting}
                  />
                  {tab === "withdraw" && usdcBalance > 0 && (
                    <button
                      onClick={handleMaxClick}
                      className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-xs text-foreground underline underline-offset-2 hover:text-accent"
                    >
                      MAX
                    </button>
                  )}
                </div>
              </div>

              {/* Step indicator */}
              {isDeposit && deposit.isPending && (
                <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-success" />
                  {DEPOSIT_STEP_LABELS[deposit.depositStep]}
                </div>
              )}
              {!isDeposit && withdraw.isPending && (
                <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-destructive" />
                  {WITHDRAW_STEP_LABELS[withdraw.withdrawStep]}
                </div>
              )}

              {/* Submit button */}
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting || !amount || parseFloat(amount) <= 0}
                variant={tab === "deposit" ? "success" : "destructive"}
                className="w-full"
              >
                {buttonLabel()}
              </Button>

              {/* Error display */}
              {isError && error && (
                <p className="font-mono text-xs text-destructive">
                  {error.message}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
