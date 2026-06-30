"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { toast } from "sonner";
import { useAvailableStrikes } from "@/hooks/protocol/useAvailableStrikes";
import {
  useCoveredCallSubaccount,
  useDepositBtcb,
} from "@/hooks/protocol/useCoveredCallSubaccount";
import { useBtcbBalance, useMintBtcb } from "@/hooks/protocol/useBtcb";
import { usePositionMonitor } from "@/hooks/protocol/usePositionMonitor";
import { useSellCall } from "@/hooks/protocol/useSellCall";
import { useCoveredCallStore } from "@/stores/covered-call";
import { calculateOutcome, daysToExpiry } from "@/lib/protocol/apr";
import { explorerTxUrl } from "@/lib/protocol/deployments";
import { toUnit } from "@/lib/protocol/units";
import { TBNB_FAUCET_URL } from "@/lib/protocol/chain";
import { StrikeSelector } from "./StrikeSelector";
import { AmountInput } from "./AmountInput";
import { OutcomePreview } from "./OutcomePreview";
import { EarnSummary } from "./EarnSummary";
import { cn } from "@/lib/utils";

type FlowStep = "select" | "subaccount" | "deposit" | "selling" | "done";

const STEP_LABEL: Record<Exclude<FlowStep, "select" | "done">, string> = {
  subaccount: "Creating subaccount",
  deposit: "Depositing BTCB",
  selling: "Selling call",
};

function getDefaultExpiry(expiries: { epoch: number }[]): number | null {
  if (expiries.length === 0) return null;
  const now = Date.now() / 1000;
  const viable = expiries.filter((e) => e.epoch - now > 2 * 86400);
  return viable.length > 0 ? viable[0].epoch : expiries[0].epoch;
}

