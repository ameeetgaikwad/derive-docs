"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useAccount } from "wagmi";
import { useDerive } from "@/providers/DeriveProvider";
import { useAvailableStrikes } from "@/hooks/covered-call/useAvailableStrikes";
import { useCreateCoveredCallPosition } from "@/hooks/covered-call/useCoveredCallSubaccount";
import { useRequestQuote, useQuotes, useAcceptQuote } from "@/hooks/covered-call/useRFQ";
import { usePremiumWithdraw } from "@/hooks/covered-call/usePremiumWithdraw";
import { useCoveredCallStore } from "@/stores/covered-call";
import { useCollaterals } from "@/hooks/portfolio/useCollaterals";
import { useTicker } from "@/hooks/market/useTicker";
import { calculateAPR, daysToExpiry, calculateOutcome } from "@/lib/derive/apr";
import { StrikeSelector } from "./StrikeSelector";
import { AmountInput } from "./AmountInput";
import { OutcomePreview } from "./OutcomePreview";
import { EarnSummary } from "./EarnSummary";

type FlowStep = "select" | "deposit" | "quote" | "accept" | "done";

interface StrikeOptionForUI {
  strike: number;
  instrumentName: string;
  apr: number;
  premium: number;
  expiry: number;
  otmPercent: number;
}

