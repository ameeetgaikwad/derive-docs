"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  DollarSign,
  MoveRight,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "wagmi";
import AsideCard, {
  AsideContent,
  AsideHeader,
  AsideTitle,
} from "@/components/shared/aside-card";
import { CurrencyField } from "@/components/shared/currency-field";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Text } from "@/components/ui/text";
import { TokenIcon } from "@/components/ui/TokenIcon";
import {
  useCoveredCallSubaccount,
  useDepositBtcb,
} from "@/hooks/protocol/useCoveredCallSubaccount";
import {
  useAvailableStrikes,
  type StrikeOption,
} from "@/hooks/protocol/useAvailableStrikes";
import { useBtcbBalance } from "@/hooks/protocol/useBtcb";
import { usePositionMonitor } from "@/hooks/protocol/usePositionMonitor";
import { useSellCall } from "@/hooks/protocol/useSellCall";
import { explorerTxUrl } from "@/lib/protocol/deployments";
import { toUnit } from "@/lib/protocol/units";
import { cn } from "@/lib/utils";
import { useCoveredCallStore } from "@/stores/covered-call";

type TargetMode = "buy_low" | "sell_high";
type FlowStep = "select" | "subaccount" | "deposit" | "selling" | "done";
type ComposerView = "compose" | "review";

type ModeCopy = {
  title: string;
  plainTitle: string;
  shortLabel: string;
  description: string;
  amountLabel: string;
  amountPrefix: string;
  amountSuffix: string;
  targetLabel: string;
  metricAmountLabel: string;
  effectivePriceLabel: string;
  reviewTitle: string;
  hitTitle: string;
  missTitle: string;
};

type SummaryData = {
  mode: TargetMode;
  amount: number;
  strike: StrikeOption;
  expiryLabelText: string;
  rewardUsd: number;
  effectivePrice: number;
  contracts: number;
  spotPrice: number;
  capitalUsd: number;
  targetDistance: number;
};

const MODE_COPY: Record<TargetMode, ModeCopy> = {
  buy_low: {
    title: "Buy BTC cheaper",
    plainTitle: "Buy cheaper",
    shortLabel: "Buy lower",
    description:
      "Reserve cash at the price you already want. If BTC trades down to your target, you buy. If it does not, you keep the reward.",
    amountLabel: "How much cash do you want to reserve?",
    amountPrefix: "$",
    amountSuffix: "USDC",
    targetLabel: "Buy target",
    metricAmountLabel: "BTC if filled",
    effectivePriceLabel: "Effective buy price",
    reviewTitle: "Review buy target",
    hitTitle: "If BTC reaches your buy price",
    missTitle: "If BTC stays above your price",
  },
  sell_high: {
    title: "Sell BTC higher",
    plainTitle: "Sell higher",
    shortLabel: "Sell higher",
    description:
      "Put a BTC slice to work at a higher price. If BTC reaches your target, that slice sells. If it does not, you keep the BTC and the reward.",
    amountLabel: "How much BTC would you sell higher?",
    amountPrefix: "",
    amountSuffix: "BTCB",
    targetLabel: "Sell target",
    metricAmountLabel: "BTC committed",
    effectivePriceLabel: "Effective sell price",
    reviewTitle: "Review sell target",
    hitTitle: "If BTC reaches your sell price",
    missTitle: "If BTC stays below your price",
  },
};

const DEFAULT_AMOUNT: Record<TargetMode, string> = {
  buy_low: "1000",
  sell_high: "0.05",
};

const STEP_LABEL: Record<Exclude<FlowStep, "select" | "done">, string> = {
  subaccount: "Creating target account",
  deposit: "Depositing test BTCB",
  selling: "Getting market quotes",
};

function formatUsd(value: number, maximumFractionDigits = 0): string {
  if (!Number.isFinite(value)) return "$0";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits,
  });
}