function AuctionPanel({
  endsAt,
  quoteCount,
  bestTotalPremium,
}: {
  endsAt: number;
  quoteCount: number;
  bestTotalPremium: number | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, []);
  const remaining = Math.max(0, (endsAt - now) / 1000);

  return (
    <div className="rounded-[10px] border-[0.5px] border-accent/30 bg-accent/5 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-accent">
          RFQ auction live
        </span>
        <span className="font-mono text-xs text-accent">
          {remaining > 0 ? `${remaining.toFixed(1)}s` : "closing…"}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {quoteCount} quote{quoteCount === 1 ? "" : "s"} received
        </span>
        <span className="font-semibold text-foreground">
          {bestTotalPremium !== null
            ? `Best: $${bestTotalPremium.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
            : "Waiting for quotes…"}
        </span>
      </div>
    </div>
  );
}

export function CoveredCallFlow() {
  const { isConnected, address } = useAccount();
  const { openConnectModal } = useConnectModal();

  const [step, setStep] = useState<FlowStep>("select");
  const [selectedExpiry, setSelectedExpiry] = useState<number | null>(null);
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [doneInfo, setDoneInfo] = useState<{
    premium: number;
    txHash: string;
    instrumentName: string;
  } | null>(null);

  const { expiries, strikes, spotPrice, isLoading } =
    useAvailableStrikes(selectedExpiry);

  const { subaccountId, ensureSubaccount } = useCoveredCallSubaccount();
  const depositBtcb = useDepositBtcb();
  const sellCall = useSellCall();
  const mintBtcb = useMintBtcb();
  const { balanceNumber: walletBtcb, refetch: refetchBtcb } = useBtcbBalance();
  const { balances: subBalances, refetch: refetchPositions } =
    usePositionMonitor(subaccountId);
  const { addTrade } = useCoveredCallStore();

  // Total BTC the user can write calls against: wallet BTCB (will be
  // deposited) + BTCB already inside the covered-call subaccount.
  const subBtcb = subBalances.btcb;
  const btcBalance = walletBtcb + subBtcb;

  // Auto-select default expiry
  const effectiveExpiry = useMemo(() => {
    if (selectedExpiry !== null && expiries.find((e) => e.epoch === selectedExpiry)) {
      return selectedExpiry;
    }
    return getDefaultExpiry(expiries);
  }, [expiries, selectedExpiry]);

  if (effectiveExpiry !== null && effectiveExpiry !== selectedExpiry) {
    setSelectedExpiry(effectiveExpiry);
  }

  // Auto-select default strike
  const effectiveStrike = useMemo(() => {
    if (selectedStrike !== null && strikes.find((s) => s.strike === selectedStrike)) {
      return selectedStrike;
    }
    return strikes.length > 0 ? strikes[0].strike : null;
  }, [strikes, selectedStrike]);

  if (effectiveStrike !== null && effectiveStrike !== selectedStrike) {
    setSelectedStrike(effectiveStrike);
  }

  const amountNum = parseFloat(amount) || 0;
  const selectedStrikeData = strikes.find((s) => s.strike === selectedStrike);
  const selectedExpiryData = expiries.find((e) => e.epoch === selectedExpiry);
  const dte = selectedExpiry ? Math.ceil(daysToExpiry(selectedExpiry)) : 0;

  const outcome =
    selectedStrikeData && amountNum > 0
      ? calculateOutcome({
          type: "covered_call",
          strikePrice: selectedStrikeData.strike,
          spotPrice,
          amount: amountNum,
          premium: selectedStrikeData.premium,
        })
      : null;

  const isPending = step !== "select" && step !== "done";

  const handleCTA = useCallback(async () => {
    if (!isConnected || !address) {
      openConnectModal?.();
      return;
    }
    if (!selectedStrikeData || amountNum <= 0 || isPending) return;

    try {
      // 1. Subaccount (one-time tx)
      setStep("subaccount");
      const subId = await ensureSubaccount();

      // 2. Deposit the deficit from the wallet (approve + deposit txs)
      const deficit = amountNum - subBtcb;
      if (deficit > 0) {
        setStep("deposit");
        await depositBtcb(subId, toUnit(deficit.toFixed(18)));
        refetchBtcb();
      }

      // 3. RFQ auction + EIP-712 TakerOrder signature + on-chain execution
      setStep("selling");
      const result = await sellCall.sell({
        subaccountId: subId,
        expiry: selectedStrikeData.expiry,
        strike: selectedStrikeData.strike,
        amount: amountNum.toString(),
        instrumentName: selectedStrikeData.instrumentName,
      });

      addTrade({
        address,
        subaccountId: subId.toString(),
        instrumentName: result.instrumentName,
        strike: selectedStrikeData.strike,
        expiry: selectedStrikeData.expiry,
        amount: amountNum.toString(),
        premium: result.totalPremium.toFixed(2),
        txHash: result.txHash,
        createdAt: Date.now(),
      });
      refetchPositions();
      setDoneInfo({
        premium: result.totalPremium,
        txHash: result.txHash,
        instrumentName: result.instrumentName,
      });
      toast.success(
        `Call sold — earned $${result.totalPremium.toLocaleString(undefined, { maximumFractionDigits: 2 })} premium`
      );
      setStep("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
      setStep("select");
    }
  }, [
    isConnected,
    address,
    openConnectModal,
    selectedStrikeData,
    amountNum,
    isPending,
    ensureSubaccount,
    subBtcb,
    depositBtcb,
    refetchBtcb,
    sellCall,
    addTrade,
    refetchPositions,
  ]);

  const handleReset = useCallback(() => {
    setStep("select");
    setDoneInfo(null);
    setAmount("");
    sellCall.reset();
  }, [sellCall]);

  const ctaLabel = (() => {
    if (!isConnected) return "Connect Wallet";
    switch (step) {
      case "select":
        return subaccountId === null
          ? "Set up & Sell Covered Call"
          : "Deposit BTCB & Sell Call";
      case "subaccount":
        return "Creating subaccount…";
      case "deposit":
        return "Depositing BTCB…";
      case "selling":
        switch (sellCall.phase) {
          case "auction":
            return "Auction running…";
          case "signing":
            return "Sign the order in your wallet…";
          case "executing":
            return "Executing on-chain…";
          default:
            return "Requesting quotes…";
        }
      case "done":
        return "Position Created";
    }
  })();

  const ctaDisabled =
    isPending ||
    step === "done" ||
    (isConnected &&
      step === "select" &&
      (!selectedStrikeData || amountNum <= 0 || amountNum > btcBalance));

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
              onChange={(e) => {
                setSelectedExpiry(Number(e.target.value));
                setSelectedStrike(null);
              }}
              disabled={step !== "select"}
              className="rounded-md border-[0.5px] border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground disabled:opacity-50"
            >
              {expiries.map((e) => (
                <option key={e.epoch} value={e.epoch}>
                  {e.label}
                </option>
              ))}
            </select>

            <div className="flex-1" />

            {spotPrice > 0 && (
              <div className="rounded-md border-[0.5px] border-border bg-background px-3 py-1.5 text-xs text-muted-foreground">
                Spot:{" "}
                <span className="font-semibold text-foreground">
                  ${spotPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
              </div>
            )}

            {isPending && (
              <div className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-accent">
                {STEP_LABEL[step as Exclude<FlowStep, "select" | "done">]}
              </div>
            )}
          </div>

          {/* Done state */}
          {step === "done" && doneInfo ? (
            <div className="py-10 text-center">
              <div className="mb-2 text-lg font-bold tracking-[-0.03em] text-success font-heading">
                Position Created
              </div>
              <div className="mb-1 text-sm text-secondary-foreground">
                Earned{" "}
                <span className="font-semibold text-foreground">
                  $
                  {doneInfo.premium.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}
                </span>{" "}
                premium
              </div>
              <div className="mb-2 text-xs text-muted-foreground">
                {doneInfo.instrumentName} · Subaccount #{subaccountId?.toString()}
              </div>
              <a
                href={explorerTxUrl(doneInfo.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="mb-6 inline-block text-xs text-accent underline-offset-2 hover:underline"
              >
                View transaction on BscScan
              </a>
              <div>
                <button
                  onClick={handleReset}
                  className="rounded-md border-[0.5px] border-border bg-background px-6 py-2.5 text-xs font-medium text-secondary-foreground transition-colors hover:border-secondary-foreground"
                >
                  Create Another Position
                </button>
              </div>
            </div>
          ) : (
            <>
              {isLoading ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  Loading strikes…
                </div>
              ) : spotPrice <= 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  No on-chain spot price — make sure oracle-feeds has posted to
                  the spot feed recently.
                </div>
              ) : (
                <>
                  <div className="mb-1 text-sm text-secondary-foreground">
                    Choose the price at which you are happy to sell{" "}
                    <span className="font-semibold text-foreground">BTC</span> on{" "}
                    <span className="font-semibold text-foreground">
                      {selectedExpiryData?.label}
                    </span>{" "}
                    <span className="text-muted-foreground">(in {dte} days)</span>
                  </div>
                  <div className="mb-4 text-[10px] text-muted-foreground">
                    Indicative premiums (Black-76 on the on-chain oracle feeds) —
                    the final price comes from a live RFQ auction
                  </div>
                  <div className="mb-6">
                    <StrikeSelector
                      strikes={strikes}
                      selectedStrike={selectedStrike}
                      onSelect={(s) => {
                        if (step === "select") setSelectedStrike(s);
                      }}
                    />
                  </div>
                </>
              )}

              <div className="mb-5">
                <AmountInput
                  amount={amount}
                  onAmountChange={(v) => {
                    if (step === "select") setAmount(v);
                  }}
                  balance={btcBalance}
                  collateralLabel="BTCB"
                  insufficientBalance={amountNum > btcBalance && btcBalance > 0}
                  step={0.01}
                />
                {isConnected && amountNum > btcBalance && (
                  <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span>Need BTCB?</span>
                    <button
                      onClick={() => mintBtcb.mutate()}
                      disabled={mintBtcb.isPending}
                      className="rounded-md border border-accent/30 bg-accent/10 px-2 py-1 font-semibold text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
                    >
                      {mintBtcb.isPending ? "Adding…" : "Add 1 BTCB"}
                    </button>
                    <a
                      href={TBNB_FAUCET_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent underline-offset-2 hover:underline"
                    >
                      Gas faucet
                    </a>
                  </div>
                )}
              </div>

              {step === "selling" && sellCall.auction && (
                <div className="mb-5">
                  <AuctionPanel
                    endsAt={sellCall.auction.endsAt}
                    quoteCount={sellCall.auction.quoteCount}
                    bestTotalPremium={sellCall.auction.bestTotalPremium}
                  />
                </div>
              )}

              {selectedStrikeData && outcome && amountNum > 0 && (
                <div className="mb-5">
                  <OutcomePreview
                    asset="BTC"
                    strike={selectedStrikeData.strike}
                    apr={selectedStrikeData.apr}
                    outcome={outcome}
                    expiryLabel={selectedExpiryData?.label || ""}
                    strategyType="covered_call"
                    collateralLabel="BTCB"
                  />
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
            collateralLabel="BTCB"
            apr={selectedStrikeData?.apr ?? 0}
          />
        </div>
      </div>
    </div>
  );
}
