"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Info,
  MoveRight,
  Plus,
  Target,
  TrendingUp,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import type {
  AuctionState,
  PreparedQuote,
  SellPhase,
} from "@/hooks/protocol/useSellCall";
import type {
  ExpiryInfo,
  StrikeOption,
} from "@/hooks/protocol/useAvailableStrikes";
import {
  calculateCoveredCallScenario,
  scenarioRange,
} from "@/lib/protocol/covered-call-scenario";
import { amountExceedsLimit } from "@/lib/protocol/units";
import { cn } from "@/lib/utils";
import type { AppMarket, MarketId } from "@/lib/protocol/markets";

export type SetupPhase = "idle" | "subaccount" | "deposit";

export interface CompletedTradeInfo {
  premium: number;
  txUrl: string;
}

export interface OrderSnapshot {
  amount: number;
  strike: StrikeOption;
  expiryLabel: string;
  spotPrice: number;
  indicativeTotalPremium: number;
  marketId?: MarketId;
  assetName?: string;
  collateralSymbol?: string;
}

export function formatUsd(value: number, maximumFractionDigits = 0): string {
  if (!Number.isFinite(value)) return "$0";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits,
  });
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${value.toFixed(Math.abs(value) >= 10 ? 0 : 1)}%`;
}

function shortExpiry(epoch: number): string {
  return new Date(epoch * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function dte(epoch: number): number {
  return Math.max(0, Math.ceil((epoch * 1000 - Date.now()) / 86_400_000));
}

function LiveIndicator({ active, symbol = "BTC" }: { active: boolean; symbol?: string }) {
  return (
    <div className="flex items-center gap-2 font-mono text-xs text-zinc-700">
      <span className="relative flex size-2">
        <span
          className={cn(
            "absolute inset-0 rounded-full bg-green-500",
            active && "motion-safe:animate-ping",
          )}
        />
        <span className="relative size-2 rounded-full bg-green-500" />
      </span>
      {symbol} live
    </div>
  );
}

export function ContractBrowser({
  title,
  expiries,
  activeExpiry,
  strikes,
  selectedStrike,
  spotPrice,
  isLoading,
  disabled,
  onExpiryChange,
  onStrikeSelect,
  markets = [],
  selectedMarketId = "BTC",
  onMarketChange,
  marketUnavailable = false,
  unavailableReason,
}: {
  title: string;
  expiries: ExpiryInfo[];
  activeExpiry: number | null;
  strikes: StrikeOption[];
  selectedStrike: number | null;
  spotPrice: number;
  isLoading: boolean;
  disabled: boolean;
  onExpiryChange: (expiry: number) => void;
  onStrikeSelect: (strike: number, trigger: HTMLButtonElement) => void;
  markets?: AppMarket[];
  selectedMarketId?: MarketId;
  onMarketChange?: (marketId: MarketId) => void;
  marketUnavailable?: boolean;
  unavailableReason?: string | null;
}) {
  const fallbackPricing = strikes.some((strike) => strike.usedFallback);
  const selectedMarket = markets.find((market) => market.id === selectedMarketId);
  const assetName = selectedMarket?.displayName ?? "Bitcoin";
  const collateralSymbol = selectedMarket?.collateral.symbol ?? "BTCB";

  return (
    <AsideCard className="relative z-10 min-w-0 rounded-lg border-[0.5px] border-zinc-200 bg-white shadow-[0_0_30px_0_rgba(0,0,0,0.05)]">
      <AsideHeader className="min-h-14 rounded-t-lg bg-zinc-100 px-5 py-4 pr-[1.875rem]">
        <AsideTitle>{title}</AsideTitle>
        <LiveIndicator active={isLoading} symbol={selectedMarketId} />
      </AsideHeader>

      <AsideContent className="p-5 sm:p-6 lg:p-[1.875rem]">
        <div className="flex flex-col gap-5">
          {markets.length > 0 && (
            <div className="flex flex-col gap-2">
              <Text variant="body-small" className="text-zinc-500">Asset</Text>
              <div role="listbox" aria-label="Covered call asset" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-thin">
                {markets.map((market) => {
                  const selected = market.id === selectedMarketId;
                  return (
                    <button
                      key={market.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      disabled={disabled}
                      onClick={() => onMarketChange?.(market.id)}
                      className={cn(
                        "min-h-11 shrink-0 rounded-full border-[0.5px] px-4 font-mono text-xs transition-colors disabled:opacity-60",
                        selected ? "border-orange-500 bg-orange-50 text-orange-700" : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400",
                      )}
                    >
                      {market.displayName}
                      {!market.enabled && <span className="ml-2 text-[9px] uppercase opacity-60">Soon</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {selectedMarket?.collateral.scaledUi && (
            <div className="rounded-[5px] border-[0.5px] border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-[10px] text-zinc-600">
              Tokenized exposure · bStocks · amounts use the token&apos;s current UI multiplier
            </div>
          )}

          <div className="flex items-start justify-between gap-4">
            <div>
              <Text as="h2" variant="h4" className="text-zinc-950">
                Choose your covered call
              </Text>
              <Text variant="body-small" className="mt-1 text-zinc-500">
                Select an expiry, then choose how high {assetName} can go.
              </Text>
            </div>
            <span className="shrink-0 rounded-[5px] bg-zinc-100 px-3 py-2 font-mono text-xs text-zinc-700">
              Sell call
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <Text variant="body-small" className="text-zinc-500">
              Expiry
            </Text>
            <div
              role="tablist"
              aria-label="Covered call expiry"
              className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-thin"
            >
              {expiries.map((expiry) => {
                const selected = expiry.epoch === activeExpiry;
                return (
                  <button
                    key={expiry.epoch}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    disabled={disabled}
                    onClick={() => onExpiryChange(expiry.epoch)}
                    className={cn(
                      "min-h-12 min-w-[92px] shrink-0 rounded-full border-[0.5px] px-4 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                      selected
                        ? "border-orange-500 bg-orange-50 text-orange-700"
                        : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400",
                    )}
                  >
                    <span className="block font-mono text-xs font-medium">
                      {shortExpiry(expiry.epoch)}
                    </span>
                    <span className="block font-mono text-[10px] opacity-70">
                      {dte(expiry.epoch)} DTE
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Text variant="body-small" className="text-zinc-700">
                Available strikes
              </Text>
              <Text variant="terminal-small" className="mt-0.5 text-zinc-500">
                Indicative · final premium comes from live RFQ
              </Text>
            </div>
            {fallbackPricing && (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 font-mono text-[10px] text-amber-700">
                Estimated feed
              </span>
            )}
          </div>

          <div className="overflow-hidden rounded-[5px] border-[0.5px] border-zinc-200">
            <div className="flex min-h-11 items-center justify-between bg-zinc-100 px-4 font-mono text-xs text-zinc-600">
              <span>{selectedMarketId} spot</span>
              <span className="font-medium text-zinc-950">
                {spotPrice > 0 ? formatUsd(spotPrice, 2) : "Loading"}
              </span>
            </div>

            <div className="max-h-[420px] overflow-y-auto bg-white scrollbar-thin">
              {isLoading ? (
                <div className="space-y-px bg-zinc-100">
                  {[0, 1, 2, 3].map((key) => (
                    <div
                      key={key}
                      className="h-[78px] animate-pulse bg-white p-4"
                    >
                      <div className="h-3 w-24 rounded bg-zinc-100" />
                      <div className="mt-3 h-2.5 w-36 rounded bg-zinc-100" />
                    </div>
                  ))}
                </div>
              ) : marketUnavailable ? (
                <BrowserMessage>
                  {unavailableReason ?? `${assetName} is staged and will appear here after its oracle, collateral, and maker are enabled.`}
                </BrowserMessage>
              ) : spotPrice <= 0 ? (
                <BrowserMessage>
                  {assetName} pricing is unavailable. Check the oracle feed and try again.
                </BrowserMessage>
              ) : strikes.length === 0 ? (
                <BrowserMessage>No strikes are available for this expiry yet.</BrowserMessage>
              ) : (
                <div className="divide-y divide-zinc-100">
                  {strikes.map((strike) => {
                    const selected = strike.strike === selectedStrike;
                    return (
                      <button
                        key={strike.instrumentName}
                        type="button"
                        disabled={disabled && !selected}
                        aria-pressed={selected}
                        aria-label={`${disabled && selected ? "Reopen" : "Select"} ${formatUsd(strike.strike)} strike, ${formatUsd(strike.premium, 2)} premium per ${selectedMarketId}`}
                        onClick={(event) =>
                          onStrikeSelect(strike.strike, event.currentTarget)
                        }
                        className={cn(
                          "flex min-h-[78px] w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                          selected ? "bg-orange-50" : "bg-white hover:bg-zinc-50",
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block font-heading text-base font-bold text-zinc-950">
                            {formatUsd(strike.strike)} strike
                          </span>
                          <span className="mt-1 flex flex-wrap gap-x-3 font-mono text-[11px] text-zinc-500">
                            <span>+{formatPercent(strike.otmPercent)} above spot</span>
                            <span>{formatPercent(strike.apr)} APR</span>
                          </span>
                        </span>
                        <span className="inline-flex min-h-11 shrink-0 items-center overflow-hidden rounded-full border border-orange-500 text-orange-600">
                          <span className="px-3 font-mono text-xs font-medium">
                            {formatUsd(strike.premium, strike.premium >= 100 ? 0 : 2)}
                          </span>
                          <span className="flex min-h-11 w-10 items-center justify-center border-l border-orange-500">
                            <Plus className="size-4" />
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <Text variant="terminal-small" className="text-zinc-500">
            Premiums are shown per {selectedMarketId}. Enter your {collateralSymbol} amount after selecting a strike.
          </Text>
        </div>
      </AsideContent>
    </AsideCard>
  );
}

function BrowserMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-36 items-center justify-center px-6 text-center">
      <Text variant="body-small" className="max-w-sm text-zinc-500">
        {children}
      </Text>
    </div>
  );
}

export function MobileOrderSheet({
  open,
  onOpenChange,
  preventClose,
  returnFocus,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preventClose: boolean;
  returnFocus?: HTMLElement | null;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-zinc-950/35 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=open]:animate-in" />
        <Dialog.Content
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => {
            if (preventClose) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (preventClose) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            if (!returnFocus) return;
            event.preventDefault();
            returnFocus.focus();
          }}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[94dvh] flex-col overflow-hidden rounded-t-[14px] border-[0.5px] border-zinc-200 bg-white shadow-[0_-18px_50px_rgba(9,9,11,0.14)] focus:outline-none"
        >
          <Dialog.Title className="sr-only">Covered call order ticket</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function OrderTicket({
  snapshot,
  amount,
  balance,
  maxAmount,
  isConnected,
  amountLocked,
  setupPhase,
  sellPhase,
  auction,
  quote,
  error,
  doneInfo,
  onAmountChange,
  onClose,
  onRequestQuote,
  onAcceptQuote,
  onCreateAnother,
}: {
  snapshot: OrderSnapshot;
  amount: string;
  balance: number;
  maxAmount: string;
  isConnected: boolean;
  amountLocked: boolean;
  setupPhase: SetupPhase;
  sellPhase: SellPhase;
  auction: AuctionState | null;
  quote: PreparedQuote | null;
  error: string | null;
  doneInfo: CompletedTradeInfo | null;
  onAmountChange: (amount: string) => void;
  onClose: () => void;
  onRequestQuote: () => void;
  onAcceptQuote: () => void;
  onCreateAnother: () => void;
}) {
  const assetSymbol = snapshot.marketId ?? "BTC";
  const assetName = snapshot.assetName ?? "Bitcoin";
  const collateralSymbol = snapshot.collateralSymbol ?? "BTCB";
  const amountNumber = Math.max(0, Number.parseFloat(amount) || 0);
  const indicativeTotal = snapshot.strike.premium * amountNumber;
  const executableQuote =
    quote !== null &&
    ["quoted", "signing", "executing", "done"].includes(sellPhase)
      ? quote
      : null;
  const displayPremium = executableQuote?.totalPremium ?? indicativeTotal;
  const insufficient = isConnected && amountNumber > balance;
  const exceedsMaximum = amountExceedsLimit(amount || "0", maxAmount);
  const busy =
    setupPhase !== "idle" ||
    ["requesting", "auction", "signing", "executing"].includes(sellPhase);
  const [scenarioPrice, setScenarioPrice] = useState(
    () => snapshot.spotPrice,
  );

  const range = useMemo(
    () => scenarioRange(snapshot.spotPrice),
    [snapshot.spotPrice],
  );
  const scenario = useMemo(
    () =>
      calculateCoveredCallScenario({
        spotPrice: snapshot.spotPrice,
        strikePrice: snapshot.strike.strike,
        expiryPrice: scenarioPrice,
        amount: amountNumber,
        totalPremium: displayPremium,
      }),
    [amountNumber, displayPremium, scenarioPrice, snapshot],
  );
  const strikeMarker = Math.min(
    100,
    Math.max(
      0,
      ((snapshot.strike.strike - range.min) / (range.max - range.min || 1)) *
        100,
    ),
  );
  const spotMarker = Math.min(
    100,
    Math.max(
      0,
      ((snapshot.spotPrice - range.min) / (range.max - range.min || 1)) * 100,
    ),
  );

  const primary = primaryAction({
    isConnected,
    amountNumber,
    insufficient,
    exceedsMaximum,
    setupPhase,
    sellPhase,
    done: doneInfo !== null,
    collateralSymbol,
  });

  const handlePrimary = () => {
    if (doneInfo) {
      onCreateAnother();
    } else if (sellPhase === "quoted") {
      onAcceptQuote();
    } else {
      onRequestQuote();
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-white lg:overflow-hidden lg:rounded-lg lg:border-[0.5px] lg:border-zinc-200 lg:shadow-[0_0_30px_0_rgba(0,0,0,0.05)]">
      <div className="flex min-h-14 items-center justify-between border-b-[0.5px] border-zinc-200 bg-zinc-100 px-5 py-3">
        <button
          type="button"
          onClick={onClose}
          disabled={sellPhase === "signing" || sellPhase === "executing"}
          className="inline-flex min-h-11 items-center gap-2 font-mono text-xs text-zinc-500 transition-colors hover:text-zinc-950 disabled:opacity-40"
        >
          <ArrowLeft className="size-4" />
          Back
        </button>
        <div className="text-center">
          <Text variant="terminal-small" className="text-zinc-950">
            Order ticket
          </Text>
          <Text variant="terminal-small" className="text-zinc-500">
            Covered call
          </Text>
        </div>
        <button
          type="button"
          aria-label="Close order ticket"
          onClick={onClose}
          disabled={sellPhase === "signing" || sellPhase === "executing"}
          className="flex size-11 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-200 hover:text-zinc-950 disabled:opacity-40"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6 lg:p-7 scrollbar-thin">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
          <div>
            <Text as="h2" variant="h3" className="text-zinc-950">
              Sell {assetName} higher
            </Text>
            <Text variant="body-small" className="mt-1 text-zinc-500">
              {shortExpiry(snapshot.strike.expiry)} · {dte(snapshot.strike.expiry)} DTE · {formatUsd(snapshot.strike.strike)} strike
            </Text>
          </div>

          <CurrencyField size="large">
            <CurrencyField.Label>How much {collateralSymbol} will you cover?</CurrencyField.Label>
            <CurrencyField.Control
              disabled={amountLocked}
              value={amount}
              onChange={onAmountChange}
              prefix=""
              hasError={insufficient || exceedsMaximum}
              subtitle={`Available ${balance.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${collateralSymbol}`}
              trailing={
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    disabled={amountLocked || balance <= 0}
                    onClick={() =>
                      onAmountChange(
                        Math.min(balance, Number.parseFloat(maxAmount))
                          .toFixed(18)
                          .replace(/\.?0+$/, ""),
                      )
                    }
                    className="min-h-11 rounded-[5px] border-[0.5px] border-zinc-200 px-3 font-mono text-xs text-zinc-600 hover:border-orange-400 hover:text-orange-600 disabled:opacity-40"
                  >
                    MAX
                  </button>
                  <span className="flex min-h-11 items-center gap-2 rounded-[5px] bg-zinc-100 px-3 text-sm text-zinc-800">
                    <TokenIcon symbol={assetSymbol} size={22} /> {collateralSymbol}
                  </span>
                </div>
              }
            />
          </CurrencyField>

          {insufficient && (
            <Text role="alert" variant="terminal-small" className="text-red-600">
              Enter an amount no greater than your available {collateralSymbol} balance.
            </Text>
          )}

          {!insufficient && exceedsMaximum && (
            <Text role="alert" variant="terminal-small" className="text-red-600">
              Maximum order size is {maxAmount} {collateralSymbol}.
            </Text>
          )}

          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[5px] border-[0.5px] border-zinc-200 bg-zinc-200 sm:grid-cols-4">
            <TicketMetric label="Strike" value={formatUsd(snapshot.strike.strike)} />
            <TicketMetric
              label="Above spot"
              value={`+${formatPercent(snapshot.strike.otmPercent)}`}
            />
            <TicketMetric
              label={executableQuote ? "Executable premium" : "Indicative premium"}
              value={formatUsd(displayPremium, 2)}
              accent={executableQuote !== null}
            />
            <TicketMetric label="Projected APR" value={formatPercent(snapshot.strike.apr)} />
          </div>

          {(setupPhase !== "idle" || sellPhase === "requesting") && (
            <StatusPanel
              icon={<MoveRight className="size-4" />}
              title={
                setupPhase === "subaccount"
                  ? "Creating your covered-call account"
                  : setupPhase === "deposit"
                    ? `Depositing ${collateralSymbol} collateral`
                    : "Opening the RFQ auction"
              }
              text="Keep this window open while the transaction is prepared."
            />
          )}

          {sellPhase === "auction" && auction && (
            <AuctionPanel auction={auction} />
          )}

          {quote && ["quoted", "signing", "executing", "expired"].includes(sellPhase) && (
            <ExecutableQuotePanel
              quote={quote}
              indicativeTotal={snapshot.indicativeTotalPremium}
              expired={sellPhase === "expired"}
              assetSymbol={assetSymbol}
            />
          )}

          {error && sellPhase === "error" && (
            <div role="alert" className="rounded-[5px] border-[0.5px] border-red-200 bg-red-50 p-4">
              <Text variant="body-small" className="text-red-700">
                {error}
              </Text>
            </div>
          )}

          {doneInfo && (
            <div className="rounded-[5px] border-[0.5px] border-green-200 bg-green-50 p-5">
              <div className="flex items-center gap-3 text-green-700">
                <CheckCircle2 className="size-5" />
                <Text variant="h5" className="text-green-800">
                  Covered call created
                </Text>
              </div>
              <Text variant="body-small" className="mt-2 text-green-800">
                You received {formatUsd(doneInfo.premium, 2)} in premium.
              </Text>
              <a
                href={doneInfo.txUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex min-h-11 items-center font-mono text-xs text-green-800 underline underline-offset-4"
              >
                View transaction
              </a>
            </div>
          )}

          <ExpirySimulator
            spotPrice={snapshot.spotPrice}
            strikePrice={snapshot.strike.strike}
            amount={amountNumber}
            premium={displayPremium}
            scenarioPrice={scenarioPrice}
            onScenarioPriceChange={setScenarioPrice}
            range={range}
            spotMarker={spotMarker}
            strikeMarker={strikeMarker}
            settlementPayment={scenario.settlementPayment}
            coveredPositionValue={scenario.coveredPositionValue}
            isAboveStrike={scenario.isAboveStrike}
            assetName={assetName}
            assetSymbol={assetSymbol}
            collateralSymbol={collateralSymbol}
          />

          <div className="rounded-[5px] bg-zinc-50 p-4">
            <div className="flex items-start gap-3">
              <Info className="mt-0.5 size-4 shrink-0 text-zinc-500" />
              <Text variant="body-small" className="text-zinc-600">
                Your {collateralSymbol} remains in the covered-call subaccount. If {assetName} settles above the strike, the gain above the strike is offset through USDT cash settlement.
              </Text>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t-[0.5px] border-zinc-200 bg-white/95 px-5 py-4 backdrop-blur sm:px-6 lg:px-7">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Text variant="terminal-small" className="text-zinc-500">
              {executableQuote ? "Executable premium" : "Indicative premium"}
            </Text>
            <Text variant="h5" className="mt-0.5 text-zinc-950">
              {formatUsd(displayPremium, 2)}
            </Text>
          </div>
          <Button
            type="button"
            action
            size="lg"
            disabled={primary.disabled || busy}
            onClick={handlePrimary}
            className="w-full sm:w-auto sm:min-w-52"
          >
            {primary.label}
          </Button>
        </div>
      </div>
    </section>
  );
}

function primaryAction({
  isConnected,
  amountNumber,
  insufficient,
  exceedsMaximum,
  setupPhase,
  sellPhase,
  done,
  collateralSymbol,
}: {
  isConnected: boolean;
  amountNumber: number;
  insufficient: boolean;
  exceedsMaximum: boolean;
  setupPhase: SetupPhase;
  sellPhase: SellPhase;
  done: boolean;
  collateralSymbol: string;
}): { label: string; disabled: boolean } {
  if (done) return { label: "Create another target", disabled: false };
  if (!isConnected) return { label: "Connect wallet", disabled: false };
  if (setupPhase === "subaccount") return { label: "Creating account…", disabled: true };
  if (setupPhase === "deposit") return { label: `Depositing ${collateralSymbol}…`, disabled: true };
  if (sellPhase === "requesting") return { label: "Opening auction…", disabled: true };
  if (sellPhase === "auction") return { label: "Collecting quotes…", disabled: true };
  if (sellPhase === "quoted") return { label: "Accept & sign", disabled: false };
  if (sellPhase === "signing") return { label: "Confirm in wallet…", disabled: true };
  if (sellPhase === "executing") return { label: "Creating position…", disabled: true };
  if (sellPhase === "expired") return { label: "Get a new quote", disabled: false };
  if (sellPhase === "error") return { label: "Try again", disabled: false };
  return {
    label: "Get live quote",
    disabled: amountNumber <= 0 || insufficient || exceedsMaximum,
  };
}

function TicketMetric({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="min-w-0 bg-white p-3.5">
      <Text variant="terminal-small" className="text-zinc-500">
        {label}
      </Text>
      <Text
        variant="body-small"
        className={cn("mt-1 truncate text-zinc-950", accent && "text-orange-600")}
      >
        {value}
      </Text>
    </div>
  );
}

function StatusPanel({
  icon,
  title,
  text,
}: {
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-[5px] border-[0.5px] border-orange-200 bg-orange-50 p-4">
      <div className="flex items-center gap-2 text-orange-700">
        {icon}
        <Text variant="body-small" className="text-orange-800">
          {title}
        </Text>
      </div>
      <Text variant="terminal-small" className="mt-2 text-orange-700">
        {text}
      </Text>
    </div>
  );
}

function AuctionPanel({ auction }: { auction: AuctionState }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, []);
  const remaining = Math.max(0, (auction.endsAt - now) / 1000);

  return (
    <StatusPanel
      icon={<MoveRight className="size-4" />}
      title={`Collecting live quotes · ${remaining.toFixed(1)}s`}
      text={`${auction.quoteCount} quote${auction.quoteCount === 1 ? "" : "s"} received${auction.bestTotalPremium === null ? "" : ` · best ${formatUsd(auction.bestTotalPremium, 2)}`}`}
    />
  );
}

function ExecutableQuotePanel({
  quote,
  indicativeTotal,
  expired,
  assetSymbol,
}: {
  quote: PreparedQuote;
  indicativeTotal: number;
  expired: boolean;
  assetSymbol: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.ceil((quote.acceptBy - now) / 1000));
  const difference = quote.totalPremium - indicativeTotal;

  return (
    <div
      className={cn(
        "rounded-[5px] border-[0.5px] p-5",
        expired
          ? "border-zinc-200 bg-zinc-50"
          : "border-orange-300 bg-orange-50",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <Text variant="terminal-small" className="text-zinc-500">
            {expired ? "Quote expired" : "Winning executable quote"}
          </Text>
          <Text variant="h3" className="mt-1 text-zinc-950">
            {formatUsd(quote.totalPremium, 2)}
          </Text>
          <Text variant="terminal-small" className="mt-1 text-zinc-500">
            {formatUsd(quote.premium, 2)}/{assetSymbol} · {quote.quoteCount} quote{quote.quoteCount === 1 ? "" : "s"}
          </Text>
        </div>
        <span
          className={cn(
            "inline-flex min-h-9 items-center gap-2 rounded-full px-3 font-mono text-xs",
            expired ? "bg-zinc-200 text-zinc-600" : "bg-white text-orange-700",
          )}
        >
          <Clock3 className="size-3.5" />
          {expired ? "Refresh" : `${seconds}s`}
        </span>
      </div>
      <Separator className="my-4" />
      <div className="flex items-center justify-between gap-4 font-mono text-xs">
        <span className="text-zinc-500">Versus indicative</span>
        <span className={difference >= 0 ? "text-green-700" : "text-zinc-700"}>
          {difference >= 0 ? "+" : ""}{formatUsd(difference, 2)}
        </span>
      </div>
    </div>
  );
}

function ExpirySimulator({
  spotPrice,
  strikePrice,
  amount,
  premium,
  scenarioPrice,
  onScenarioPriceChange,
  range,
  spotMarker,
  strikeMarker,
  settlementPayment,
  coveredPositionValue,
  isAboveStrike,
  assetName,
  assetSymbol,
  collateralSymbol,
}: {
  spotPrice: number;
  strikePrice: number;
  amount: number;
  premium: number;
  scenarioPrice: number;
  onScenarioPriceChange: (price: number) => void;
  range: { min: number; max: number; step: number };
  spotMarker: number;
  strikeMarker: number;
  settlementPayment: number;
  coveredPositionValue: number;
  isAboveStrike: boolean;
  assetName: string;
  assetSymbol: string;
  collateralSymbol: string;
}) {
  return (
    <div className="rounded-[5px] border-[0.5px] border-zinc-200 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Text variant="terminal-small" className="text-zinc-500">
            {assetName} price at expiry
          </Text>
          <Text variant="h3" className="mt-1 text-zinc-950">
            {formatUsd(scenarioPrice)}
          </Text>
        </div>
        <div className="text-right">
          <Text variant="terminal-small" className="text-zinc-500">
            Position value + premium
          </Text>
          <Text variant="h5" className="mt-1 text-zinc-950">
            {formatUsd(coveredPositionValue, 2)}
          </Text>
        </div>
      </div>

      <div className="relative mt-8 px-1 pb-8">
        <input
          type="range"
          aria-label={`Simulated ${assetSymbol} price at expiry`}
          min={range.min}
          max={range.max}
          step={range.step}
          value={Math.min(range.max, Math.max(range.min, scenarioPrice))}
          onChange={(event) => onScenarioPriceChange(Number(event.target.value))}
          className="hedge-target-slider"
        />
        <Marker
          left={spotMarker}
          label="Spot"
          value={formatUsd(spotPrice)}
          offsetClass="top-8"
        />
        <Marker
          left={strikeMarker}
          label="Strike"
          value={formatUsd(strikePrice)}
          offsetClass="top-14"
        />
      </div>

      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <div className="rounded-[5px] bg-zinc-50 p-4">
          <div className="flex items-center gap-2 text-zinc-600">
            <Target className="size-4" />
            <Text variant="terminal-small" className="text-zinc-500">
              Settlement payment
            </Text>
          </div>
          <Text variant="h5" className="mt-2 text-zinc-950">
            {formatUsd(settlementPayment, 2)}
          </Text>
        </div>
        <div className="rounded-[5px] bg-zinc-50 p-4">
          <div className="flex items-center gap-2 text-zinc-600">
            <TrendingUp className="size-4" />
            <Text variant="terminal-small" className="text-zinc-500">
              Premium included
            </Text>
          </div>
          <Text variant="h5" className="mt-2 text-zinc-950">
            {formatUsd(premium, 2)}
          </Text>
        </div>
      </div>

      <Text variant="body-small" className="mt-4 text-zinc-600">
        {isAboveStrike
          ? `${collateralSymbol} remains held. USDT settlement offsets gains above ${formatUsd(strikePrice)} for the covered ${amount.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${collateralSymbol}.`
          : `${assetName} is below the strike, so you keep the covered ${amount.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${collateralSymbol} and the premium.`}
      </Text>
    </div>
  );
}

function Marker({
  left,
  label,
  value,
  offsetClass,
}: {
  left: number;
  label: string;
  value: string;
  offsetClass: string;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute -translate-x-1/2 text-center",
        offsetClass,
      )}
      style={{ left: `${left}%` }}
    >
      <span className="mx-auto block h-2 w-px bg-zinc-400" />
      <span className="mt-1 block whitespace-nowrap font-mono text-[9px] text-zinc-500">
        {label} {value}
      </span>
    </div>
  );
}
