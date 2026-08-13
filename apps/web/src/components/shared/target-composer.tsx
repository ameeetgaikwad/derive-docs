"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { toast } from "sonner";
import { useAccount } from "wagmi";
import {
  MarketSelector,
  OrderTicket,
  TradeConfigurator,
  type CompletedTradeInfo,
  type FeeReadState,
  type OrderSnapshot,
  type SetupPhase,
} from "@/components/trade/covered-call-ui";
import { useCoveredCallSubaccount } from "@/hooks/protocol/useCoveredCallSubaccount";
import {
  useAvailableStrikes,
  type StrikeOption,
} from "@/hooks/protocol/useAvailableStrikes";
import { useCollateralBalance, useDepositCollateral } from "@/hooks/protocol/useCollateral";
import { useOIFeeEstimate } from "@/hooks/protocol/useOIFeeEstimate";
import { usePositionMonitor } from "@/hooks/protocol/usePositionMonitor";
import { useSellCall } from "@/hooks/protocol/useSellCall";
import { useBitcoinPriceHistory } from "@/hooks/useBitcoinPriceHistory";
import { explorerTxUrl } from "@/lib/protocol/deployments";
import { assertRfqEngineChain } from "@/lib/protocol/rfq-engine";
import { amountExceedsLimit, fromUnit, toUnit } from "@/lib/protocol/units";
import { getSelectableMarkets, uiAmount18ToRaw18, type MarketId } from "@/lib/protocol/markets";
import { useCoveredCallStore } from "@/stores/covered-call";
import { useNetwork } from "@/hooks/protocol/useNetwork";

const DEFAULT_AMOUNT = "0.5";
const DEFAULT_AMOUNTS: Record<MarketId, string> = {
  BTC: DEFAULT_AMOUNT,
  XAU: "0.01",
  SPY: "0.1",
  NVDA: "0.25",
  SPCX: "1",
};

function sanitizeDecimal(value: string): string {
  const normalized = value.replace(/[^\d.]/g, "");
  const [head, ...tail] = normalized.split(".");
  return tail.length > 0 ? `${head}.${tail.join("")}` : head;
}

