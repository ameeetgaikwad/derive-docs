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
import { cn } from "@/lib/utils";

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

  const { expiries, strikes: rawStrikes, isLoading: instrumentsLoading, isTickersLoading } = useAvailableStrikes(selectedExpiry, spotPrice);
  const createPosition = useCreateCoveredCallPosition();
  const requestQuote = useRequestQuote();
  const acceptQuote = useAcceptQuote();
  const premiumWithdraw = usePremiumWithdraw();
  const { updatePosition } = useCoveredCallStore();

  const { data: rfqData } = useQuotes(rfqId, positionSubaccountId);
  const { data: collaterals = [] } = useCollaterals();

  const btcCollateral = collaterals.find((c) =>
    ["WBTC", "CBBTC", "LBTC", "BTC"].includes(c.asset_name)
  );
  const btcBalance = btcCollateral ? parseFloat(btcCollateral.amount) : 0;
  const btcAssetName = btcCollateral?.asset_name ?? "CBBTC"; // actual token for API
  const btcDisplayName = "BTC"; // user-facing label

  useEffect(() => {
    if (expiries.length > 0 && (selectedExpiry === null || !expiries.find((e) => e.epoch === selectedExpiry))) {
      const now = Date.now() / 1000;
      const viable = expiries.filter((e) => e.epoch - now > 2 * 86400);
      setSelectedExpiry(viable.length > 0 ? viable[0].epoch : expiries[0].epoch);
    }
  }, [expiries, selectedExpiry]);

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
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_320px]">
        {/* Main panel */}
        <div className="rounded-[10px] border-[0.5px] border-border bg-card p-6">
          {/* Top bar */}
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <div className="rounded-md border-[0.5px] border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground">
              BTC Covered Call
            </div>

            <select
              value={selectedExpiry ?? ""}
              onChange={(e) => { setSelectedExpiry(Number(e.target.value)); setSelectedStrike(null); }}
              disabled={step !== "select"}
              className="rounded-md border-[0.5px] border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground disabled:opacity-50"
            >
              {expiries.map((e) => (
                <option key={e.epoch} value={e.epoch}>{e.label}</option>
              ))}
            </select>

            <div className="flex-1" />

            {spotPrice > 0 && (
              <div className="rounded-md border-[0.5px] border-border bg-background px-3 py-1.5 text-xs text-muted-foreground">
                Spot: <span className="font-semibold text-foreground">${spotPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              </div>
            )}

            {step !== "select" && (
              <div className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-accent">
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
              <div className="mb-2 text-lg font-bold tracking-[-0.03em] text-success font-heading">
                Position Created
              </div>
              <div className="mb-1 text-sm text-secondary-foreground">
                Earned{" "}
                <span className="font-semibold text-foreground">
                  ${earnedPremium ? parseFloat(earnedPremium).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}
                </span>{" "}
                premium
              </div>
              <div className="mb-6 text-xs text-muted-foreground">
                {selectedStrikeData?.instrumentName} · Subaccount #{positionSubaccountId}
              </div>
              <button
                onClick={handleReset}
                className="rounded-md border-[0.5px] border-border bg-background px-6 py-2.5 text-xs font-medium text-secondary-foreground transition-colors hover:border-secondary-foreground"
              >
                Create Another Position
              </button>
            </div>
          ) : (
            <>
              {loading ? (
                <div className="py-10 text-center text-sm text-muted-foreground">Loading strikes...</div>
              ) : (
                <>
                  <div className="mb-1 text-sm text-secondary-foreground">
                    Choose the price at which you are happy to sell{" "}
                    <span className="font-semibold text-foreground">BTC</span> on{" "}
                    <span className="font-semibold text-foreground">{selectedExpiryData?.label}</span>{" "}
                    <span className="text-muted-foreground">(in {dte} days)</span>
                  </div>
                  <div className="mb-4 text-[10px] text-muted-foreground">
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
                  collateralLabel={btcDisplayName}
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
                    collateralLabel={btcDisplayName}
                  />
                </div>
              )}

              {step === "accept" && bestQuote && (
                <div className="mb-5 rounded-[10px] border-[0.5px] border-success/30 bg-success/5 p-4">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-success">
                    Best Quote Received
                  </div>
                  <div className="text-lg font-bold tracking-[-0.03em] text-foreground font-heading">
                    ${parseFloat(bestQuote.total_premium).toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-xs text-muted-foreground">USDC</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Expires {new Date(bestQuote.valid_until * 1000).toLocaleTimeString()}
                  </div>
                </div>
              )}

              <button
                onClick={handleCTA}
                disabled={ctaDisabled}
                className={cn(
                  "w-full rounded-md py-3.5 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-30",
                  !ctaDisabled
                    ? "bg-accent text-black"
                    : "bg-card-elevated text-muted-foreground"
                )}
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
            collateralLabel={btcDisplayName}
            apr={selectedStrikeData?.apr ?? 0}
          />
        </div>
      </div>
    </div>
  );
}
