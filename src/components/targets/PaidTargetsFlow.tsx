"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { toast } from "sonner";
import AsideCard, {
  AsideContent,
  AsideFooter,
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
import { useAvailableStrikes, type StrikeOption } from "@/hooks/protocol/useAvailableStrikes";
import { useBtcbBalance, useMintBtcb } from "@/hooks/protocol/useBtcb";
import { usePositionMonitor } from "@/hooks/protocol/usePositionMonitor";
import { useSellCall } from "@/hooks/protocol/useSellCall";
import { useCoveredCallStore } from "@/stores/covered-call";
import { daysToExpiry } from "@/lib/protocol/apr";
import { explorerTxUrl } from "@/lib/protocol/deployments";
import { toUnit } from "@/lib/protocol/units";
import { cn } from "@/lib/utils";

type TargetMode = "buy_low" | "sell_high";
type FlowStep = "select" | "subaccount" | "deposit" | "selling" | "done";

type ModeCopy = {
  eyebrow: string;
  title: string;
  shortTitle: string;
  composerTitle: string;
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

const MODE_COPY: Record<TargetMode, ModeCopy> = {
  buy_low: {
    eyebrow: "I have cash",
    title: "Buy BTC cheaper",
    shortTitle: "Buy cheaper",
    composerTitle: "Buy BTC cheaper",
    description:
      "Reserve USDC for the price you want. If BTC trades down to your target, you buy. If it does not, you keep the reward.",
    amountLabel: "Cash to reserve",
    amountPrefix: "$",
    amountSuffix: "USDC",
    targetLabel: "Buy target",
    metricAmountLabel: "BTC if filled",
    effectivePriceLabel: "Effective buy price",
    reviewTitle: "Review buy target",
    hitTitle: "BTC reaches your buy price",
    missTitle: "BTC stays above your price",
  },
  sell_high: {
    eyebrow: "I have BTC",
    title: "Sell BTC higher",
    shortTitle: "Sell higher",
    composerTitle: "Sell BTC higher",
    description:
      "Choose the slice of BTC you would sell at a great price. If BTC reaches that target, the slice is capped. If it does not, you keep the BTC and the reward.",
    amountLabel: "BTC to put to work",
    amountPrefix: "",
    amountSuffix: "BTCB",
    targetLabel: "Sell target",
    metricAmountLabel: "BTC committed",
    effectivePriceLabel: "Effective sell price",
    reviewTitle: "Review sell target",
    hitTitle: "BTC reaches your sell price",
    missTitle: "BTC stays below your price",
  },
};

const STEP_LABEL: Record<Exclude<FlowStep, "select" | "done">, string> = {
  subaccount: "Creating target account",
  deposit: "Depositing test BTCB",
  selling: "Getting market quotes",
};

const DEFAULT_AMOUNT: Record<TargetMode, string> = {
  buy_low: "1000",
  sell_high: "0.05",
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

function DirectionCard({
  mode,
  active,
  onClick,
}: {
  mode: TargetMode;
  active: boolean;
  onClick: () => void;
}) {
  const copy = MODE_COPY[mode];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-[112px] flex-col justify-between rounded-sm border-[0.5px] p-4 text-left transition-colors",
        active
          ? "border-zinc-950 bg-zinc-950 text-white"
          : "border-zinc-200 bg-white text-zinc-950 hover:border-zinc-400"
      )}
    >
      <Text
        as="span"
        variant="terminal-small"
        className={active ? "text-zinc-300" : "text-zinc-500"}
      >
        {copy.eyebrow}
      </Text>
      <Text as="span" variant="h5" className={active ? "text-white" : "text-zinc-950"}>
        {copy.title}
      </Text>
    </button>
  );
}

function TokenBadge({ symbol, label }: { symbol: string; label: string }) {
  return (
    <div className="flex shrink-0 items-center gap-2 rounded-[5px] border-[0.5px] border-zinc-200 p-2.5">
      <TokenIcon symbol={symbol} size={28} />
      <Text as="span" variant="body-default" className="text-foreground">
        {label}
      </Text>
    </div>
  );
}