function formatBtc(value: number, maximumFractionDigits = 6): string {
  if (!Number.isFinite(value)) return "0 BTC";
  return `${value.toLocaleString("en-US", {
    maximumFractionDigits,
    minimumFractionDigits: value > 0 && value < 0.01 ? 6 : 0,
  })} BTC`;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function sanitizeDecimal(value: string): string {
  const normalized = value.replace(/[^\d.]/g, "");
  const [head, ...tail] = normalized.split(".");
  return tail.length > 0 ? `${head}.${tail.join("")}` : head;
}

function expiryLabel(epoch: number | null): string {
  if (!epoch) return "Next Friday";
  return new Date(epoch * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function LoanComposer({
  variant = "landing",
  onReviewModeChange,
}: {
  variant?: "landing" | "borrow";
  onReviewModeChange?: (reviewMode: boolean) => void;
}) {
  const { isConnected, address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const [view, setView] = useState<ComposerView>("compose");
  const [mode, setMode] = useState<TargetMode>("buy_low");
  const [amount, setAmount] = useState(DEFAULT_AMOUNT.buy_low);
  const [selectedExpiry, setSelectedExpiry] = useState<number | null>(null);
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [step, setStep] = useState<FlowStep>("select");
  const [doneInfo, setDoneInfo] = useState<{
    premium: number;
    txHash?: string;
    instrumentName: string;
    simulated?: boolean;
  } | null>(null);

  const {
    expiries,
    selectedExpiry: activeExpiry,
    strikes,
    spotPrice,
    isLoading,
  } = useAvailableStrikes(selectedExpiry, mode);
  const { subaccountId, ensureSubaccount } = useCoveredCallSubaccount();
  const depositBtcb = useDepositBtcb();
  const sellCall = useSellCall();
  const { balanceNumber: walletBtcb, refetch: refetchBtcb } = useBtcbBalance();
  const { balances: subBalances, refetch: refetchPositions } =
    usePositionMonitor(subaccountId);
  const { addTrade } = useCoveredCallStore();

  const subBtcb = subBalances.btcb;
  const btcBalance = walletBtcb + subBtcb;
  const amountNum = parseFloat(amount) || 0;
  const activeStrike = strikes.some((strike) => strike.strike === selectedStrike)
    ? selectedStrike
    : strikes[0]?.strike ?? null;
  const selectedStrikeData =
    strikes.find((strike) => strike.strike === activeStrike) ?? null;
  const selectedExpiryData =
    expiries.find((expiry) => expiry.epoch === activeExpiry) ?? null;
  const isBuy = mode === "buy_low";
  const copy = MODE_COPY[mode];
  const contracts =
    selectedStrikeData && amountNum > 0
      ? isBuy
        ? amountNum / selectedStrikeData.strike
        : amountNum
      : 0;
  const rewardUsd = selectedStrikeData
    ? selectedStrikeData.premium * contracts
    : 0;
  const effectivePrice = selectedStrikeData
    ? isBuy
      ? selectedStrikeData.strike - selectedStrikeData.premium
      : selectedStrikeData.strike + selectedStrikeData.premium
    : 0;
  const capitalUsd = isBuy ? amountNum : amountNum * spotPrice;
  const targetDistance =
    selectedStrikeData && spotPrice > 0
      ? Math.abs(selectedStrikeData.strike - spotPrice) / spotPrice
      : 0;
  const isPending = step !== "select" && step !== "done";
  const ctaDisabled = !selectedStrikeData || amountNum <= 0 || isPending;
  const summary: SummaryData | null = useMemo(
    () =>
      selectedStrikeData
        ? {
            mode,
            amount: amountNum,
            strike: selectedStrikeData,
            expiryLabelText: expiryLabel(selectedExpiryData?.epoch ?? activeExpiry),
            rewardUsd,
            effectivePrice,
            contracts,
            spotPrice,
            capitalUsd,
            targetDistance,
          }
        : null,
    [
      activeExpiry,
      amountNum,
      capitalUsd,
      contracts,
      effectivePrice,
      mode,
      rewardUsd,
      selectedExpiryData?.epoch,
      selectedStrikeData,
      spotPrice,
      targetDistance,
    ],
  );

  const setComposerView = useCallback(
    (nextView: ComposerView) => {
      setView(nextView);
      onReviewModeChange?.(nextView === "review");
    },
    [onReviewModeChange],
  );

  const switchMode = useCallback(
    (nextMode: TargetMode) => {
      setMode(nextMode);
      setAmount(DEFAULT_AMOUNT[nextMode]);
      setSelectedStrike(null);
      setDoneInfo(null);
      setComposerView("compose");
    },
    [setComposerView],
  );

  const handleContinue = useCallback(() => {
    if (!summary || ctaDisabled) return;
    setComposerView("review");
    window.setTimeout(() => {
      document
        .getElementById("composer")
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 0);
  }, [ctaDisabled, setComposerView, summary]);

  const handleBackToCompose = useCallback(() => {
    setComposerView("compose");
  }, [setComposerView]);

  const handleConfirmSellTarget = useCallback(async () => {
    if (!selectedStrikeData || amountNum <= 0) return;
    if (!isConnected || !address) {
      openConnectModal?.();
      return;
    }
    if (amountNum > btcBalance) {
      toast.error("Not enough test BTCB for this sell target");
      return;
    }

    try {
      setStep("subaccount");
      const subId = await ensureSubaccount();

      const deficit = amountNum - subBtcb;
      if (deficit > 0) {
        setStep("deposit");
        await depositBtcb(subId, toUnit(deficit.toFixed(18)));
        refetchBtcb();
      }

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
        `Sell target created. Estimated reward ${formatUsd(result.totalPremium, 2)}`,
      );
      setStep("done");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(message);
      setStep("select");
    }
  }, [
    selectedStrikeData,
    amountNum,
    isConnected,
    address,
    openConnectModal,
    btcBalance,
    ensureSubaccount,
    subBtcb,
    depositBtcb,
    refetchBtcb,
    sellCall,
    addTrade,
    refetchPositions,
  ]);

  const handleConfirmReview = useCallback(() => {
    if (!selectedStrikeData || amountNum <= 0) return;
    if (mode === "buy_low") {
      setDoneInfo({
        premium: rewardUsd,
        instrumentName: selectedStrikeData.instrumentName,
        simulated: true,
      });
      toast.success("Buy target preview saved");
      setComposerView("compose");
      return;
    }
    void handleConfirmSellTarget();
  }, [
    amountNum,
    handleConfirmSellTarget,
    mode,
    rewardUsd,
    selectedStrikeData,
    setComposerView,
  ]);

  const progressLabel = (() => {
    if (step === "select" || step === "done") return null;
    if (step !== "selling") return STEP_LABEL[step];
    switch (sellCall.phase) {
      case "auction":
        return "Collecting quotes";
      case "signing":
        return "Waiting for wallet signature";
      case "executing":
        return "Creating target";
      default:
        return "Requesting quotes";
    }
  })();

  if (view === "review" && summary) {
    return (
      <div className="grid w-full gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(390px,520px)] lg:items-start lg:gap-[64px]">
        <TargetOfferCard
          summary={summary}
          doneInfo={doneInfo}
          isConnected={isConnected}
          onBack={handleBackToCompose}
          onConfirm={handleConfirmReview}
          isPending={isPending}
        />
        <ComposerCard
          variant={variant}
          mode={mode}
          copy={copy}
          amount={amount}
          setAmount={setAmount}
          switchMode={switchMode}
          activeExpiry={activeExpiry}
          expiries={expiries}
          setSelectedExpiry={setSelectedExpiry}
          strikes={strikes}
          activeStrike={activeStrike}
          setSelectedStrike={setSelectedStrike}
          selectedStrikeData={selectedStrikeData}
          isBuy={isBuy}
          contracts={contracts}
          capitalUsd={capitalUsd}
          rewardUsd={rewardUsd}
          spotPrice={spotPrice}
          targetDistance={targetDistance}
          isLoading={isLoading}
          isPending={isPending}
          doneInfo={doneInfo}
          progressLabel={progressLabel}
          auction={sellCall.auction}
          ctaDisabled={ctaDisabled}
          onContinue={handleContinue}
          compact
        />
      </div>
    );
  }

  return (
    <ComposerCard
      variant={variant}
      mode={mode}
      copy={copy}
      amount={amount}
      setAmount={setAmount}
      switchMode={switchMode}
      activeExpiry={activeExpiry}
      expiries={expiries}
      setSelectedExpiry={setSelectedExpiry}
      strikes={strikes}
      activeStrike={activeStrike}
      setSelectedStrike={setSelectedStrike}
      selectedStrikeData={selectedStrikeData}
      isBuy={isBuy}
      contracts={contracts}
      capitalUsd={capitalUsd}
      rewardUsd={rewardUsd}
      spotPrice={spotPrice}
      targetDistance={targetDistance}
      isLoading={isLoading}
      isPending={isPending}
      doneInfo={doneInfo}
      progressLabel={progressLabel}
      auction={sellCall.auction}
      ctaDisabled={ctaDisabled}
      onContinue={handleContinue}
    />
  );
}

function ComposerCard({
  variant,
  mode,
  copy,
  amount,
  setAmount,
  switchMode,
  activeExpiry,
  expiries,
  setSelectedExpiry,
  strikes,
  activeStrike,
  setSelectedStrike,
  selectedStrikeData,
  isBuy,
  contracts,
  capitalUsd,
  rewardUsd,
  spotPrice,
  targetDistance,
  isLoading,
  isPending,
  doneInfo,
  progressLabel,
  auction,
  ctaDisabled,
  onContinue,
  compact = false,
}: {
  variant: "landing" | "borrow";
  mode: TargetMode;
  copy: ModeCopy;
  amount: string;
  setAmount: (amount: string) => void;
  switchMode: (mode: TargetMode) => void;
  activeExpiry: number | null;
  expiries: Array<{ epoch: number; label: string }>;
  setSelectedExpiry: (expiry: number) => void;
  strikes: StrikeOption[];
  activeStrike: number | null;
  setSelectedStrike: (strike: number) => void;
  selectedStrikeData: StrikeOption | null;
  isBuy: boolean;
  contracts: number;
  capitalUsd: number;
  rewardUsd: number;
  spotPrice: number;
  targetDistance: number;
  isLoading: boolean;
  isPending: boolean;
  doneInfo: {
    premium: number;
    txHash?: string;
    instrumentName: string;
    simulated?: boolean;
  } | null;
  progressLabel: string | null;
  auction: {
    endsAt: number;
    quoteCount: number;
    bestTotalPremium: number | null;
  } | null;
  ctaDisabled: boolean;
  onContinue: () => void;
  compact?: boolean;
}) {
  const fieldSubtitle = selectedStrikeData
    ? isBuy
      ? `You receive about ${formatBtc(contracts)} if filled`
      : `About ${formatUsd(capitalUsd)} notional at today's spot`
    : undefined;

  return (
    <AsideCard className="relative z-10 min-w-0 overflow-visible rounded-lg border-[0.5px] border-zinc-200 bg-white shadow-[0_0_30px_0_rgba(0,0,0,0.05)]">
      <AsideHeader className="min-h-14 rounded-t-lg bg-zinc-100 px-5 py-4 pr-[1.875rem]">
        <AsideTitle>{variant === "landing" ? "Target Composer" : "Hedge Composer"}</AsideTitle>
        <LiveIndicator isFetching={isLoading || isPending} />
      </AsideHeader>

      <AsideContent className={cn("p-5 sm:p-6", compact ? "lg:p-6" : "lg:p-[1.875rem]")}>
        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Text as="h2" variant="h4" className="text-zinc-950">
              {copy.title}
            </Text>
            <ModeToggle mode={mode} onChange={switchMode} />
          </div>

          <CurrencyField size="large">
            <CurrencyField.Label>{copy.amountLabel}</CurrencyField.Label>
            <CurrencyField.Control
              value={amount}
              onChange={(value) => setAmount(sanitizeDecimal(value))}
              prefix={copy.amountPrefix}
              subtitle={fieldSubtitle}
              trailing={
                <CurrencyBadge symbol={isBuy ? "USDC" : "BTC"} label={copy.amountSuffix} />
              }
            />
          </CurrencyField>

          <div>
            <div className="mb-3 flex items-center justify-between gap-4">
              <Text variant="subheading-1" className="text-zinc-800">
                {copy.targetLabel}
              </Text>
              <span
                className={cn(
                  "rounded-sm px-2.5 py-1 font-mono text-xs",
                  targetDistance <= 0.05
                    ? "bg-green-50 text-green-600"
                    : "bg-orange-50 text-orange-600",
                )}
              >
                {formatPercent(targetDistance * 100)} from spot
              </span>
            </div>
            <TargetRail
              strikes={strikes}
              selectedStrike={activeStrike}
              onSelect={setSelectedStrike}
              mode={mode}
            />
          </div>

          <ExpirySelect
            activeExpiry={activeExpiry}
            expiries={expiries}
            onChange={setSelectedExpiry}
          />

          {auction && isPending && (
            <AuctionStatus
              endsAt={auction.endsAt}
              quoteCount={auction.quoteCount}
              bestTotalPremium={auction.bestTotalPremium ?? undefined}
            />
          )}

          {progressLabel && (
            <Text variant="body-small" className="text-zinc-500">
              {progressLabel}
            </Text>
          )}

          <div className="flex w-full min-w-0 flex-col">
            <Separator />
            <div className="flex w-full min-w-0 flex-col gap-5 pt-5 sm:flex-row sm:items-center sm:gap-[1.875rem] lg:pt-[1.875rem]">
              <Button
                type="button"
                action
                disabled={ctaDisabled}
                onClick={onContinue}
                className="min-h-10 px-5"
              >
                {isPending ? "Working..." : "Continue"}
              </Button>
              <Separator orientation="vertical" className="hidden sm:block" />
              <div className="grid min-w-0 flex-1 grid-cols-3 gap-4">
                <FooterMetric
                  label="Reward"
                  value={
                    doneInfo
                      ? formatUsd(doneInfo.premium, 2)
                      : selectedStrikeData
                        ? formatUsd(rewardUsd, 2)
                        : "-"
                  }
                />
                <FooterMetric
                  label="Target"
                  value={
                    selectedStrikeData ? formatUsd(selectedStrikeData.strike) : "-"
                  }
                />
                <FooterMetric label="BTC Spot" value={formatUsd(spotPrice)} />
              </div>
            </div>
          </div>
        </div>
      </AsideContent>
    </AsideCard>
  );
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: TargetMode;
  onChange: (mode: TargetMode) => void;
}) {
  return (
    <div className="grid h-9 grid-cols-2 overflow-hidden rounded-[5px] bg-zinc-100 p-0.5">
      {(["buy_low", "sell_high"] as const).map((item) => {
        const active = mode === item;
        return (
          <button
            key={item}
            type="button"
            onClick={() => onChange(item)}
            className={cn(
              "px-3 font-mono text-xs transition-colors",
              active
                ? "rounded-[4px] bg-zinc-950 text-white"
                : "text-zinc-500 hover:text-zinc-950",
            )}
          >
            {MODE_COPY[item].shortLabel}
          </button>
        );
      })}
    </div>
  );
}

function CurrencyBadge({
  symbol,
  label,
}: {
  symbol: string;
  label: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 rounded-[5px] p-1">
      <TokenIcon symbol={symbol} size={28} />
      <Text as="span" variant="body-default" className="text-foreground">
        {label}
      </Text>
    </div>
  );
}

function ExpirySelect({
  activeExpiry,
  expiries,
  onChange,
}: {
  activeExpiry: number | null;
  expiries: Array<{ epoch: number; label: string }>;
  onChange: (expiry: number) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const activeOption =
    expiries.find((expiry) => expiry.epoch === activeExpiry) ?? expiries[0] ?? null;

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleSelect = (expiry: number) => {
    onChange(expiry);
    setIsOpen(false);
  };

  return (
    <div ref={rootRef} className="relative flex flex-col gap-2">
      <Text id="expiry-label" variant="body-small" className="text-zinc-500">
        Expiry
      </Text>
      <button
        type="button"
        aria-controls="expiry-menu"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-labelledby="expiry-label"
        disabled={expiries.length === 0}
        onClick={() => setIsOpen((open) => !open)}
        className="relative flex h-11 w-full items-center rounded-[5px] border-[0.5px] border-zinc-200 bg-white pl-10 pr-10 font-mono text-sm text-zinc-800 shadow-[0_1px_0_rgba(9,9,11,0.02)] transition-colors hover:bg-zinc-50 focus-visible:border-zinc-300 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
        <span className="truncate">
          {activeOption?.label ?? "Select expiry"}
        </span>
        <ChevronDown
          className={cn(
            "pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500 transition-transform",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {isOpen && (
        <div
          id="expiry-menu"
          role="listbox"
          aria-labelledby="expiry-label"
          className="absolute top-full left-0 z-[100] mt-2 max-h-56 w-full overflow-auto rounded-[5px] border-[0.5px] border-zinc-200 bg-white p-1 shadow-[0_16px_40px_rgba(9,9,11,0.12)]"
        >
          {expiries.map((expiry) => {
            const selected = expiry.epoch === activeOption?.epoch;
            return (
              <button
                key={expiry.epoch}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => handleSelect(expiry.epoch)}
                className={cn(
                  "flex h-9 w-full items-center justify-between rounded-[4px] px-3 font-mono text-sm transition-colors",
                  selected
                    ? "bg-zinc-950 text-white"
                    : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950",
                )}
              >
                <span>{expiry.label}</span>
                <Check
                  className={cn(
                    "size-3.5",
                    selected ? "opacity-100" : "opacity-0",
                  )}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TargetRail({
  strikes,
  selectedStrike,
  onSelect,
  mode,
}: {
  strikes: StrikeOption[];
  selectedStrike: number | null;
  onSelect: (strike: number) => void;
  mode: TargetMode;
}) {
  if (strikes.length === 0) {
    return (
      <div className="rounded-[5px] bg-zinc-50 p-4">
        <Text variant="body-small" className="text-zinc-500">
          No targets are available for this expiry yet.
        </Text>
      </div>
    );
  }

  const visibleStrikes = strikes.slice(0, 4);
  const selectedIndex = Math.max(
    0,
    visibleStrikes.findIndex((strike) => strike.strike === selectedStrike),
  );
  const selected = visibleStrikes[selectedIndex] ?? visibleStrikes[0];
  const progress =
    visibleStrikes.length === 1
      ? 0
      : (selectedIndex / (visibleStrikes.length - 1)) * 100;
  const sliderStyle = {
    "--hedge-slider-progress": `${progress}%`,
    "--hedge-slider-start": mode === "buy_low" ? "#16a34a" : "#fed7aa",
    "--hedge-slider-end": mode === "buy_low" ? "#fed7aa" : "#16a34a",
  } as CSSProperties;
  const handleSliderValue = (rawValue: string) => {
    const next = visibleStrikes[Number(rawValue)];
    if (next) onSelect(next.strike);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 rounded-[5px] bg-zinc-50 px-4 py-3">
        <div>
          <Text variant="body-small" className="text-zinc-500">
            Selected target
          </Text>
          <Text as="p" variant="h4" className="mt-1 text-zinc-950">
            {formatUsd(selected.strike)}
          </Text>
        </div>
        <Text variant="body-small" className="text-zinc-500">
          Premium: {formatUsd(selected.premium, selected.premium >= 100 ? 0 : 2)}/BTC
        </Text>
      </div>
      <input
        aria-label="Select target price"
        className="hedge-target-slider"
        min={0}
        max={visibleStrikes.length - 1}
        step={1}
        type="range"
        value={selectedIndex}
        onInput={(event) => handleSliderValue(event.currentTarget.value)}
        onChange={(event) => handleSliderValue(event.currentTarget.value)}
        style={sliderStyle}
      />
      <div className="flex items-center justify-between gap-3">
        <Text variant="body-small" className="text-zinc-400">
          {formatUsd(visibleStrikes[0]?.strike ?? 0)}
        </Text>
        <Text variant="body-small" className="text-zinc-500">
          {visibleStrikes.length} live targets
        </Text>
        <Text variant="body-small" className="text-zinc-400">
          {formatUsd(visibleStrikes[visibleStrikes.length - 1]?.strike ?? 0)}
        </Text>
      </div>
    </div>
  );
}

function FooterMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text variant="terminal-small" className="text-zinc-500">
        {label}
      </Text>
      <Text variant="body-small" className="mt-1 text-zinc-950">
        {value}
      </Text>
    </div>
  );
}

function LiveIndicator({
  isFetching,
}: {
  isFetching: boolean;
}) {
  return (
    <div className="flex items-center gap-2 font-mono text-xs text-zinc-700">
      <span className="relative flex size-2">
        <span
          className={cn(
            "absolute inset-0 rounded-full bg-green-500",
            isFetching && "motion-safe:animate-ping",
          )}
        />
        <span className="relative size-2 rounded-full bg-green-500" />
      </span>
      Live - 20s
    </div>
  );
}

function AuctionStatus({
  endsAt,
  quoteCount,
  bestTotalPremium,
}: {
  endsAt: number;
  quoteCount: number;
  bestTotalPremium?: number;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const secondsLeft = Math.max(0, Math.ceil((endsAt - now) / 1000));
  return (
    <div className="rounded-[5px] border-[0.5px] border-orange-200 bg-orange-50 p-4">
      <div className="flex items-center gap-2 text-orange-700">
        <MoveRight className="size-4" />
        <Text variant="body-small" className="text-orange-700">
          Collecting quotes: {quoteCount} received, {secondsLeft}s left
        </Text>
      </div>
      {bestTotalPremium !== undefined && (
        <Text variant="terminal-small" className="mt-2 text-orange-700">
          Best reward so far: {formatUsd(bestTotalPremium, 2)}
        </Text>
      )}
    </div>
  );
}

function TargetOfferCard({
  summary,
  doneInfo,
  isConnected,
  onBack,
  onConfirm,
  isPending,
}: {
  summary: SummaryData;
  doneInfo: {
    premium: number;
    txHash?: string;
    instrumentName: string;
    simulated?: boolean;
  } | null;
  isConnected: boolean;
  onBack: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  const isBuy = summary.mode === "buy_low";
  const copy = MODE_COPY[summary.mode];
  const DirectionIcon = isBuy ? TrendingDown : TrendingUp;

  return (
    <section className="overflow-hidden rounded-lg border-[0.5px] border-zinc-200 bg-white shadow-[0_0_30px_0_rgba(0,0,0,0.05)]">
      <div className="flex items-center justify-between gap-4 border-b-[0.5px] border-zinc-200 bg-zinc-100 px-5 py-4 pr-[1.875rem]">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 font-mono text-xs text-zinc-500 transition-colors hover:text-zinc-950"
        >
          <ArrowLeft className="size-3.5" />
          Back
        </button>
        <div className="inline-flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-1.5 font-mono text-xs text-zinc-700">
          <DirectionIcon className="size-3.5" />
          {copy.plainTitle}
        </div>
      </div>

      <div className="p-6 sm:p-8">
        <Text as="h2" variant="h3" className="text-zinc-950">
          {copy.reviewTitle}
        </Text>
        <Text variant="body-large" className="mt-3 max-w-[620px] text-zinc-500">
          {copy.description}
        </Text>

        <div className="mt-8 grid gap-x-12 gap-y-7 border-y-[0.5px] border-zinc-200 py-6 sm:grid-cols-2 lg:grid-cols-3">
          <SummaryLine
          icon={<DollarSign className="size-4" />}
          label="Estimated reward"
          value={formatUsd(summary.rewardUsd, 2)}
          />
          <SummaryLine
          icon={<Target className="size-4" />}
          label={copy.targetLabel}
          value={formatUsd(summary.strike.strike)}
          />
          <SummaryLine
          icon={<CalendarDays className="size-4" />}
          label="Expiry"
          value={summary.expiryLabelText}
          />
          <SummaryLine
          icon={<DirectionIcon className="size-4" />}
          label={isBuy ? "Cash reserved" : "BTC committed"}
          value={isBuy ? formatUsd(summary.amount) : formatBtc(summary.amount)}
          />
          <SummaryLine
          icon={<CheckCircle2 className="size-4" />}
          label={copy.effectivePriceLabel}
          value={`${formatUsd(summary.effectivePrice)}/BTC`}
          />
          <SummaryLine
            icon={<TokenIcon symbol={isBuy ? "USDC" : "BTC"} size={18} />}
            label={copy.metricAmountLabel}
            value={formatBtc(summary.contracts)}
          />
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <OutcomeBlock
          icon={<Target className="size-4" />}
          title={copy.hitTitle}
          text={
            isBuy
              ? `You reserve ${formatUsd(summary.amount)} and buy about ${formatBtc(summary.contracts)} at ${formatUsd(summary.strike.strike)}. The reward lowers your effective entry to about ${formatUsd(summary.effectivePrice)}/BTC.`
              : `The ${formatBtc(summary.amount)} slice sells at ${formatUsd(summary.strike.strike)}. Including the reward, the effective exit is about ${formatUsd(summary.effectivePrice)}/BTC.`
          }
          />
          <OutcomeBlock
          icon={<CheckCircle2 className="size-4" />}
          title={copy.missTitle}
          text={
            isBuy
              ? `No BTC is bought. Your ${formatUsd(summary.amount)} stays available and you keep the estimated ${formatUsd(summary.rewardUsd, 2)} reward.`
              : `You keep the ${formatBtc(summary.amount)} and the estimated ${formatUsd(summary.rewardUsd, 2)} reward. Anything outside this slice stays uncapped.`
          }
          />
        </div>

        <div className="mt-8 flex items-start gap-3 border-t-[0.5px] border-zinc-200 pt-5">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600" />
          <Text variant="body-small" className="text-zinc-700">
            BTC spot is {formatUsd(summary.spotPrice)}. This target is{" "}
            {formatPercent(summary.targetDistance * 100)} from spot and the reward
            is shown before signing.
          </Text>
        </div>

        {isBuy && (
          <Text variant="body-small" className="mt-4 text-zinc-500">
            Buy targets are priced in this prototype. Live USDC reservation and
            put-side matching still need to be wired before this can execute onchain.
          </Text>
        )}

        {doneInfo?.txHash && (
          <a
            href={explorerTxUrl(doneInfo.txHash)}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center gap-1 font-mono text-xs text-orange-600"
          >
            View transaction <ArrowUpRight className="size-3" />
          </a>
        )}
      </div>

      <div className="flex flex-col gap-4 border-t-[0.5px] border-zinc-200 bg-white/90 px-6 py-5 backdrop-blur-[2.5px] sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <Text variant="body-small" className="text-zinc-500">
          {doneInfo
            ? doneInfo.simulated
              ? "Preview saved"
              : "Target created"
            : `Reward: ${formatUsd(summary.rewardUsd, 2)}`}
        </Text>
        <Button type="button" action onClick={onConfirm} disabled={isPending}>
          {isPending
            ? "Working..."
            : isBuy
              ? "Save target preview"
              : isConnected
                ? "Create target"
                : "Connect wallet"}
        </Button>
      </div>
    </section>
  );
}

function SummaryLine({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center text-zinc-500">
        {icon}
      </div>
      <div className="min-w-0">
        <Text variant="terminal-small" className="text-zinc-500">
          {label}
        </Text>
        <Text variant="h5" className="mt-1 min-w-0 text-zinc-950">
          {value}
        </Text>
      </div>
    </div>
  );
}

function OutcomeBlock({
  icon,
  title,
  text,
}: {
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="flex items-start gap-4">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-700">
        {icon}
      </div>
      <div>
        <Text variant="h5" className="text-zinc-950">
          {title}
        </Text>
        <Text variant="body-small" className="mt-2 text-zinc-600">
          {text}
        </Text>
      </div>
    </div>
  );
}