export function CoveredCallFlow() {
  const { isConnected } = useAccount();
  const { isReady, isAuthenticated, authenticate } = useDerive();

  const [step, setStep] = useState<FlowStep>("select");
  const [selectedExpiry, setSelectedExpiry] = useState<number | null>(null);
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [positionSubaccountId, setPositionSubaccountId] = useState<number | null>(null);
  const [rfqId, setRfqId] = useState<string | null>(null);
  const [earnedPremium, setEarnedPremium] = useState<string | null>(null);

  const { data: perpTicker } = useTicker("BTC-PERP");
  const spotPrice = perpTicker ? parseFloat(perpTicker.index_price) : 0;

  // Pass selectedExpiry + spotPrice so the hook can select smart OTM strikes
  const { expiries, strikes: rawStrikes, isLoading: instrumentsLoading, isTickersLoading } = useAvailableStrikes(selectedExpiry, spotPrice);
  const createPosition = useCreateCoveredCallPosition();
  const requestQuote = useRequestQuote();
  const acceptQuote = useAcceptQuote();
  const premiumWithdraw = usePremiumWithdraw();
  const { updatePosition } = useCoveredCallStore();

  const { data: rfqData } = useQuotes(rfqId, positionSubaccountId);
  const { data: collaterals = [] } = useCollaterals();

  // Find BTC-related collateral (WBTC, CBBTC, etc.)
  const btcCollateral = collaterals.find((c) =>
    ["WBTC", "CBBTC", "LBTC", "BTC"].includes(c.asset_name)
  );
  const btcBalance = btcCollateral ? parseFloat(btcCollateral.amount) : 0;
  const btcAssetName = btcCollateral?.asset_name ?? "CBBTC";

  // Auto-select a good default expiry (skip < 2 days, prefer ~7-14 day expiries)
  useEffect(() => {
    if (expiries.length > 0 && (selectedExpiry === null || !expiries.find((e) => e.epoch === selectedExpiry))) {
      const now = Date.now() / 1000;
      // Prefer expiries > 2 days out for better liquidity
      const viable = expiries.filter((e) => e.epoch - now > 2 * 86400);
      setSelectedExpiry(viable.length > 0 ? viable[0].epoch : expiries[0].epoch);
    }
  }, [expiries, selectedExpiry]);

  // Build UI strikes with APR from live market prices (bid or mark)
  const strikes: StrikeOptionForUI[] = useMemo(() => {
    if (!selectedExpiry || spotPrice <= 0) return [];

    const dte = daysToExpiry(selectedExpiry);
    if (dte <= 0) return [];

    return rawStrikes
      .filter((s) => s.estimatedPrice > 0)
      .map((s) => ({
        strike: s.strike,
        instrumentName: s.instrumentName,
        apr: calculateAPR(s.estimatedPrice, spotPrice, dte),
        premium: s.estimatedPrice,
        expiry: s.expiry,
        otmPercent: s.otmPercent ?? 0,
      }));
  }, [rawStrikes, selectedExpiry, spotPrice]);

  // Auto-select the first OTM strike (lowest strike above spot = highest premium)
  useEffect(() => {
    if (strikes.length > 0 && (selectedStrike === null || !strikes.find((s) => s.strike === selectedStrike))) {
      setSelectedStrike(strikes[0].strike);
    }
  }, [strikes, selectedStrike]);

  const amountNum = parseFloat(amount) || 0;
  const selectedStrikeData = strikes.find((s) => s.strike === selectedStrike);
  const selectedExpiryData = expiries.find((e) => e.epoch === selectedExpiry);
  const dte = selectedExpiry ? Math.ceil(daysToExpiry(selectedExpiry)) : 0;

  const outcome = selectedStrikeData && amountNum > 0
    ? calculateOutcome({
        type: "covered_call",
        strikePrice: selectedStrikeData.strike,
        spotPrice,
        amount: amountNum,
        premium: selectedStrikeData.premium,
      })
    : null;

  const bestQuote = useMemo(() => {
    if (!rfqData || rfqData.length === 0) return null;
    return rfqData.reduce((best, q) => {
      const bestPremium = parseFloat(best.total_premium || "0");
      const qPremium = parseFloat(q.total_premium || "0");
      return qPremium > bestPremium ? q : best;
    });
  }, [rfqData]);

  useEffect(() => {
    if (step === "quote" && bestQuote) {
      setStep("accept");
    }
  }, [step, bestQuote]);

  const handleCTA = useCallback(async () => {
    if (!isConnected) return;
    if (!isAuthenticated) {
      await authenticate();
      return;
    }

    if (step === "select") {
      if (!selectedStrikeData || amountNum <= 0) return;
      setStep("deposit");
    }

    if (step === "deposit") {
      createPosition.mutate(
        { amount: amount, btcAsset: btcAssetName as "WBTC" | "CBBTC" },
        {
          onSuccess: ({ subaccountId }) => {
            setPositionSubaccountId(subaccountId);
            setStep("quote");
          },
        }
      );
    }

    if (step === "quote") {
      if (!positionSubaccountId || !selectedStrikeData) return;
      requestQuote.mutate(
        {
          subaccountId: positionSubaccountId,
          instrumentName: selectedStrikeData.instrumentName,
          amount: amountNum.toString(),
        },
        {
          onSuccess: (result) => {
            setRfqId(result.rfq_id);
            updatePosition(positionSubaccountId, {
              instrumentName: selectedStrikeData.instrumentName,
              strike: selectedStrikeData.strike,
              expiry: selectedStrikeData.expiry,
              status: "quoted",
            });
          },
        }
      );
    }

    if (step === "accept") {
      if (!positionSubaccountId || !rfqId || !bestQuote) return;
      acceptQuote.mutate(
        {
          subaccountId: positionSubaccountId,
          rfqId,
          quote: bestQuote,
        },
        {
          onSuccess: () => {
            setEarnedPremium(bestQuote.total_premium);
            updatePosition(positionSubaccountId, {
              premiumUsdc: bestQuote.total_premium,
              status: "active",
            });
            setStep("done");
          },
        }
      );
    }
  }, [
    isConnected, isAuthenticated, authenticate, step,
    selectedStrikeData, amountNum, amount,
    createPosition, positionSubaccountId, requestQuote,
    rfqId, bestQuote, acceptQuote, updatePosition,
  ]);

  const handleReset = useCallback(() => {
    setStep("select");
    setPositionSubaccountId(null);
    setRfqId(null);
    setEarnedPremium(null);
    setAmount("");
  }, []);

  const isPending = createPosition.isPending || requestQuote.isPending || acceptQuote.isPending;
  const loading = instrumentsLoading || isTickersLoading;

  const ctaLabel = (() => {
    if (isPending) return "Processing...";
    if (!isConnected) return "Connect Wallet";
    if (!isAuthenticated) return "Sign in to Derive";
    switch (step) {
      case "select":
        return "Deposit BTC & Create Position";
      case "deposit":
        return "Deposit BTC & Create Position";
      case "quote":
        return rfqId ? "Waiting for quotes..." : "Get Quotes";
      case "accept":
        return bestQuote
          ? `Sell Call for $${parseFloat(bestQuote.total_premium).toLocaleString(undefined, { maximumFractionDigits: 2 })} premium`
          : "Waiting for quotes...";
      case "done":
        return "Position Created";
    }
  })();

  const ctaDisabled = isPending
    || (step === "select" && (!selectedStrikeData || amountNum <= 0))
    || (step === "quote" && !!rfqId && !bestQuote)
    || step === "done";

  return (
    <div className="min-h-screen p-6" style={{ background: "#0b1018" }}>
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_320px]">
        {/* Main panel */}
        <div className="rounded-xl border p-6" style={{ borderColor: "#1e293b", background: "#111827" }}>
          {/* Top bar */}
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <div className="rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold" style={{ borderColor: "#1e293b", color: "#e5e7eb", background: "#0b1018" }}>
              BTC Covered Call
            </div>

            <select
              value={selectedExpiry ?? ""}
              onChange={(e) => { setSelectedExpiry(Number(e.target.value)); setSelectedStrike(null); }}
              disabled={step !== "select"}
              className="rounded-lg border px-3 py-1.5 font-mono text-xs font-medium disabled:opacity-50"
              style={{ borderColor: "#1e293b", color: "#e5e7eb", background: "#0b1018" }}
            >
              {expiries.map((e) => (
                <option key={e.epoch} value={e.epoch}>{e.label}</option>
              ))}
            </select>

            <div className="flex-1" />

            {spotPrice > 0 && (
              <div className="rounded-lg border px-3 py-1.5 font-mono text-xs" style={{ borderColor: "#1e293b", background: "#0b1018", color: "#6b7280" }}>
                Spot: <span className="font-semibold" style={{ color: "#e5e7eb" }}>${spotPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              </div>
            )}

            {step !== "select" && (
              <div className="rounded-full px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#22c55e", background: "rgba(34, 197, 94, 0.1)", border: "1px solid rgba(34, 197, 94, 0.2)" }}>
                {step === "deposit" && "Depositing..."}
                {step === "quote" && "Getting Quotes"}
                {step === "accept" && "Quote Ready"}
                {step === "done" && "Complete"}
              </div>
            )}
          </div>

          {/* Done state */}
          {step === "done" ? (
            <div className="py-10 text-center">
              <div className="mb-2 font-mono text-lg font-bold" style={{ color: "#22c55e" }}>
                Position Created
              </div>
              <div className="mb-1 font-mono text-sm" style={{ color: "#9ca3af" }}>
                Earned{" "}
                <span className="font-semibold" style={{ color: "#e5e7eb" }}>
                  ${earnedPremium ? parseFloat(earnedPremium).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}
                </span>{" "}
                premium
              </div>
              <div className="mb-6 font-mono text-xs" style={{ color: "#6b7280" }}>
                {selectedStrikeData?.instrumentName} · Subaccount #{positionSubaccountId}
              </div>
              <button
                onClick={handleReset}
                className="rounded-lg border px-6 py-2.5 font-mono text-xs font-medium transition-colors hover:border-[#9ca3af]"
                style={{ borderColor: "#1e293b", color: "#9ca3af", background: "#0b1018" }}
              >
                Create Another Position
              </button>
            </div>
          ) : (
            <>
              {loading ? (
                <div className="py-10 text-center font-mono text-sm" style={{ color: "#6b7280" }}>Loading strikes...</div>
              ) : (
                <>
                  <div className="mb-1 font-mono text-sm" style={{ color: "#9ca3af" }}>
                    Choose the price at which you are happy to sell{" "}
                    <span className="font-semibold" style={{ color: "#e5e7eb" }}>BTC</span> on{" "}
                    <span className="font-semibold" style={{ color: "#e5e7eb" }}>{selectedExpiryData?.label}</span>{" "}
                    <span style={{ color: "#6b7280" }}>(in {dte} days)</span>
                  </div>
                  <div className="mb-4 font-mono text-[10px]" style={{ color: "#6b7280" }}>
                    Prices are live from the Derive exchange orderbook
                  </div>
                  <div className="mb-6">
                    <StrikeSelector
                      strikes={strikes}
                      selectedStrike={selectedStrike}
                      onSelect={(s) => { if (step === "select") setSelectedStrike(s); }}
                    />
                  </div>
                </>
              )}

              <div className="mb-5">
                <AmountInput
                  amount={amount}
                  onAmountChange={(v) => { if (step === "select") setAmount(v); }}
                  balance={btcBalance}
                  collateralLabel={btcAssetName}
                  insufficientBalance={amountNum > btcBalance && btcBalance > 0}
                  step={0.01}
                />
              </div>

              {selectedStrikeData && outcome && amountNum > 0 && (
                <div className="mb-5">
                  <OutcomePreview
                    asset="BTC"
                    strike={selectedStrikeData.strike}
                    apr={selectedStrikeData.apr}
                    outcome={outcome}
                    expiryLabel={selectedExpiryData?.label || ""}
                    strategyType="covered_call"
                    collateralLabel={btcAssetName}
                  />
                </div>
              )}

              {step === "accept" && bestQuote && (
                <div className="mb-5 rounded-lg border p-4" style={{ borderColor: "rgba(34, 197, 94, 0.3)", background: "rgba(34, 197, 94, 0.05)" }}>
                  <div className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#22c55e" }}>
                    Best Quote Received
                  </div>
                  <div className="font-mono text-lg font-bold" style={{ color: "#e5e7eb" }}>
                    ${parseFloat(bestQuote.total_premium).toLocaleString(undefined, { maximumFractionDigits: 2 })} <span style={{ color: "#6b7280", fontSize: "0.75rem" }}>USDC</span>
                  </div>
                  <div className="mt-1 font-mono text-xs" style={{ color: "#6b7280" }}>
                    Expires {new Date(bestQuote.valid_until * 1000).toLocaleTimeString()}
                  </div>
                </div>
              )}

              <button
                onClick={handleCTA}
                disabled={ctaDisabled}
                className="w-full rounded-lg py-3.5 font-mono text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-30"
                style={{
                  background: !ctaDisabled ? "#22c55e" : "#1e293b",
                  color: !ctaDisabled ? "#0b1018" : "#6b7280",
                }}
              >
                {ctaLabel}
              </button>
            </>
          )}
        </div>

        {/* Right side panel */}
        <div>
          <EarnSummary
            outcome={outcome}
            strike={selectedStrike}
            spotPrice={spotPrice}
            amount={amountNum}
            collateralLabel={btcAssetName}
            apr={selectedStrikeData?.apr ?? 0}
          />
        </div>
      </div>
    </div>
  );
}
