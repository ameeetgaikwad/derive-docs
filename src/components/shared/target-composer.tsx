"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
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
import {
  useBitcoinPriceHistory,
  type BitcoinPriceHistoryPoint,
} from "@/hooks/useBitcoinPrice";
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
  amountLabel: string;
  amountPrefix: string;
  amountSuffix: string;
  targetLabel: string;
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
  apr: number;
  effectivePrice: number;
  contracts: number;
  spotPrice: number;
  capitalUsd: number;
};

const MODE_COPY: Record<TargetMode, ModeCopy> = {
  buy_low: {
    title: "Buy BTC cheaper",
    plainTitle: "Buy cheaper",
    shortLabel: "Buy lower",
    amountLabel: "How much cash would you set aside?",
    amountPrefix: "$",
    amountSuffix: "USDC",
    targetLabel: "Buy strike",
    effectivePriceLabel: "Effective entry",
    reviewTitle: "Review cash-secured put",
    hitTitle: "If BTC settles below your strike",
    missTitle: "If BTC stays above your strike",
  },
  sell_high: {
    title: "Sell BTC higher",
    plainTitle: "Sell higher",
    shortLabel: "Sell higher",
    amountLabel: "How much BTC would you sell higher?",
    amountPrefix: "",
    amountSuffix: "BTCB",
    targetLabel: "Sell strike",
    effectivePriceLabel: "Effective exit",
    reviewTitle: "Review covered call",
    hitTitle: "If BTC settles above your strike",
    missTitle: "If BTC stays below your strike",
  },
};

const DEFAULT_AMOUNT: Record<TargetMode, string> = {
  buy_low: "1000",
  sell_high: "0.05",
};
const INITIAL_MODE: TargetMode = "sell_high";

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