function expiryLabel(epoch: number): string {
  return new Date(epoch * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function suggestedStrike(strikes: StrikeOption[]): StrikeOption | null {
  const meaningful = strikes.filter((strike) => strike.premium >= 0.01);
  if (meaningful.length === 0) return null;
  return meaningful.reduce((best, current) =>
    Math.abs(current.otmPercent - 5) < Math.abs(best.otmPercent - 5)
      ? current
      : best,
  );
}

export default function CoveredCallTrade({
  onReviewModeChange,
}: {
  onReviewModeChange?: (reviewMode: boolean) => void;
} = {}) {
  const { isConnected, address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { chainId } = useNetwork();
  const markets = useMemo(() => getSelectableMarkets(chainId), [chainId]);
  const [selectedMarketId, setSelectedMarketId] = useState<MarketId>("BTC");
  const [amounts, setAmounts] = useState<Record<MarketId, string>>(DEFAULT_AMOUNTS);
  const storedAmount = amounts[selectedMarketId];
  const setAmount = useCallback((value: string) => {
    setAmounts((current) => ({ ...current, [selectedMarketId]: value }));
  }, [selectedMarketId]);
  const [selectedExpiry, setSelectedExpiry] = useState<number | null>(null);
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [selectedStrikeSnapshot, setSelectedStrikeSnapshot] =
    useState<StrikeOption | null>(null);
  const [setupPhase, setSetupPhase] = useState<SetupPhase>("idle");
  const [frozenOrder, setFrozenOrder] = useState<OrderSnapshot | null>(null);
  const [frozenMarketStrikes, setFrozenMarketStrikes] = useState<StrikeOption[] | null>(null);
  const [preparedSubaccountId, setPreparedSubaccountId] = useState<bigint | null>(null);
  const [doneInfo, setDoneInfo] = useState<CompletedTradeInfo | null>(null);

  useEffect(() => {
    onReviewModeChange?.(false);
  }, [onReviewModeChange]);

  const {
    expiries,
    selectedExpiry: activeExpiry,
    strikes,
    spotPrice,
    isLoading,
    market,
    multiplier,
    isUnavailable,
    unavailableReason,
  } = useAvailableStrikes(selectedExpiry, selectedMarketId);
  const history = useBitcoinPriceHistory();
  const { subaccountId, ensureSubaccount } = useCoveredCallSubaccount();
  const depositCollateral = useDepositCollateral(selectedMarketId, multiplier);
  const sellCall = useSellCall();
  const { balanceNumber: walletCollateral, refetch: refetchCollateral } = useCollateralBalance(selectedMarketId, multiplier);
  const { balances: subBalances, refetch: refetchPositions } =
    usePositionMonitor(subaccountId, selectedMarketId, multiplier);
  const { addTrade } = useCoveredCallStore();
  const amount = amountExceedsLimit(storedAmount, market.maxSize)
    ? market.maxSize
    : storedAmount;

  const balance = walletCollateral + subBalances.collateral;
  const amountNumber = Math.max(0, Number.parseFloat(amount) || 0);
  const liveSelectedStrike =
    strikes.find((strike) => strike.strike === selectedStrike) ?? null;
  const activeSnapshot =
    selectedStrikeSnapshot?.expiry === activeExpiry
      ? selectedStrikeSnapshot
      : null;
  const defaultStrike = useMemo(() => suggestedStrike(strikes), [strikes]);
  const selectedStrikeData =
    liveSelectedStrike ?? activeSnapshot ?? defaultStrike;
  const oiFee = useOIFeeEstimate({
    amount,
    forwardPrice: selectedStrikeData?.forwardPrice ?? 0,
    optionAsset: market.contracts?.optionAsset,
    enabled:
      market.contracts !== null &&
      selectedStrikeData !== null &&
      amountNumber > 0,
  });

  const marketStrikes = useMemo(() => {
    if (
      activeSnapshot === null ||
      strikes.some(
        (strike) => strike.instrumentName === activeSnapshot.instrumentName,
      )
    ) {
      return strikes;
    }
    return [...strikes, activeSnapshot].sort(
      (left, right) => left.strike - right.strike,
    );
  }, [activeSnapshot, strikes]);

  const currentOrder = useMemo<OrderSnapshot | null>(() => {
    if (!selectedStrikeData || activeExpiry === null) return null;
    return {
      amount: amountNumber,
      strike: selectedStrikeData,
      expiryLabel: expiryLabel(activeExpiry),
      spotPrice,
      indicativeTotalPremium: selectedStrikeData.premium * amountNumber,
      marketId: selectedMarketId,
      assetName: market.displayName,
      collateralSymbol: market.collateral.symbol,
      estimatedOiFee: oiFee.perSideFeeUsd,
    };
  }, [
    activeExpiry,
    amountNumber,
    market.collateral.symbol,
    market.displayName,
    oiFee.perSideFeeUsd,
    selectedMarketId,
    selectedStrikeData,
    spotPrice,
  ]);
  const displayOrder = frozenOrder ?? currentOrder;
  const feeReadState: FeeReadState = frozenOrder?.estimatedOiFee !== undefined && frozenOrder.estimatedOiFee !== null
    ? "ready"
    : oiFee.isLoading
      ? "loading"
      : oiFee.isAvailable
        ? "ready"
        : "unavailable";
  const configuratorStrikes = frozenMarketStrikes ?? marketStrikes;
  const configuratorSpot = frozenOrder?.spotPrice ?? spotPrice;
  const configuratorStrike = frozenOrder?.strike.strike ?? selectedStrikeData?.strike ?? null;

  const sellBusy = [
    "requesting",
    "auction",
    "quoted",
    "signing",
    "executing",
    "done",
  ].includes(sellCall.phase);
  const controlsLocked = setupPhase !== "idle" || sellBusy || doneInfo !== null;

  const handleExpiryChange = useCallback(
    (expiry: number) => {
      if (controlsLocked) return;
      sellCall.reset();
      setFrozenOrder(null);
      setFrozenMarketStrikes(null);
      setDoneInfo(null);
      setSelectedExpiry(expiry);
      setSelectedStrike(null);
      setSelectedStrikeSnapshot(null);
    },
    [controlsLocked, sellCall],
  );

  const handleMarketChange = useCallback((marketId: MarketId) => {
    if (controlsLocked || marketId === selectedMarketId) return;
    sellCall.reset();
    setSelectedMarketId(marketId);
    setSelectedExpiry(null);
    setSelectedStrike(null);
    setSelectedStrikeSnapshot(null);
    setFrozenOrder(null);
    setFrozenMarketStrikes(null);
    setDoneInfo(null);
    setPreparedSubaccountId(null);
  }, [controlsLocked, selectedMarketId, sellCall]);

  const handleStrikeSelect = useCallback(
    (strike: number) => {
      if (controlsLocked) return;
      const strikeSnapshot =
        strikes.find((option) => option.strike === strike) ??
        (activeSnapshot?.strike === strike ? activeSnapshot : null);
      if (strikeSnapshot === null) return;
      sellCall.reset();
      setFrozenOrder(null);
      setFrozenMarketStrikes(null);
      setDoneInfo(null);
      setSelectedStrike(strike);
      setSelectedStrikeSnapshot(strikeSnapshot);
    },
    [activeSnapshot, controlsLocked, sellCall, strikes],
  );

  const handleRequestQuote = useCallback(async () => {
    if (!isConnected || !address) {
      openConnectModal?.();
      return;
    }
    const order = currentOrder ?? frozenOrder;
    if (!order || amountNumber <= 0) {
      toast.error(`Enter the ${market.collateral.symbol} amount you want to cover`);
      return;
    }
    if (isUnavailable || !market.enabled || market.contracts === null) {
      toast.error(unavailableReason ?? `${market.displayName} is not available for quoting`);
      return;
    }
    if (amountExceedsLimit(amount, market.maxSize)) {
      toast.error(
        `Maximum order size for ${market.displayName} is ${market.maxSize} ${market.collateral.symbol}`,
      );
      return;
    }
    if (amountNumber > balance) {
      toast.error(`Not enough ${market.collateral.symbol} for this covered call`);
      return;
    }
    if (oiFee.perSideFeeUsd === null) {
      toast.error("The live protocol fee could not be read. Try again before requesting a quote.");
      return;
    }

    if (sellCall.phase === "error" || sellCall.phase === "expired") {
      sellCall.reset();
    }

    const submitted: OrderSnapshot = {
      ...order,
      amount: amountNumber,
      indicativeTotalPremium: order.strike.premium * amountNumber,
    };
    setFrozenOrder(submitted);
    setFrozenMarketStrikes(marketStrikes.map((strike) => ({ ...strike })));
    setDoneInfo(null);

    try {
      // Freeze and validate the exact canonical raw amount before any approval,
      // subaccount creation, or collateral deposit. The RFQ engine repeats the
      // scaled-UI cap check against the live checkpointed multiplier.
      const rawAmount = fromUnit(
        uiAmount18ToRaw18(toUnit(submitted.amount.toString()), multiplier),
      );
      await assertRfqEngineChain(chainId);

      setSetupPhase("subaccount");
      const subId = await ensureSubaccount();
      setPreparedSubaccountId(subId);

      const deficit = amountNumber - subBalances.collateral;
      if (deficit > 0) {
        setSetupPhase("deposit");
        await depositCollateral(subId, deficit.toFixed(18));
        refetchCollateral();
      }

      setSetupPhase("idle");
      await sellCall.requestQuote({
        marketId: selectedMarketId,
        subaccountId: subId,
        expiry: submitted.strike.expiry,
        strike: submitted.strike.strike,
        protocolStrike: fromUnit(submitted.strike.strike18),
        amount: submitted.amount.toString(),
        rawAmount,
        uiMultiplier: multiplier,
        spot: submitted.spotPrice,
        indicativePremium: submitted.strike.premium,
        instrumentName: submitted.strike.instrumentName,
      });
    } catch (error) {
      setSetupPhase("idle");
      setFrozenOrder(null);
      setFrozenMarketStrikes(null);
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [
    address,
    amount,
    amountNumber,
    balance,
    chainId,
    currentOrder,
    depositCollateral,
    ensureSubaccount,
    frozenOrder,
    isConnected,
    isUnavailable,
    marketStrikes,
    oiFee.perSideFeeUsd,
    openConnectModal,
    refetchCollateral,
    sellCall,
    subBalances.collateral,
    market.collateral.symbol,
    market.displayName,
    market.maxSize,
    market.contracts,
    market.enabled,
    multiplier,
    selectedMarketId,
    unavailableReason,
  ]);

  const handleAcceptQuote = useCallback(async () => {
    const submitted = frozenOrder;
    const subId = preparedSubaccountId;
    if (!submitted || subId === null || !address) return;

    try {
      const result = await sellCall.acceptQuote();
      addTrade({
        address,
        chainId: result.chainId,
        marketId: selectedMarketId,
        subaccountId: subId.toString(),
        instrumentName: result.instrumentName,
        strike: submitted.strike.strike,
        expiry: submitted.strike.expiry,
        amount: submitted.amount.toString(),
        premium: result.totalPremium.toFixed(2),
        txHash: result.txHash,
        createdAt: Date.now(),
      });
      refetchPositions();
      setDoneInfo({
        premium: result.totalPremium,
        txUrl: explorerTxUrl(result.txHash, result.chainId),
      });
      toast.success(
        `Covered call created. Gross premium: $${result.totalPremium.toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [
    addTrade,
    address,
    frozenOrder,
    preparedSubaccountId,
    refetchPositions,
    sellCall,
    selectedMarketId,
  ]);

  const handleCreateAnother = useCallback(() => {
    sellCall.reset();
    setAmount(selectedMarketId === "BTC" ? DEFAULT_AMOUNT : "1");
    setSelectedStrike(null);
    setSelectedStrikeSnapshot(null);
    setFrozenOrder(null);
    setFrozenMarketStrikes(null);
    setPreparedSubaccountId(null);
    setDoneInfo(null);
    setSetupPhase("idle");
  }, [selectedMarketId, sellCall, setAmount]);

  return (
    <div className="relative min-w-0 border-b-[0.5px] border-zinc-200 pb-20 min-[960px]:pb-0">
      <MarketSelector
        markets={markets}
        selectedMarketId={selectedMarketId}
        disabled={controlsLocked}
        onMarketChange={handleMarketChange}
      />

      <div className="grid min-w-0 min-[960px]:grid-cols-[minmax(0,1fr)_360px]">
        <TradeConfigurator
          expiries={expiries}
          activeExpiry={activeExpiry}
          strikes={configuratorStrikes}
          selectedStrike={configuratorStrike}
          spotPrice={configuratorSpot}
          history={selectedMarketId === "BTC" ? history.data ?? [] : []}
          historyState={
            selectedMarketId !== "BTC"
              ? "unavailable"
              : (history.data?.length ?? 0) >= 2
                ? "ready"
                : history.isLoading
                  ? "loading"
                  : "unavailable"
          }
          isLoading={isLoading}
          markets={markets}
          selectedMarketId={selectedMarketId}
          marketUnavailable={isUnavailable}
          unavailableReason={unavailableReason}
          disabled={controlsLocked}
          coveredAmount={amountNumber}
          onExpiryChange={handleExpiryChange}
          onStrikeSelect={handleStrikeSelect}
        />

        {displayOrder ? (
          <OrderTicket
            key={displayOrder.strike.instrumentName}
            snapshot={displayOrder}
            amount={amount}
            balance={balance}
            maxAmount={market.maxSize}
            hasSubaccount={subaccountId !== null}
            depositedBalance={subBalances.collateral}
            isConnected={isConnected}
            setupPhase={setupPhase}
            sellPhase={sellCall.phase}
            auction={sellCall.auction}
            quote={sellCall.quote}
            error={sellCall.error}
            doneInfo={doneInfo}
            feeReadState={feeReadState}
            controlsDisabled={controlsLocked}
            onAmountChange={(value) => {
              if (!controlsLocked) setAmount(sanitizeDecimal(value));
            }}
            onRequestQuote={() => void handleRequestQuote()}
            onAcceptQuote={() => void handleAcceptQuote()}
            onCreateAnother={handleCreateAnother}
          />
        ) : (
          <aside className="flex min-h-64 items-center border-t-[0.5px] border-zinc-200 py-8 text-sm text-zinc-500 min-[960px]:border-l-[0.5px] min-[960px]:border-t-0 min-[960px]:pl-10">
            Waiting for {market.displayName} market data…
          </aside>
        )}
      </div>

      {displayOrder && (
        <a
          href="#order-review"
          className="fixed inset-x-0 bottom-0 z-30 flex min-h-[72px] items-center justify-between gap-4 border-t-[0.5px] border-zinc-200 bg-white/95 px-5 pb-[env(safe-area-inset-bottom)] backdrop-blur-[8px] min-[960px]:hidden"
        >
          <span className="min-w-0">
            <span className="block font-mono text-[11px] text-zinc-500">{formatMobileStrike(displayOrder.strike.strike)} cap · {displayOrder.amount > 0 ? `${displayOrder.amount.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${market.collateral.symbol}` : "choose amount"}</span>
            <span className="mt-1 block text-sm font-semibold text-zinc-950">Review trade</span>
          </span>
          <span className="shrink-0 rounded-[5px] bg-zinc-950 px-4 py-2.5 font-mono text-[11px] uppercase text-white">Review</span>
        </a>
      )}
    </div>
  );
}

function formatMobileStrike(strike: number): string {
  return strike.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}
