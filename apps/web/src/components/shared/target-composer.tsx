"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { toast } from "sonner";
import { useAccount } from "wagmi";
import {
  ContractBrowser,
  MobileOrderSheet,
  OrderTicket,
  type CompletedTradeInfo,
  type OrderSnapshot,
  type SetupPhase,
} from "@/components/trade/covered-call-ui";
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

const DEFAULT_AMOUNT = "0.05";

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

function useDesktopLayout(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return isDesktop;
}

export default function TargetComposer({
  variant = "landing",
  onReviewModeChange,
}: {
  variant?: "landing" | "borrow";
  onReviewModeChange?: (reviewMode: boolean) => void;
}) {
  const isDesktop = useDesktopLayout();
  const { isConnected, address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const [amount, setAmount] = useState(DEFAULT_AMOUNT);
  const [selectedExpiry, setSelectedExpiry] = useState<number | null>(null);
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [selectedStrikeSnapshot, setSelectedStrikeSnapshot] =
    useState<StrikeOption | null>(null);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [setupPhase, setSetupPhase] = useState<SetupPhase>("idle");
  const [frozenOrder, setFrozenOrder] = useState<OrderSnapshot | null>(null);
  const [preparedSubaccountId, setPreparedSubaccountId] = useState<bigint | null>(null);
  const [doneInfo, setDoneInfo] = useState<CompletedTradeInfo | null>(null);
  const [returnFocus, setReturnFocus] = useState<HTMLButtonElement | null>(null);

  const {
    expiries,
    selectedExpiry: activeExpiry,
    strikes,
    spotPrice,
    isLoading,
  } = useAvailableStrikes(selectedExpiry);
  const { subaccountId, ensureSubaccount } = useCoveredCallSubaccount();
  const depositBtcb = useDepositBtcb();
  const sellCall = useSellCall();
  const { balanceNumber: walletBtcb, refetch: refetchBtcb } = useBtcbBalance();
  const { balances: subBalances, refetch: refetchPositions } =
    usePositionMonitor(subaccountId);
  const { addTrade } = useCoveredCallStore();

  const balance = walletBtcb + subBalances.btcb;
  const amountNumber = Math.max(0, Number.parseFloat(amount) || 0);
  const liveSelectedStrike =
    strikes.find((strike) => strike.strike === selectedStrike) ?? null;
  const selectedStrikeData = liveSelectedStrike ?? selectedStrikeSnapshot;
  const browserStrikes = useMemo(() => {
    if (
      selectedStrikeSnapshot === null ||
      selectedStrikeSnapshot.expiry !== activeExpiry ||
      strikes.some(
        (strike) => strike.instrumentName === selectedStrikeSnapshot.instrumentName,
      )
    ) {
      return strikes;
    }
    return [...strikes, selectedStrikeSnapshot].sort(
      (left, right) => left.strike - right.strike,
    );
  }, [activeExpiry, selectedStrikeSnapshot, strikes]);

  const currentOrder = useMemo<OrderSnapshot | null>(() => {
    if (!selectedStrikeData || activeExpiry === null) return null;
    return {
      amount: amountNumber,
      strike: selectedStrikeData,
      expiryLabel: expiryLabel(activeExpiry),
      spotPrice,
      indicativeTotalPremium: selectedStrikeData.premium * amountNumber,
    };
  }, [activeExpiry, amountNumber, selectedStrikeData, spotPrice]);
  const displayOrder = frozenOrder ?? currentOrder;

  const sellBusy = [
    "requesting",
    "auction",
    "quoted",
    "signing",
    "executing",
    "done",
  ].includes(sellCall.phase);
  const controlsLocked = setupPhase !== "idle" || sellBusy || doneInfo !== null;
  const closePrevented =
    setupPhase !== "idle" ||
    sellCall.phase === "signing" ||
    sellCall.phase === "executing";

  const setExpanded = useCallback(
    (expanded: boolean) => {
      setTicketOpen(expanded);
      onReviewModeChange?.(expanded);
    },
    [onReviewModeChange],
  );

  const handleExpiryChange = useCallback(
    (expiry: number) => {
      if (controlsLocked) return;
      sellCall.reset();
      setFrozenOrder(null);
      setDoneInfo(null);
      setSelectedExpiry(expiry);
      setSelectedStrike(null);
      setSelectedStrikeSnapshot(null);
      setExpanded(false);
    },
    [controlsLocked, sellCall, setExpanded],
  );

  const handleStrikeSelect = useCallback(
    (strike: number, trigger: HTMLButtonElement) => {
      if (controlsLocked) {
        if (strike === selectedStrike && displayOrder !== null) {
          setReturnFocus(trigger);
          setExpanded(true);
        }
        return;
      }
      const strikeSnapshot =
        strikes.find((option) => option.strike === strike) ??
        (selectedStrikeSnapshot?.strike === strike
          ? selectedStrikeSnapshot
          : null);
      if (strikeSnapshot === null) return;
      setReturnFocus(trigger);
      sellCall.reset();
      setFrozenOrder(null);
      setDoneInfo(null);
      setSelectedStrike(strike);
      setSelectedStrikeSnapshot(strikeSnapshot);
      setExpanded(true);
    },
    [
      controlsLocked,
      displayOrder,
      selectedStrike,
      selectedStrikeSnapshot,
      sellCall,
      setExpanded,
      strikes,
    ],
  );

  const handleCloseTicket = useCallback(() => {
    if (closePrevented) return;
    setExpanded(false);
  }, [closePrevented, setExpanded]);

  const handleSheetOpenChange = useCallback(
    (open: boolean) => {
      if (!open && closePrevented) return;
      setExpanded(open);
    },
    [closePrevented, setExpanded],
  );

  const handleRequestQuote = useCallback(async () => {
    if (!isConnected || !address) {
      openConnectModal?.();
      return;
    }
    const order = currentOrder ?? frozenOrder;
    if (!order || amountNumber <= 0) {
      toast.error("Enter the BTCB amount you want to cover");
      return;
    }
    if (amountNumber > balance) {
      toast.error("Not enough BTCB for this covered call");
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
    setDoneInfo(null);

    try {
      setSetupPhase("subaccount");
      const subId = await ensureSubaccount();
      setPreparedSubaccountId(subId);

      const deficit = amountNumber - subBalances.btcb;
      if (deficit > 0) {
        setSetupPhase("deposit");
        await depositBtcb(subId, toUnit(deficit.toFixed(18)));
        refetchBtcb();
      }

      setSetupPhase("idle");
      await sellCall.requestQuote({
        subaccountId: subId,
        expiry: submitted.strike.expiry,
        strike: submitted.strike.strike,
        amount: submitted.amount.toString(),
        instrumentName: submitted.strike.instrumentName,
      });
    } catch (error) {
      setSetupPhase("idle");
      setFrozenOrder(null);
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [
    address,
    amountNumber,
    balance,
    currentOrder,
    depositBtcb,
    ensureSubaccount,
    frozenOrder,
    isConnected,
    openConnectModal,
    refetchBtcb,
    sellCall,
    subBalances.btcb,
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
        `Covered call created. You received $${result.totalPremium.toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
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
  ]);

  const handleCreateAnother = useCallback(() => {
    sellCall.reset();
    setAmount(DEFAULT_AMOUNT);
    setSelectedStrike(null);
    setSelectedStrikeSnapshot(null);
    setFrozenOrder(null);
    setPreparedSubaccountId(null);
    setDoneInfo(null);
    setSetupPhase("idle");
    setExpanded(false);
  }, [sellCall, setExpanded]);

  const ticket = displayOrder ? (
    <OrderTicket
      key={displayOrder.strike.instrumentName}
      snapshot={displayOrder}
      amount={amount}
      balance={balance}
      isConnected={isConnected}
      amountLocked={controlsLocked}
      setupPhase={setupPhase}
      sellPhase={sellCall.phase}
      auction={sellCall.auction}
      quote={sellCall.quote}
      error={sellCall.error}
      doneInfo={doneInfo}
      onAmountChange={(value) => {
        if (!controlsLocked) setAmount(sanitizeDecimal(value));
      }}
      onClose={handleCloseTicket}
      onRequestQuote={() => void handleRequestQuote()}
      onAcceptQuote={() => void handleAcceptQuote()}
      onCreateAnother={handleCreateAnother}
    />
  ) : null;

  return (
    <div
      className={cn(
        "w-full min-w-0",
        ticketOpen && isDesktop && "grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(460px,1.1fr)] lg:items-start",
      )}
    >
      <ContractBrowser
        title={variant === "landing" ? "Target Composer" : "Hedge Composer"}
        expiries={expiries}
        activeExpiry={activeExpiry}
        strikes={browserStrikes}
        selectedStrike={selectedStrike}
        spotPrice={spotPrice}
        isLoading={isLoading}
        disabled={controlsLocked}
        onExpiryChange={handleExpiryChange}
        onStrikeSelect={handleStrikeSelect}
      />

      {ticketOpen && isDesktop && ticket}
      {!isDesktop && (
        <MobileOrderSheet
          open={ticketOpen && ticket !== null}
          onOpenChange={handleSheetOpenChange}
          preventClose={closePrevented}
          returnFocus={returnFocus}
        >
          {ticket}
        </MobileOrderSheet>
      )}
    </div>
  );
}