function formatChartTime(epochSeconds: number): string {
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return "Today";

  return new Date(epochSeconds * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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

function dteLabel(epoch: number | null): string {
  if (!epoch) return "- DTE";

  const days = Math.max(
    0,
    Math.ceil((epoch * 1000 - Date.now()) / (24 * 60 * 60 * 1000)),
  );

  return `${days} DTE`;
}

export default function TargetComposer({
  variant = "landing",
  onReviewModeChange,
}: {
  variant?: "landing" | "borrow";
  onReviewModeChange?: (reviewMode: boolean) => void;
}) {
  const { isConnected, address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const [view, setView] = useState<ComposerView>("compose");
  const [mode, setMode] = useState<TargetMode>(INITIAL_MODE);
  const [amount, setAmount] = useState(DEFAULT_AMOUNT[INITIAL_MODE]);
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
    isLiveSpotFetching,
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
            apr: selectedStrikeData.apr,
            effectivePrice,
            contracts,
            spotPrice,
            capitalUsd,
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
    },
    [],
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
        `Covered call created. Estimated premium ${formatUsd(result.totalPremium, 2)}`,
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
      toast.success("Buy target saved");
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
          isLiveSpotFetching={isLiveSpotFetching}
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
      isLiveSpotFetching={isLiveSpotFetching}
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
  isLiveSpotFetching,
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
  isLiveSpotFetching: boolean;
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
      ? `Up to ${formatBtc(contracts)} if the order fills`
      : `About ${formatUsd(capitalUsd)} at the current BTC price`
    : undefined;

  return (
    <AsideCard className="relative z-10 min-w-0 overflow-visible rounded-lg border-[0.5px] border-zinc-200 bg-white shadow-[0_0_30px_0_rgba(0,0,0,0.05)]">
      <AsideHeader className="min-h-14 rounded-t-lg bg-zinc-100 px-5 py-4 pr-[1.875rem]">
        <AsideTitle>{variant === "landing" ? "Target Composer" : "Hedge Composer"}</AsideTitle>
        <LiveIndicator isFetching={isLoading || isPending || isLiveSpotFetching} />
      </AsideHeader>

      <AsideContent className={cn("p-5 sm:p-6", compact ? "lg:p-6" : "lg:p-[1.875rem]")}>
        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Text as="h2" variant="h4" className="text-zinc-950">
              {copy.title}
            </Text>
            <ModeToggle mode={mode} onChange={switchMode} />
          </div>

          <ExpiryOptions
            activeExpiry={activeExpiry}
            expiries={expiries}
            onChange={setSelectedExpiry}
          />

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

          <StrikeSelect
            label={copy.targetLabel}
            strikes={strikes}
            selectedStrike={activeStrike}
            selectedStrikeData={selectedStrikeData}
            onSelect={setSelectedStrike}
            targetDistance={targetDistance}
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
                  label="Premium"
                  value={
                    doneInfo
                      ? formatUsd(doneInfo.premium, 2)
                      : selectedStrikeData
                        ? formatUsd(rewardUsd, 2)
                        : "-"
                  }
                />
                <FooterMetric
                  label="Strike"
                  value={
                    selectedStrikeData ? formatUsd(selectedStrikeData.strike) : "-"
                  }
                />
                <FooterMetric label="BTC spot" value={formatUsd(spotPrice)} />
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

function ExpiryOptions({
  activeExpiry,
  expiries,
  onChange,
}: {
  activeExpiry: number | null;
  expiries: Array<{ epoch: number; label: string }>;
  onChange: (expiry: number) => void;
}) {
  const activeOption =
    expiries.find((expiry) => expiry.epoch === activeExpiry) ?? expiries[0] ?? null;

  return (
    <div className="flex flex-col gap-2">
      <Text variant="body-small" className="text-zinc-500">
        Expiry
      </Text>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {expiries.map((expiry) => {
          const selected = expiry.epoch === activeOption?.epoch;

          return (
            <button
              key={expiry.epoch}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(expiry.epoch)}
              className={cn(
                "min-h-[68px] rounded-[5px] border-[0.5px] px-3 py-2 text-left transition-colors",
                selected
                  ? "border-orange-500 bg-orange-50 text-orange-700"
                  : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400",
              )}
            >
              <span className="block font-mono text-xs font-medium">
                {expiry.label}
              </span>
              <span className="mt-1 block font-mono text-[11px] text-zinc-500">
                {dteLabel(expiry.epoch)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StrikeSelect({
  label,
  strikes,
  selectedStrike,
  selectedStrikeData,
  onSelect,
  targetDistance,
}: {
  label: string;
  strikes: StrikeOption[];
  selectedStrike: number | null;
  selectedStrikeData: StrikeOption | null;
  onSelect: (strike: number) => void;
  targetDistance: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = selectedStrikeData ?? strikes[0] ?? null;

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  if (strikes.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <Text variant="body-small" className="text-zinc-500">
          {label}
        </Text>
        <div className="rounded-[5px] bg-zinc-50 p-4">
          <Text variant="body-small" className="text-zinc-500">
            No strikes are available for this expiry yet.
          </Text>
        </div>
      </div>
    );
  }

  const handleSelect = (strike: number) => {
    onSelect(strike);
    setIsOpen(false);
  };

  return (
    <div ref={rootRef} className="relative flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <Text id="strike-label" variant="body-small" className="text-zinc-500">
          {label}
        </Text>
        <Text variant="terminal-small" className="text-zinc-500">
          {formatPercent(targetDistance * 100)} from spot
        </Text>
      </div>
      <button
        type="button"
        aria-controls="strike-menu"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-labelledby="strike-label"
        onClick={() => setIsOpen((open) => !open)}
        className="relative flex min-h-14 w-full items-center justify-between gap-4 rounded-[5px] border-[0.5px] border-zinc-200 bg-white px-4 py-3 text-left shadow-[0_1px_0_rgba(9,9,11,0.02)] transition-colors hover:bg-zinc-50 focus-visible:border-zinc-300"
      >
        <div className="min-w-0">
          <Text as="span" variant="h5" className="block text-zinc-950">
            {selected ? formatUsd(selected.strike) : "Select strike"}
          </Text>
          {selected && (
            <Text as="span" variant="terminal-small" className="mt-1 block text-zinc-500">
              Premium {formatUsd(selected.premium, selected.premium >= 100 ? 0 : 2)}/BTC
            </Text>
          )}
        </div>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-zinc-500 transition-transform",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {isOpen && (
        <div
          id="strike-menu"
          role="listbox"
          aria-labelledby="strike-label"
          className="absolute top-full left-0 z-[100] mt-2 max-h-64 w-full overflow-auto rounded-[5px] border-[0.5px] border-zinc-200 bg-white p-1 shadow-[0_16px_40px_rgba(9,9,11,0.12)]"
        >
          {strikes.map((strike) => {
            const selectedOption = strike.strike === selectedStrike;

            return (
              <button
                key={strike.instrumentName}
                type="button"
                role="option"
                aria-selected={selectedOption}
                onClick={() => handleSelect(strike.strike)}
                className={cn(
                  "flex min-h-12 w-full items-center justify-between gap-4 rounded-[4px] px-3 py-2 text-left transition-colors",
                  selectedOption
                    ? "bg-zinc-950 text-white"
                    : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950",
                )}
              >
                <span className="min-w-0">
                  <span className="block font-mono text-sm">
                    {formatUsd(strike.strike)}
                  </span>
                  <span
                    className={cn(
                      "mt-0.5 block font-mono text-xs",
                      selectedOption ? "text-zinc-300" : "text-zinc-500",
                    )}
                  >
                    {formatUsd(strike.premium, strike.premium >= 100 ? 0 : 2)}/BTC
                  </span>
                </span>
                <Check
                  className={cn(
                    "size-3.5 shrink-0",
                    selectedOption ? "opacity-100" : "opacity-0",
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
      BTC live
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
          Best premium so far: {formatUsd(bestTotalPremium, 2)}
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
  const { data: priceHistory = [] } = useBitcoinPriceHistory();

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

      <div className="px-6 pt-5 pb-6 sm:px-8 sm:pt-6 sm:pb-7">
        <Text as="h2" variant="h3" className="text-zinc-950">
          {copy.reviewTitle}
        </Text>

        <PriceSummaryChart
          chartData={priceHistory}
          spotPrice={summary.spotPrice}
          strikePrice={summary.strike.strike}
        />

        <div className="mt-5 grid gap-x-12 gap-y-7 border-y-[0.5px] border-zinc-200 py-6 sm:grid-cols-2 lg:grid-cols-3">
          <SummaryLine
            icon={<DollarSign className="size-4" />}
            label="Premium (projected)"
            value={formatUsd(summary.rewardUsd, 2)}
          />
          <SummaryLine
            icon={<TrendingUp className="size-4" />}
            label="APR (projected)"
            value={formatPercent(summary.apr)}
          />
          <SummaryLine
            icon={<Target className="size-4" />}
            label="Strike price"
            value={formatUsd(summary.strike.strike)}
          />
          <SummaryLine
            icon={<CalendarDays className="size-4" />}
            label="Expiry"
            value={summary.expiryLabelText}
          />
          <SummaryLine
            icon={<DirectionIcon className="size-4" />}
            label="Collateral"
            value={isBuy ? formatUsd(summary.amount) : formatBtc(summary.amount)}
          />
          <SummaryLine
            icon={<CheckCircle2 className="size-4" />}
            label={copy.effectivePriceLabel}
            value={`${formatUsd(summary.effectivePrice)}/BTC`}
          />
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <OutcomeBlock
            icon={<Target className="size-4" />}
            title={copy.hitTitle}
            text={
              isBuy
                ? `Your reserved ${formatUsd(summary.amount)} can be assigned into about ${formatBtc(summary.contracts)} at ${formatUsd(summary.strike.strike)}. The premium lowers your effective entry to about ${formatUsd(summary.effectivePrice)}/BTC.`
                : `The covered ${formatBtc(summary.amount)} slice can be sold or capped at ${formatUsd(summary.strike.strike)}. Including premium, the effective exit is about ${formatUsd(summary.effectivePrice)}/BTC.`
            }
          />
          <OutcomeBlock
            icon={<CheckCircle2 className="size-4" />}
            title={copy.missTitle}
            text={
              isBuy
                ? `No BTC is assigned. Your ${formatUsd(summary.amount)} stays available and you keep the estimated ${formatUsd(summary.rewardUsd, 2)} premium.`
                : `You keep the ${formatBtc(summary.amount)} and the estimated ${formatUsd(summary.rewardUsd, 2)} premium. Anything outside this slice stays uncapped.`
            }
          />
        </div>

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
              ? "Target saved"
              : "Target created"
            : `Premium: ${formatUsd(summary.rewardUsd, 2)}`}
        </Text>
        <Button type="button" action onClick={onConfirm} disabled={isPending}>
          {isPending
            ? "Working..."
            : isBuy
              ? "Save target"
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

function PriceSummaryChart({
  chartData,
  spotPrice,
  strikePrice,
}: {
  chartData: BitcoinPriceHistoryPoint[];
  spotPrice: number;
  strikePrice: number;
}) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [chartWidth, setChartWidth] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const chartHeight = 128;
  const topPadding = 12;
  const bottomPadding = 18;

  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;

    const updateWidth = () => {
      setChartWidth(Math.max(0, Math.floor(element.clientWidth)));
    };

    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const validPoints = useMemo(
    () =>
      chartData.filter(
        (point) =>
          Number.isFinite(point.time) &&
          Number.isFinite(point.value) &&
          point.value > 0,
      ),
    [chartData],
  );
  const values = useMemo(
    () => validPoints.map((point) => point.value),
    [validPoints],
  );
  const range = useMemo(() => {
    const candidates = [...values, spotPrice, strikePrice].filter(
      (value) => Number.isFinite(value) && value > 0,
    );
    if (candidates.length === 0) {
      return { min: 0, max: 1 };
    }

    const min = Math.min(...candidates);
    const max = Math.max(...candidates);
    const padding = Math.max((max - min) * 0.14, spotPrice * 0.01, 1);

    return {
      min: min - padding,
      max: max + padding,
    };
  }, [spotPrice, strikePrice, values]);

  const toPoint = useCallback(
    (value: number, index: number, total: number) => {
      const effectiveHeight = chartHeight - topPadding - bottomPadding;
      const valueRange = range.max - range.min || 1;
      const x = total <= 1 ? 0 : (index / (total - 1)) * chartWidth;
      const normalizedValue = (value - range.min) / valueRange;
      const y = chartHeight - bottomPadding - normalizedValue * effectiveHeight;

      return { x, y };
    },
    [bottomPadding, chartHeight, chartWidth, range.max, range.min, topPadding],
  );

  const path = useMemo(() => {
    if (validPoints.length < 2 || chartWidth <= 0) return "";

    return validPoints
      .map((dataPoint, index) => {
        const point = toPoint(dataPoint.value, index, validPoints.length);
        return `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`;
      })
      .join(" ");
  }, [chartWidth, toPoint, validPoints]);

  const areaPath = useMemo(() => {
    if (!path || validPoints.length < 2) return "";

    const first = toPoint(validPoints[0].value, 0, validPoints.length);
    const last = toPoint(
      validPoints[validPoints.length - 1].value,
      validPoints.length - 1,
      validPoints.length,
    );
    const baseline = chartHeight - bottomPadding;

    return `${path} L ${last.x} ${baseline} L ${first.x} ${baseline} Z`;
  }, [bottomPadding, chartHeight, path, toPoint, validPoints]);

  const strikeY = useMemo(() => {
    if (chartWidth <= 0 || strikePrice <= 0) return null;
    return toPoint(strikePrice, 0, 1).y;
  }, [chartWidth, strikePrice, toPoint]);

  const activePoint = useMemo(() => {
    if (
      activeIndex === null ||
      activeIndex < 0 ||
      activeIndex >= validPoints.length ||
      chartWidth <= 0
    ) {
      return null;
    }

    const dataPoint = validPoints[activeIndex];
    const position = toPoint(dataPoint.value, activeIndex, validPoints.length);

    return {
      ...dataPoint,
      x: position.x,
      y: position.y,
    };
  }, [activeIndex, chartWidth, toPoint, validPoints]);

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (validPoints.length < 2 || chartWidth <= 0) return;

      const rect = event.currentTarget.getBoundingClientRect();
      const x = Math.min(Math.max(event.clientX - rect.left, 0), chartWidth);
      const nextIndex = Math.round((x / chartWidth) * (validPoints.length - 1));

      setActiveIndex(
        Math.min(Math.max(nextIndex, 0), validPoints.length - 1),
      );
    },
    [chartWidth, validPoints.length],
  );

  return (
    <div className="mt-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Text variant="terminal-small" className="text-zinc-500">
            BTC
          </Text>
          <Text variant="h5" className="mt-1 text-zinc-950">
            {formatUsd(spotPrice)}
          </Text>
        </div>
        <div className="text-right">
          <Text variant="terminal-small" className="text-zinc-500">
            Strike
          </Text>
          <Text variant="body-small" className="mt-1 text-zinc-950">
            {formatUsd(strikePrice)}
          </Text>
        </div>
      </div>

      <div
        ref={chartRef}
        className="relative mt-2 touch-none"
        style={{ height: chartHeight }}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setActiveIndex(null)}
      >
        {path && chartWidth > 0 ? (
          <svg
            aria-hidden
            width={chartWidth}
            height={chartHeight}
            className="absolute inset-0 overflow-visible"
          >
            <defs>
              <linearGradient id="btc-summary-area" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#f97316" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
              </linearGradient>
            </defs>
            {strikeY !== null && (
              <line
                x1="0"
                x2={chartWidth}
                y1={strikeY}
                y2={strikeY}
                stroke="#a1a1aa"
                strokeDasharray="4 4"
                strokeWidth="1"
              />
            )}
            {areaPath && <path d={areaPath} fill="url(#btc-summary-area)" />}
            <path
              d={path}
              fill="none"
              stroke="#f97316"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
            {activePoint && (
              <>
                <line
                  x1={activePoint.x}
                  x2={activePoint.x}
                  y1={topPadding}
                  y2={chartHeight - bottomPadding}
                  stroke="#71717a"
                  strokeOpacity="0.45"
                  strokeWidth="1"
                />
                <circle
                  cx={activePoint.x}
                  cy={activePoint.y}
                  r="4"
                  fill="#f97316"
                  stroke="#ffffff"
                  strokeWidth="2"
                />
              </>
            )}
          </svg>
        ) : (
          <div className="flex h-full items-center justify-center">
            <Text variant="body-small" className="text-zinc-500">
              BTC price loading
            </Text>
          </div>
        )}

        {activePoint && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-[5px] border-[0.5px] border-zinc-200 bg-white px-2.5 py-1.5 shadow-[0_12px_30px_rgba(9,9,11,0.12)]"
            style={{
              left: Math.min(Math.max(activePoint.x, 56), Math.max(chartWidth - 56, 56)),
              top: Math.max(activePoint.y - 48, 0),
            }}
          >
            <Text variant="terminal-small" className="whitespace-nowrap text-zinc-500">
              {formatChartTime(activePoint.time)}
            </Text>
            <Text variant="body-small" className="mt-0.5 whitespace-nowrap text-zinc-950">
              {formatUsd(activePoint.value, 2)}
            </Text>
          </div>
        )}
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