function TargetSelector({
  strikes,
  selectedStrike,
  onSelect,
  label,
}: {
  strikes: StrikeOption[];
  selectedStrike: number | null;
  onSelect: (strike: number) => void;
  label: string;
}) {
  if (strikes.length === 0) {
    return (
      <div className="rounded-sm border-[0.5px] border-zinc-200 bg-zinc-50 p-4">
        <Text variant="body-small" className="text-zinc-500">
          No targets are available for this expiry yet.
        </Text>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Text as="label" variant="body-small" className="text-zinc-800">
          {label}
        </Text>
        <Text variant="terminal-small" className="text-zinc-500">
          Reward rate
        </Text>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {strikes.slice(0, 8).map((strike) => {
          const active = strike.strike === selectedStrike;
          return (
            <button
              key={strike.instrumentName}
              type="button"
              onClick={() => onSelect(strike.strike)}
              className={cn(
                "min-h-[86px] rounded-sm border-[0.5px] p-3 text-left transition-colors",
                active
                  ? "border-orange-500 bg-orange-50"
                  : "border-zinc-200 bg-white hover:border-zinc-400"
              )}
            >
              <Text as="span" variant="h5" className="block text-zinc-950">
                {formatUsd(strike.strike)}
              </Text>
              <Text as="span" variant="body-small" className="mt-1 block text-zinc-500">
                {formatUsd(strike.premium, strike.premium >= 100 ? 0 : 2)}/BTC
              </Text>
              <Text as="span" variant="terminal-small" className="mt-2 block text-orange-600">
                {formatPercent(strike.apr)} APR
              </Text>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Text variant="body-small" className="text-zinc-500">
        {label}
      </Text>
      <Text variant="body-small" className="text-right text-zinc-950">
        {value}
      </Text>
    </div>
  );
}

function QuoteStatus({
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
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, []);

  const remaining = Math.max(0, (endsAt - now) / 1000);

  return (
    <div className="rounded-sm border-[0.5px] border-orange-200 bg-orange-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Text variant="terminal-small" className="text-orange-700">
            Market quotes live
          </Text>
          <Text variant="body-small" className="mt-1 text-zinc-700">
            {quoteCount} quote{quoteCount === 1 ? "" : "s"} received
          </Text>
        </div>
        <div className="text-right">
          <Text variant="terminal-small" className="text-orange-700">
            {remaining > 0 ? `${remaining.toFixed(1)}s` : "closing"}
          </Text>
          <Text variant="body-small" className="mt-1 text-zinc-950">
            {bestTotalPremium !== null ? `Best ${formatUsd(bestTotalPremium, 2)}` : "Waiting"}
          </Text>
        </div>
      </div>
    </div>
  );
}

function OutcomeBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-sm border-[0.5px] border-zinc-200 bg-white p-4">
      <Text variant="body-default" className="text-zinc-950">
        {title}
      </Text>
      <Text variant="body-small" className="mt-1 text-zinc-600">
        {body}
      </Text>
    </div>
  );
}

function ReviewDialog({
  mode,
  amount,
  spotPrice,
  selectedStrike,
  selectedExpiry,
  rewardUsd,
  apr,
  contracts,
  effectivePrice,
  isConnected,
  isSellBalanceShort,
  isConfirming,
  onClose,
  onConfirm,
}: {
  mode: TargetMode;
  amount: number;
  spotPrice: number;
  selectedStrike: StrikeOption;
  selectedExpiry: number | null;
  rewardUsd: number;
  apr: number;
  contracts: number;
  effectivePrice: number;
  isConnected: boolean;
  isSellBalanceShort: boolean;
  isConfirming: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const copy = MODE_COPY[mode];
  const isBuy = mode === "buy_low";
  const expiry = expiryLabel(selectedExpiry);
  const amountLabel = isBuy ? formatUsd(amount) : formatBtc(amount);
  const targetLabel = formatUsd(selectedStrike.strike);
  const primaryBody = isBuy
    ? `You reserve ${formatUsd(amount)} and buy about ${formatBtc(contracts)} at ${targetLabel}. The reward lowers the effective entry to about ${formatUsd(effectivePrice)}/BTC.`
    : `The ${formatBtc(amount)} slice is capped at ${targetLabel}. Including the reward, the effective target is about ${formatUsd(effectivePrice)}/BTC.`;
  const secondaryBody = isBuy
    ? `No BTC is bought. Your ${formatUsd(amount)} stays available and you keep the estimated ${formatUsd(rewardUsd, 2)} reward.`
    : `You keep the ${formatBtc(amount)} and the estimated ${formatUsd(rewardUsd, 2)} reward. Anything outside this slice stays fully uncapped.`;

  const confirmLabel = (() => {
    if (isConfirming) return isBuy ? "Saving target..." : "Starting target...";
    if (isBuy) return "Save target";
    if (!isConnected) return "Connect wallet";
    if (isSellBalanceShort) return "Add BTCB first";
    return "Confirm sell target";
  })();

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-zinc-950/40 px-4 py-4 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-[620px] overflow-hidden rounded-lg border-[0.5px] border-zinc-200 bg-white shadow-[0_24px_80px_rgba(0,0,0,0.18)]">
        <div className="flex items-start justify-between border-b-[0.5px] border-zinc-200 bg-zinc-100 p-5">
          <div>
            <AsideTitle>Target summary</AsideTitle>
            <Text as="h2" variant="h4" className="mt-1 text-zinc-950">
              {copy.reviewTitle}
            </Text>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onClose}
            aria-label="Close review"
            className="size-9 text-zinc-500 hover:text-zinc-950"
          >
            x
          </Button>
        </div>

        <div className="space-y-5 p-5 sm:p-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Text variant="body-small" className="text-zinc-500">
                {isBuy ? "Reserve" : "Put to work"}
              </Text>
              <div className="mt-2 flex items-center gap-2">
                <TokenIcon symbol={isBuy ? "USDC" : "BTC"} size={30} />
                <Text variant="terminal-heading" className="text-zinc-950">
                  {amountLabel}
                </Text>
              </div>
            </div>
            <div>
              <Text variant="body-small" className="text-zinc-500">
                Target
              </Text>
              <Text variant="terminal-heading" className="mt-2 text-zinc-950">
                {targetLabel}
              </Text>
              <Text variant="body-small" className="text-zinc-500">
                by {expiry}
              </Text>
            </div>
          </div>

          <div className="space-y-3 rounded-sm border-[0.5px] border-zinc-200 bg-zinc-50 p-4">
            <MetricRow label="Estimated reward" value={formatUsd(rewardUsd, 2)} />
            <MetricRow label="Reward rate" value={formatPercent(apr)} />
            <MetricRow label="BTC spot" value={formatUsd(spotPrice)} />
            <MetricRow label={copy.effectivePriceLabel} value={`${formatUsd(effectivePrice)}/BTC`} />
          </div>

          <div className="grid gap-3">
            <OutcomeBlock title={copy.hitTitle} body={primaryBody} />
            <OutcomeBlock title={copy.missTitle} body={secondaryBody} />
          </div>

          {isSellBalanceShort && (
            <div className="rounded-sm border-[0.5px] border-red-200 bg-red-50 p-4">
              <Text variant="body-small" className="text-red-700">
                This wallet does not have enough BTCB for that sell target.
                Add BTCB from the header or reduce the amount.
              </Text>
            </div>
          )}

          <div className="flex flex-col-reverse gap-3 border-t-[0.5px] border-zinc-200 pt-5 sm:flex-row sm:items-center sm:justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Back
            </Button>
            <Button
              type="button"
              onClick={onConfirm}
              disabled={isConfirming || isSellBalanceShort}
              action
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProductExplainer() {
  const cards = [
    {
      title: "Buy target",
      kicker: "Get paid to wait for a dip",
      body: "Reserve USDC at a lower BTC price. If the market reaches it, your cash buys BTC. If it does not, you keep the reward.",
    },
    {
      title: "Sell target",
      kicker: "Get paid to name your exit",
      body: "Commit only the BTC slice you would sell at a higher price. If the market reaches it, that slice is capped. The rest stays exposed.",
    },
    {
      title: "Review",
      kicker: "Two outcomes, before you sign",
      body: "Every target shows the reward, effective price, expiry, and both possible outcomes in plain English.",
    },
  ];

  return (
    <section className="border-t-[0.5px] border-zinc-200 bg-zinc-50 px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.72fr_1fr]">
        <div className="max-w-[560px]">
          <Text variant="terminal-small" className="text-zinc-500">
            How it works
          </Text>
          <Text as="h2" variant="h2" className="mt-3 text-zinc-950">
            A limit order that pays you upfront.
          </Text>
          <Text variant="body-large" className="mt-5 text-zinc-600">
            Hedge is not a trading terminal. It is a simple target order for
            people who already know the price where they would buy or sell BTC.
          </Text>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {cards.map((card) => (
            <div key={card.title} className="rounded-lg border-[0.5px] border-zinc-200 bg-white p-5">
              <Text variant="terminal-small" className="text-orange-600">
                {card.title}
              </Text>
              <Text as="h3" variant="h5" className="mt-3 text-zinc-950">
                {card.kicker}
              </Text>
              <Text variant="body-small" className="mt-3 text-zinc-600">
                {card.body}
              </Text>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HedgeFooter() {
  return (
    <footer className="bg-zinc-950 px-4 py-14 text-white sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-10 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-[640px]">
          <Image
            src="/hedge-logo.svg"
            alt="Hedge"
            width={1500}
            height={318}
            className="h-9 w-auto invert"
          />
          <Text variant="body-small" className="mt-6 text-zinc-500">
            Hedge is built for paid BTC targets. Buy lower maps to
            cash-secured puts, sell higher maps to covered calls, and every
            order is wallet signed on decentralized rails.
          </Text>
        </div>
        <div className="grid grid-cols-2 gap-10 text-sm">
          <div>
            <Text variant="h5" className="text-zinc-200">
              Product
            </Text>
            <div className="mt-4 space-y-2 text-zinc-500">
              <div>Buy BTC cheaper</div>
              <div>Sell BTC higher</div>
              <div>Paid target orders</div>
            </div>
          </div>
          <div>
            <Text variant="h5" className="text-zinc-200">
              Protocol
            </Text>
            <div className="mt-4 space-y-2 text-zinc-500">
              <div>Decentralized rails</div>
              <div>Wallet signed</div>
              <div>Self-custody</div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

export function PaidTargetsFlow() {
  const { isConnected, address } = useAccount();
  const { openConnectModal } = useConnectModal();

  const [mode, setMode] = useState<TargetMode>("buy_low");
  const [amount, setAmount] = useState(DEFAULT_AMOUNT.buy_low);
  const [selectedExpiry, setSelectedExpiry] = useState<number | null>(null);
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [isReviewOpen, setReviewOpen] = useState(false);
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
  const mintBtcb = useMintBtcb();
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
  const selectedStrikeData = strikes.find((strike) => strike.strike === activeStrike) ?? null;
  const selectedExpiryData = expiries.find((expiry) => expiry.epoch === activeExpiry) ?? null;
  const dte = activeExpiry ? Math.ceil(daysToExpiry(activeExpiry)) : 0;
  const isBuy = mode === "buy_low";
  const copy = MODE_COPY[mode];
  const contracts =
    selectedStrikeData && amountNum > 0
      ? isBuy
        ? amountNum / selectedStrikeData.strike
        : amountNum
      : 0;
  const rewardUsd = selectedStrikeData ? selectedStrikeData.premium * contracts : 0;
  const effectivePrice = selectedStrikeData
    ? isBuy
      ? selectedStrikeData.strike - selectedStrikeData.premium
      : selectedStrikeData.strike + selectedStrikeData.premium
    : 0;
  const sellBalanceShort = !isBuy && isConnected && amountNum > btcBalance;
  const capitalUsd = isBuy ? amountNum : amountNum * spotPrice;
  const targetDistance =
    selectedStrikeData && spotPrice > 0
      ? Math.abs(selectedStrikeData.strike - spotPrice) / spotPrice
      : 0;
  const isPending = step !== "select" && step !== "done";

  const switchMode = useCallback((nextMode: TargetMode) => {
    setMode(nextMode);
    setAmount(DEFAULT_AMOUNT[nextMode]);
    setSelectedStrike(null);
    setDoneInfo(null);
  }, []);

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
      setReviewOpen(false);
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
      toast.success(`Sell target created. Estimated reward ${formatUsd(result.totalPremium, 2)}`);
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
      setReviewOpen(false);
      toast.success("Buy target saved");
      return;
    }
    void handleConfirmSellTarget();
  }, [amountNum, handleConfirmSellTarget, mode, rewardUsd, selectedStrikeData]);

  const ctaDisabled = !selectedStrikeData || amountNum <= 0 || isPending;

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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <section className="px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(420px,0.62fr)] lg:items-start">
          <div className="flex flex-col justify-between gap-10 lg:min-h-[620px]">
            <div className="space-y-7 pt-2 lg:pt-8">
              <div className="inline-flex items-center gap-2 rounded-sm border-[0.5px] border-zinc-200 bg-white px-3 py-2">
                <span className="size-1.5 rounded-full bg-green-500" />
                <Text as="span" variant="terminal-small" className="text-zinc-600">
                  Paid BTC targets
                </Text>
              </div>

              <div className="max-w-[760px]">
                <Text as="h1" variant="h1" className="text-zinc-950">
                  Buy lower. Sell higher. Get paid for the wait.
                </Text>
                <Text variant="subheading-1" className="mt-6 max-w-[610px] text-zinc-600">
                  Hedge turns BTC target prices into rewards. Reserve cash for a
                  lower buy, or put a small BTC slice behind a higher sell. The
                  app shows the reward and both outcomes before you sign.
                </Text>
              </div>

              <div className="flex flex-wrap gap-3">
                {["Plain-English outcomes", "Clear target price", "Wallet-signed orders"].map((item) => (
                  <div
                    key={item}
                    className="rounded-sm border-[0.5px] border-zinc-200 bg-white px-3 py-2"
                  >
                    <Text variant="body-small" className="text-zinc-700">
                      {item}
                    </Text>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid max-w-[720px] gap-3 sm:grid-cols-3">
              <div className="rounded-lg border-[0.5px] border-zinc-200 bg-white p-4">
                <Text variant="terminal-small" className="text-zinc-500">
                  BTC spot
                </Text>
                <Text variant="terminal-heading" className="mt-2 text-zinc-950">
                  {formatUsd(spotPrice)}
                </Text>
              </div>
              <div className="rounded-lg border-[0.5px] border-zinc-200 bg-white p-4">
                <Text variant="terminal-small" className="text-zinc-500">
                  Current target
                </Text>
                <Text variant="terminal-heading" className="mt-2 text-zinc-950">
                  {selectedStrikeData ? formatUsd(selectedStrikeData.strike) : "-"}
                </Text>
              </div>
              <div className="rounded-lg border-[0.5px] border-zinc-200 bg-white p-4">
                <Text variant="terminal-small" className="text-zinc-500">
                  Est. reward
                </Text>
                <Text variant="terminal-heading" className="mt-2 text-zinc-950">
                  {selectedStrikeData ? formatUsd(rewardUsd, 2) : "-"}
                </Text>
              </div>
            </div>
          </div>

          <AsideCard>
            <AsideHeader>
              <div>
                <AsideTitle>Target Composer</AsideTitle>
                <Text as="h2" variant="h4" className="mt-1 text-zinc-950">
                  {copy.composerTitle}
                </Text>
              </div>
              <div className="rounded-sm border-[0.5px] border-zinc-200 bg-white px-3 py-2">
                <Text variant="terminal-small" className="text-zinc-600">
                  {selectedExpiryData ? `${dte}d` : "Live"}
                </Text>
              </div>
            </AsideHeader>

            <AsideContent>
              <div className="flex min-w-0 flex-col gap-[1.875rem] overflow-hidden">
                <div className="grid gap-3 sm:grid-cols-2">
                  <DirectionCard
                    mode="buy_low"
                    active={mode === "buy_low"}
                    onClick={() => switchMode("buy_low")}
                  />
                  <DirectionCard
                    mode="sell_high"
                    active={mode === "sell_high"}
                    onClick={() => switchMode("sell_high")}
                  />
                </div>

                <Text variant="body-small" className="text-zinc-600">
                  {copy.description}
                </Text>

                <CurrencyField>
                  <CurrencyField.Label>{copy.amountLabel}</CurrencyField.Label>
                  <CurrencyField.Control
                    value={amount}
                    onChange={(value) => setAmount(sanitizeDecimal(value))}
                    prefix={copy.amountPrefix}
                    trailing={
                      <TokenBadge
                        symbol={isBuy ? "USDC" : "BTC"}
                        label={copy.amountSuffix}
                      />
                    }
                  />
                </CurrencyField>

                {!isBuy && isConnected && (
                  <div className="flex items-center justify-between gap-3">
                    <Text variant="body-small" className="text-zinc-500">
                      Available BTCB: {btcBalance.toFixed(6)}
                    </Text>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => mintBtcb.mutate()}
                      disabled={mintBtcb.isPending}
                    >
                      {mintBtcb.isPending ? "Adding..." : "Add BTCB"}
                    </Button>
                  </div>
                )}

                <div className="space-y-2">
                  <Text as="label" variant="body-small" className="text-zinc-800">
                    Expiry
                  </Text>
                  <select
                    value={activeExpiry ?? ""}
                    onChange={(event) => {
                      setSelectedExpiry(Number(event.target.value));
                      setSelectedStrike(null);
                    }}
                    className="h-12 w-full rounded-sm border-[0.5px] border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-950"
                  >
                    {expiries.map((expiry) => (
                      <option key={expiry.epoch} value={expiry.epoch}>
                        {expiry.label} at 08:00 UTC
                      </option>
                    ))}
                  </select>
                </div>

                {isLoading ? (
                  <div className="rounded-sm border-[0.5px] border-zinc-200 bg-zinc-50 p-6 text-center">
                    <Text variant="body-small" className="text-zinc-500">
                      Loading targets...
                    </Text>
                  </div>
                ) : (
                  <TargetSelector
                    strikes={strikes}
                    selectedStrike={activeStrike}
                    onSelect={setSelectedStrike}
                    label={copy.targetLabel}
                  />
                )}

                {sellCall.auction && step === "selling" && (
                  <QuoteStatus
                    endsAt={sellCall.auction.endsAt}
                    quoteCount={sellCall.auction.quoteCount}
                    bestTotalPremium={sellCall.auction.bestTotalPremium}
                  />
                )}

                <div className="space-y-3 rounded-sm border-[0.5px] border-zinc-200 bg-zinc-50 p-4">
                  <MetricRow label="Estimated reward" value={selectedStrikeData ? formatUsd(rewardUsd, 2) : "-"} />
                  <MetricRow label={copy.metricAmountLabel} value={isBuy ? formatBtc(contracts) : formatBtc(amountNum)} />
                  <MetricRow label="Capital at work" value={capitalUsd > 0 ? formatUsd(capitalUsd, 2) : "-"} />
                  <MetricRow label={copy.effectivePriceLabel} value={effectivePrice > 0 ? `${formatUsd(effectivePrice)}/BTC` : "-"} />
                  <MetricRow label="Distance from spot" value={selectedStrikeData ? formatPercent(targetDistance * 100) : "-"} />
                </div>

                {progressLabel && (
                  <div className="rounded-sm border-[0.5px] border-orange-200 bg-orange-50 p-4">
                    <Text variant="body-small" className="text-orange-800">
                      {progressLabel}
                    </Text>
                  </div>
                )}

                {doneInfo && (
                  <div
                    className={cn(
                      "rounded-sm border-[0.5px] p-4",
                      doneInfo.simulated
                        ? "border-amber-200 bg-amber-50"
                        : "border-green-200 bg-green-50"
                    )}
                  >
                    <Text
                      variant="body-default"
                      className={doneInfo.simulated ? "text-amber-900" : "text-green-800"}
                    >
                      {doneInfo.simulated ? "Buy target saved" : "Sell target created"}
                    </Text>
                    <Text
                      variant="body-small"
                      className={cn(
                        "mt-1",
                        doneInfo.simulated ? "text-amber-900" : "text-green-800"
                      )}
                    >
                      Estimated reward: {formatUsd(doneInfo.premium, 2)}
                    </Text>
                    {doneInfo.txHash && (
                      <a
                        href={explorerTxUrl(doneInfo.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-block text-sm font-semibold text-green-700 underline-offset-2 hover:underline"
                      >
                        View transaction on BscScan
                      </a>
                    )}
                  </div>
                )}

                <Separator />
                <Button
                  type="button"
                  onClick={() => setReviewOpen(true)}
                  disabled={ctaDisabled}
                  action
                  size="lg"
                  className="w-full"
                >
                  {isPending ? "Working..." : "Review target"}
                </Button>
              </div>
            </AsideContent>

            <AsideFooter>
              <Text variant="terminal-small" className="text-zinc-400">
                Live premium quotes for paid BTC targets
              </Text>
              <Text variant="terminal-small" className="text-zinc-400">
                BSC
              </Text>
            </AsideFooter>
          </AsideCard>
        </div>
      </section>

      <ProductExplainer />
      <HedgeFooter />

      {isReviewOpen && selectedStrikeData && (
        <ReviewDialog
          mode={mode}
          amount={amountNum}
          spotPrice={spotPrice}
          selectedStrike={selectedStrikeData}
          selectedExpiry={activeExpiry}
          rewardUsd={rewardUsd}
          apr={selectedStrikeData.apr}
          contracts={contracts}
          effectivePrice={effectivePrice}
          isConnected={isConnected}
          isSellBalanceShort={sellBalanceShort}
          isConfirming={isPending}
          onClose={() => setReviewOpen(false)}
          onConfirm={handleConfirmReview}
        />
      )}
    </div>
  );
}
