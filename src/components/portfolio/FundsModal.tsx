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
  const [asset, setAsset] = useState<"USDC" | "WBTC">("USDC");
  const deposit = useDeposit();
  const withdraw = useWithdraw();

  // Sync tab when initialTab changes
  useEffect(() => {
    if (open) setTab(initialTab);
  }, [initialTab, open]);

  if (!open) return null;

  const usdcCollateral = collaterals.find((c) => c.asset_name === "USDC");
  const wbtcCollateral = collaterals.find((c) => c.asset_name === "WBTC");
  const usdcBalance = usdcCollateral ? parseFloat(usdcCollateral.amount) : 0;
  const wbtcBalance = wbtcCollateral ? parseFloat(wbtcCollateral.amount) : 0;
  const selectedBalance = asset === "USDC" ? usdcBalance : wbtcBalance;

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
      <div className="absolute inset-0" style={{ background: "rgba(0, 0, 0, 0.7)" }} onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-md overflow-hidden rounded-xl border" style={{ borderColor: "#1e293b", background: "#111827" }}>
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: "#1e293b" }}>
          <span className="font-mono text-sm font-semibold" style={{ color: "#e5e7eb" }}>
            Manage Funds
          </span>
          <button
            onClick={onClose}
            className="rounded-md p-1 transition-colors"
            style={{ color: "#6b7280" }}
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Tab toggle */}
          <div className="flex gap-1 rounded-lg p-1" style={{ background: "#0b1018" }}>
            {(["deposit", "withdraw", "bridge"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="flex-1 rounded-md py-1.5 font-mono text-xs font-semibold capitalize transition-colors"
                style={{
                  background: tab === t ? "#1e293b" : "transparent",
                  color: tab === t
                    ? t === "deposit" ? "#22c55e" : t === "withdraw" ? "#ef4444" : "#3b82f6"
                    : "#6b7280",
                }}
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
                {(["USDC", "WBTC"] as const).map((a) => (
                  <button
                    key={a}
                    onClick={() => setAsset(a)}
                    className="flex-1 rounded-lg border py-2 font-mono text-xs font-semibold transition-colors"
                    style={{
                      borderColor: asset === a ? "#22c55e" : "#1e293b",
                      background: asset === a ? "rgba(34, 197, 94, 0.08)" : "#0b1018",
                      color: asset === a ? "#22c55e" : "#6b7280",
                    }}
                  >
                    {a}
                  </button>
                ))}
              </div>

              {/* Balance display */}
              <div className="rounded-lg border p-3" style={{ borderColor: "#1e293b", background: "#0b1018" }}>
                <div className="flex items-center justify-between font-mono text-xs">
                  <span style={{ color: "#6b7280" }}>{asset} Balance on Derive</span>
                  <span style={{ color: "#e5e7eb" }}>
                    {selectedBalance.toFixed(asset === "USDC" ? 2 : 6)} {asset}
                  </span>
                </div>
              </div>

              {/* Amount input */}
              <div>
                <div className="relative">
                  <input
                    type="number"
                    placeholder="0.00"
                    min="0"
                    step={asset === "USDC" ? "1" : "0.0001"}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={isSubmitting}
                    className="w-full rounded-lg border py-3 pl-4 pr-20 font-mono text-sm outline-none transition-colors disabled:opacity-50"
                    style={{ borderColor: "#1e293b", background: "#0b1018", color: "#e5e7eb" }}
                  />
                  <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
                    {selectedBalance > 0 && tab === "withdraw" && (
                      <button
                        onClick={handleMaxClick}
                        className="font-mono text-[10px] font-semibold"
                        style={{ color: "#22c55e" }}
                      >
                        MAX
                      </button>
                    )}
                    <span className="font-mono text-xs" style={{ color: "#6b7280" }}>{asset}</span>
                  </div>
                </div>
              </div>

              {/* Step indicator */}
              {(deposit.isPending || withdraw.isPending) && stepLabel && (
                <div className="flex items-center gap-2 font-mono text-xs" style={{ color: "#9ca3af" }}>
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full" style={{ background: isDeposit ? "#22c55e" : "#ef4444" }} />
                  {stepLabel}
                </div>
              )}

              {/* Submit button */}
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || !amount || parseFloat(amount) <= 0}
                className="w-full rounded-lg py-3 font-mono text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-30"
                style={{
                  background: isDeposit ? "#22c55e" : "#ef4444",
                  color: "#0b1018",
                }}
              >
                {isSubmitting
                  ? stepLabel || "Processing..."
                  : isDeposit
                    ? `Deposit ${asset}`
                    : `Withdraw ${asset}`}
              </button>

              {/* Error display */}
              {isError && error && (
                <p className="font-mono text-xs" style={{ color: "#ef4444" }}>
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
