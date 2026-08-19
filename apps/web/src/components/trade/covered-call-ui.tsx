"use client";

import {
  CheckCircle2,
  Clock3,
  MoveRight,
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { CurrencyField } from "@/components/shared/currency-field";
import { Button } from "@/components/ui/button";
import { MarketIcon } from "@/components/ui/MarketIcon";
import { Text } from "@/components/ui/text";
import type {
  AuctionState,
  PreparedQuote,
  SellPhase,
} from "@/hooks/protocol/useSellCall";
import type {
  ExpiryInfo,
  StrikeOption,
} from "@/hooks/protocol/useAvailableStrikes";
import type { BitcoinPriceHistoryPoint } from "@/lib/market/bitcoin-history";
import {
  calculateCoveredCallScenario,
  scenarioRange,
} from "@/lib/protocol/covered-call-scenario";
import { amountExceedsLimit } from "@/lib/protocol/units";
import { cn } from "@/lib/utils";
import type { AppMarket, MarketId } from "@/lib/protocol/markets";

export type SetupPhase = "idle" | "subaccount" | "deposit";
export type FeeReadState = "loading" | "ready" | "unavailable";

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
  estimatedOiFee?: number | null;
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

function formatTermPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  if (Math.abs(value) > 0 && Math.abs(value) < 0.1) return `${value.toFixed(2)}%`;
  return formatPercent(value);
}

function formatChartPrice(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatHistoryDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1_000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatHistoryPointLabel(point: { time: number; isCurrent: boolean }): string {
  return point.isCurrent ? "Now" : formatHistoryDate(point.time);
}

function shortExpiry(epoch: number): string {
  return new Date(epoch * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function exactExpiry(epoch: number): string {
  return `${new Date(epoch * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })} · 08:00 UTC`;
}

function dte(epoch: number): number {
  return Math.max(0, Math.ceil((epoch * 1000 - Date.now()) / 86_400_000));
}

function MarketSourceIndicator({
  isLoading,
  available,
  fallbackPricing,
}: {
  isLoading: boolean;
  available: boolean;
  fallbackPricing: boolean;
}) {
  const label = isLoading
    ? "Loading"
    : !available
      ? "Unavailable"
      : fallbackPricing
        ? "Indicative"
        : "Live inputs";
  const dot = isLoading
    ? "animate-pulse bg-zinc-400"
    : !available
      ? "bg-red-500"
      : fallbackPricing
        ? "bg-amber-500"
        : "bg-green-500";

  return (
    <div className="flex items-center justify-end gap-2 font-mono text-[11px] text-zinc-500">
      <span className={cn("size-1.5 rounded-full", dot)} />
      {label}
    </div>
  );
}

export function MarketSelector({
  markets,
  selectedMarketId,
  disabled,
  onMarketChange,
}: {
  markets: AppMarket[];
  selectedMarketId: MarketId;
  disabled: boolean;
  onMarketChange: (marketId: MarketId) => void;
}) {
  if (markets.length === 0) return null;

  return (
    <div className="flex min-h-[62px] items-end gap-7 overflow-hidden border-b-[0.5px] border-zinc-200">
      <span className="shrink-0 pb-4 font-mono text-[10px] uppercase tracking-[0.08em] text-zinc-400">
        Market
      </span>
      <div
        role="listbox"
        aria-label="Covered-call market"
        className="flex min-w-0 flex-1 gap-8 overflow-x-auto scrollbar-thin"
      >
        {markets.map((market) => {
          const active = market.id === selectedMarketId;
          return (
            <button
              key={market.id}
              type="button"
              role="option"
              aria-selected={active}
              disabled={disabled}
              onClick={() => onMarketChange(market.id)}
              className={cn(
                "relative inline-flex min-h-[61px] shrink-0 items-center gap-2 rounded-none border-0 px-0 pt-1 font-mono text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                active
                  ? "text-zinc-950 after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-orange-500 after:content-['']"
                  : "text-zinc-500 hover:text-zinc-950",
              )}
            >
              <MarketIcon marketId={market.id} size={17} />
              {market.displayName}
              {!market.enabled && (
                <span className="ml-2 text-[9px] uppercase text-zinc-400">Soon</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TradeConfigurator({
  expiries,
  activeExpiry,
  strikes,
  selectedStrike,
  spotPrice,
  history,
  historyState,
  isLoading,
  disabled,
  coveredAmount,
  onExpiryChange,
  onStrikeSelect,
  markets = [],
  selectedMarketId = "BTC",
  marketUnavailable = false,
  unavailableReason,
}: {
  expiries: ExpiryInfo[];
  activeExpiry: number | null;
  strikes: StrikeOption[];
  selectedStrike: number | null;
  spotPrice: number;
  history: BitcoinPriceHistoryPoint[];
  historyState?: "loading" | "ready" | "unavailable";
  isLoading: boolean;
  disabled: boolean;
  coveredAmount: number;
  onExpiryChange: (expiry: number) => void;
  onStrikeSelect: (strike: number) => void;
  markets?: AppMarket[];
  selectedMarketId?: MarketId;
  marketUnavailable?: boolean;
  unavailableReason?: string | null;
}) {
  const displayStrikes = strikes.filter(
    (strike) => strike.premium >= 0.01 || strike.strike === selectedStrike,
  );
  const fallbackPricing = displayStrikes.some((strike) => strike.usedFallback);
  const selectedMarket = markets.find((market) => market.id === selectedMarketId);
  const assetName = selectedMarket?.displayName ?? "Bitcoin";
  const collateralSymbol = selectedMarket?.collateral.symbol ?? "BTCB";
  const selected =
    displayStrikes.find((strike) => strike.strike === selectedStrike) ??
    displayStrikes[0] ??
    null;
  return (
    <section className="min-w-0 py-6 sm:py-8 min-[960px]:pr-10 xl:pr-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <MarketIcon marketId={selectedMarketId} size={34} />
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-zinc-500">
              {collateralSymbol} / USDT
            </p>
            <Text as="h1" variant="h4" className="mt-0.5 text-zinc-950">
              Covered calls
            </Text>
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-zinc-500">
            {selectedMarketId} spot
          </p>
          <p className="mt-1 font-mono text-base font-medium text-zinc-950">
            {spotPrice > 0 ? formatUsd(spotPrice, 2) : "Loading"}
          </p>
          <MarketSourceIndicator
            isLoading={isLoading}
            available={!marketUnavailable && spotPrice > 0 && displayStrikes.length > 0}
            fallbackPricing={fallbackPricing}
          />
        </div>
      </div>

      {selectedMarket?.collateral.scaledUi && (
        <p className="mt-4 border-l-2 border-zinc-300 pl-3 font-mono text-[10px] leading-5 text-zinc-500">
          bStocks exposure · current token multiplier
        </p>
      )}

      <div className="mt-6 border-y-[0.5px] border-zinc-200">
        <div className="flex items-center justify-between gap-4 pt-5">
          <p className="text-sm font-medium text-zinc-800">Expiry</p>
          <p className="font-mono text-[11px] text-zinc-500">Friday · 08:00 UTC</p>
        </div>
        <div
          role="tablist"
          aria-label="Covered call expiry"
          className="mt-3 flex gap-7 overflow-x-auto scrollbar-thin"
        >
          {expiries.map((expiry) => {
            const selectedExpiry = expiry.epoch === activeExpiry;
            return (
              <button
                key={expiry.epoch}
                type="button"
                role="tab"
                aria-selected={selectedExpiry}
                disabled={disabled}
                onClick={() => onExpiryChange(expiry.epoch)}
                className={cn(
                  "relative min-h-14 shrink-0 rounded-none border-0 px-0 pb-3 pt-1 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  selectedExpiry
                    ? "text-zinc-950 after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-orange-500 after:content-['']"
                    : "text-zinc-500 hover:text-zinc-950",
                )}
              >
                <span className="block text-sm font-semibold">{shortExpiry(expiry.epoch)}</span>
                <span className="mt-1 block font-mono text-[11px]">{dte(expiry.epoch)} days</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="pt-6">
        {!marketUnavailable && spotPrice > 0 && selected ? (
          <>
            <BitcoinTargetChart
              points={history}
              spotPrice={spotPrice}
              targetPrice={selected.strike}
              targetAboveSpot={selected.otmPercent}
              state={historyState}
              assetName={assetName}
              assetSymbol={selectedMarketId}
            />
            <StrikeLadder
              strikes={displayStrikes}
              selectedStrike={selected.strike}
              spotPrice={spotPrice}
              coveredAmount={coveredAmount}
              disabled={disabled}
              onStrikeSelect={onStrikeSelect}
            />
          </>
        ) : (
          <div className="mt-6 flex min-h-64 items-center justify-center border-y-[0.5px] border-zinc-100 text-sm text-zinc-500">
            <p className="max-w-md px-6 text-center leading-6">
              {marketUnavailable
                ? unavailableReason ?? `${assetName} will appear here after its oracle, collateral, and maker are enabled.`
                : isLoading
                  ? `Loading ${selectedMarketId} market data…`
                  : spotPrice <= 0
                    ? `${assetName} pricing is unavailable. Check the oracle feed and try again.`
                    : "No meaningful strikes are available for this expiry."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function StrikeLadder({
  strikes,
  selectedStrike,
  spotPrice,
  coveredAmount,
  disabled,
  onStrikeSelect,
}: {
  strikes: StrikeOption[];
  selectedStrike: number;
  spotPrice: number;
  coveredAmount: number;
  disabled: boolean;
  onStrikeSelect: (strike: number) => void;
}) {
  return (
    <div className="mt-6 border-t-[0.5px] border-zinc-200" aria-label="Available covered-call strikes">
      <div className="grid grid-cols-[minmax(118px,1.25fr)_minmax(92px,0.8fr)_minmax(84px,0.75fr)] gap-3 px-3 py-3 font-mono text-[11px] uppercase tracking-[0.05em] text-zinc-500 sm:grid-cols-[minmax(148px,1.25fr)_minmax(92px,0.75fr)_minmax(100px,0.85fr)_minmax(80px,0.65fr)_minmax(70px,0.6fr)]">
        <span>Strike</span>
        <span className="text-right">Above spot</span>
        <span className="text-right">Est. premium</span>
        <span className="hidden text-right sm:block">Return</span>
        <span className="hidden text-right sm:block">APR</span>
      </div>
      {strikes.map((strike) => {
        const selected = strike.strike === selectedStrike;
        const termReturn = spotPrice > 0 ? (strike.premium / spotPrice) * 100 : 0;
        const totalPremium = strike.premium * coveredAmount;
        return (
          <button
            key={strike.instrumentName}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onStrikeSelect(strike.strike)}
            className={cn(
              "relative grid min-h-[62px] w-full grid-cols-[minmax(118px,1.25fr)_minmax(92px,0.8fr)_minmax(84px,0.75fr)] items-center gap-3 border-t-[0.5px] px-3 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 sm:grid-cols-[minmax(148px,1.25fr)_minmax(92px,0.75fr)_minmax(100px,0.85fr)_minmax(80px,0.65fr)_minmax(70px,0.6fr)]",
              selected
                ? "border-zinc-200 bg-orange-50/55"
                : "border-zinc-100 hover:bg-zinc-50",
            )}
          >
            {selected && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-orange-500" />}
            <span className="font-mono text-sm font-medium text-zinc-950">{formatUsd(strike.strike)}</span>
            <span className="text-right font-mono text-[12px] text-zinc-600">+{formatPercent(strike.otmPercent)}</span>
            <span className="text-right font-mono text-[12px] font-medium text-zinc-950">
              {coveredAmount > 0 ? formatUsd(totalPremium, 2) : "—"}
            </span>
            <span className="hidden text-right font-mono text-[12px] text-zinc-600 sm:block">{formatTermPercent(termReturn)}</span>
            <span className="hidden text-right font-mono text-[12px] text-zinc-600 sm:block">{formatPercent(strike.apr)}</span>
          </button>
        );
      })}
    </div>
  );
}

export function BitcoinTargetChart({
  points,
  spotPrice,
  targetPrice,
  targetAboveSpot,
  state,
  assetName = "Bitcoin",
  assetSymbol = "BTC",
}: {
  points: BitcoinPriceHistoryPoint[];
  spotPrice: number;
  targetPrice: number;
  targetAboveSpot: number;
  state?: "loading" | "ready" | "unavailable";
  assetName?: string;
  assetSymbol?: string;
}) {
  const descriptionId = useId();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const validPoints = useMemo(
    () =>
      points.filter(
        (point) =>
          Number.isFinite(point.time) &&
          point.time > 0 &&
          Number.isFinite(point.value) &&
          point.value > 0,
      ),
    [points],
  );
  const geometry = useMemo(
    () =>
      validPoints.length > 1
        ? chartGeometry(validPoints, spotPrice, targetPrice)
        : null,
    [validPoints, spotPrice, targetPrice],
  );
  const accessibleLabel = `${assetName} 30-day price history. Current spot ${formatUsd(spotPrice)}. Selected covered-call strike ${formatUsd(targetPrice)}, ${formatPercent(targetAboveSpot)} above spot.`;

  const selectNearestPoint = (event: PointerEvent<HTMLDivElement>) => {
    if (geometry === null) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return;

    const chartX = Math.max(
      0,
      Math.min(720, ((event.clientX - bounds.left) / bounds.width) * 720),
    );
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    geometry.points.forEach((point, index) => {
      const distance = Math.abs(point.x - chartX);
      if (distance < nearestDistance) {
        nearestIndex = index;
        nearestDistance = distance;
      }
    });
    setActiveIndex(nearestIndex);
  };

  const handleChartKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (geometry === null) return;
    const lastIndex = geometry.points.length - 1;
    const currentIndex = activeIndex ?? lastIndex;
    let nextIndex: number | null = null;

    if (event.key === "ArrowLeft") nextIndex = Math.max(0, currentIndex - 1);
    if (event.key === "ArrowRight") nextIndex = Math.min(lastIndex, currentIndex + 1);
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = lastIndex;

    if (nextIndex !== null) {
      event.preventDefault();
      setActiveIndex(nextIndex);
    }
  };

  if (geometry === null || state === "loading" || state === "unavailable") {
    return (
      <div
        role="img"
        aria-label={
          state === "loading"
            ? `Loading ${assetSymbol} 30-day price history`
            : `${assetSymbol} 30-day price history is currently unavailable`
        }
        className="relative mt-6 flex h-[220px] w-full items-center justify-center overflow-hidden border-y-[0.5px] border-zinc-100"
      >
        <div aria-hidden className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_24%,#f4f4f5_24.5%,transparent_25%,transparent_49%,#f4f4f5_49.5%,transparent_50%,transparent_74%,#f4f4f5_74.5%,transparent_75%)]" />
        <p className="relative bg-white px-3 font-mono text-[11px] text-zinc-500">
          {state === "loading" ? `Loading 30-day ${assetSymbol} history…` : `30-day ${assetSymbol} history unavailable`}
        </p>
      </div>
    );
  }

  const lastIndex = geometry.points.length - 1;
  const safeActiveIndex =
    activeIndex !== null && activeIndex <= lastIndex ? activeIndex : null;
  const sliderIndex = safeActiveIndex ?? lastIndex;
  const sliderPoint = geometry.points[sliderIndex];
  const activePoint =
    safeActiveIndex === null ? null : geometry.points[safeActiveIndex];

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={`${assetName} 30-day price history`}
      aria-describedby={descriptionId}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={lastIndex}
      aria-valuenow={sliderIndex}
      aria-valuetext={`${formatHistoryPointLabel(sliderPoint)}, ${formatChartPrice(sliderPoint.value)}`}
      className="relative mt-6 h-[220px] w-full cursor-crosshair touch-pan-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
      onPointerEnter={selectNearestPoint}
      onPointerMove={selectNearestPoint}
      onPointerDown={selectNearestPoint}
      onPointerLeave={() => {
        if (!isFocused) setActiveIndex(null);
      }}
      onFocus={() => {
        setIsFocused(true);
        setActiveIndex(lastIndex);
      }}
      onBlur={() => {
        setIsFocused(false);
        setActiveIndex(null);
      }}
      onKeyDown={handleChartKeyDown}
    >
      <span id={descriptionId} className="sr-only">
        {accessibleLabel} Use the left and right arrow keys to inspect daily prices.
      </span>
      <svg
        viewBox="0 0 720 220"
        aria-hidden="true"
        className="h-full w-full overflow-visible"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="btcHistoryFade" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#f97316" stopOpacity="0.11" />
            <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[42, 92, 142, 192].map((y) => (
          <line key={y} x1="0" x2="720" y1={y} y2={y} stroke="#f4f4f5" strokeWidth="1" />
        ))}
        <line
          x1="0"
          x2="720"
          y1={geometry.targetY}
          y2={geometry.targetY}
          stroke="#f97316"
          strokeDasharray="5 6"
          strokeWidth="1.5"
        />
        <path d={geometry.areaPath} fill="url(#btcHistoryFade)" />
        <path
          d={geometry.linePath}
          fill="none"
          stroke="#18181b"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx="708" cy={geometry.spotY} r="4" fill="#18181b" stroke="white" strokeWidth="2" />
        <rect
          x="704"
          y={geometry.targetY - 4}
          width="8"
          height="8"
          fill="#f97316"
          transform={`rotate(45 708 ${geometry.targetY})`}
        />
        {activePoint && (
          <>
            <line
              x1={activePoint.x}
              x2={activePoint.x}
              y1="18"
              y2="192"
              stroke="#a1a1aa"
              strokeDasharray="3 4"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={activePoint.x}
              cy={activePoint.y}
              r="5"
              fill="white"
              stroke="#18181b"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
      </svg>
      {activePoint && (
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute z-10 min-w-max bg-zinc-950 px-3 py-2 text-white shadow-sm",
            activePoint.x < 100
              ? "translate-x-0"
              : activePoint.x > 620
                ? "-translate-x-full"
                : "-translate-x-1/2",
            activePoint.y < 64
              ? "translate-y-3"
              : "-translate-y-[calc(100%+12px)]",
          )}
          style={{
            left: `${(activePoint.x / 720) * 100}%`,
            top: `${(activePoint.y / 220) * 100}%`,
          }}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.05em] text-zinc-400">
            {formatHistoryPointLabel(activePoint)}
          </p>
          <p className="mt-0.5 font-mono text-[13px] font-medium">
            {formatChartPrice(activePoint.value)}
          </p>
        </div>
      )}
      <div
        className="pointer-events-none absolute right-0 -translate-y-[calc(100%+7px)] bg-white pl-2 font-mono text-[11px] text-orange-700"
        style={{ top: `${(geometry.targetY / 220) * 100}%` }}
      >
        Target {formatUsd(targetPrice)} · +{formatPercent(targetAboveSpot)}
      </div>
      <div
        className="pointer-events-none absolute right-0 translate-y-2 bg-white pl-2 font-mono text-[11px] text-zinc-600"
        style={{ top: `${(geometry.spotY / 220) * 100}%` }}
      >
        Now {formatUsd(spotPrice)}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between font-mono text-[11px] uppercase tracking-[0.05em] text-zinc-500">
        <span>30 days ago</span>
        <span>Today</span>
      </div>
    </div>
  );
}

function chartGeometry(
  history: BitcoinPriceHistoryPoint[],
  spotPrice: number,
  targetPrice: number,
) {
  const validHistory = history.filter(
    (point) => Number.isFinite(point.value) && point.value > 0,
  );
  const plottedHistory = validHistory.map((point, index) => ({
    time: point.time,
    isCurrent: index === validHistory.length - 1,
    value: index === validHistory.length - 1 ? spotPrice : point.value,
  }));
  const values = plottedHistory.map((point) => point.value);
  const plotTop = 18;
  const plotBottom = 192;
  const min = Math.min(...values, spotPrice) * 0.985;
  const max = Math.max(...values, targetPrice) * 1.015;
  const span = Math.max(1, max - min);
  const y = (value: number) =>
    plotTop + ((max - value) / span) * (plotBottom - plotTop);
  const coordinates = plottedHistory.map((point, index) => ({
    ...point,
    x: plottedHistory.length === 1 ? 708 : (index / (plottedHistory.length - 1)) * 708,
    y: y(point.value),
  }));
  const linePath = coordinates
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(" ");
  const last = coordinates.at(-1) ?? { x: 708, y: y(spotPrice) };
  const first = coordinates[0] ?? { x: 0, y: y(spotPrice) };

  return {
    linePath,
    areaPath: `${linePath} L${last.x.toFixed(2)},${plotBottom} L${first.x.toFixed(2)},${plotBottom} Z`,
    points: coordinates,
    spotY: y(spotPrice),
    targetY: y(targetPrice),
  };
}

export function OrderTicket({
  snapshot,
  amount,
  balance,
  maxAmount,
  hasSubaccount,
  depositedBalance,
  isConnected,
  setupPhase,
  sellPhase,
  auction,
  quote,
  error,
  doneInfo,
  feeReadState,
  controlsDisabled,
  onAmountChange,
  onRequestQuote,
  onAcceptQuote,
  onCreateAnother,
}: {
  snapshot: OrderSnapshot;
  amount: string;
  balance: number;
  maxAmount: string;
  hasSubaccount: boolean;
  depositedBalance: number;
  isConnected: boolean;
  setupPhase: SetupPhase;
  sellPhase: SellPhase;
  auction: AuctionState | null;
  quote: PreparedQuote | null;
  error: string | null;
  doneInfo: CompletedTradeInfo | null;
  feeReadState: FeeReadState;
  controlsDisabled: boolean;
  onAmountChange: (amount: string) => void;
  onRequestQuote: () => void;
  onAcceptQuote: () => void;
  onCreateAnother: () => void;
}) {
  const assetSymbol = snapshot.marketId ?? "BTC";
  const assetName = snapshot.assetName ?? "Bitcoin";
  const collateralSymbol = snapshot.collateralSymbol ?? "BTCB";
  const amountNumber = Math.max(0, Number.parseFloat(amount) || 0);
  const hasAmount = amountNumber > 0;
  const indicativeTotal = snapshot.strike.premium * amountNumber;
  const executableQuote =
    quote !== null &&
    ["quoted", "signing", "executing", "done"].includes(sellPhase)
      ? quote
      : null;
  const displayPremium = executableQuote?.totalPremium ?? indicativeTotal;
  const estimatedOiFee = snapshot.estimatedOiFee ?? null;
  const estimatedNet =
    estimatedOiFee === null ? null : displayPremium - estimatedOiFee;
  const insufficient = isConnected && amountNumber > balance;
  const exceedsMaximum = amountExceedsLimit(amount || "0", maxAmount);
  const depositDeficit = Math.max(0, amountNumber - depositedBalance);
  const requiresSetup = isConnected && depositDeficit > 0;
  const busy =
    setupPhase !== "idle" ||
    ["requesting", "auction", "signing", "executing"].includes(sellPhase);
  const [scenarioPrice, setScenarioPrice] = useState(() => snapshot.spotPrice);

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
      ((snapshot.strike.strike - range.min) / (range.max - range.min || 1)) * 100,
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
    hasSubaccount,
    amountNumber,
    insufficient,
    exceedsMaximum,
    setupPhase,
    sellPhase,
    requiresSetup,
    feeReadState,
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
    <aside id="order-review" className="border-t-[0.5px] border-zinc-200 py-7 sm:py-8 min-[960px]:border-l-[0.5px] min-[960px]:border-t-0 min-[960px]:pl-8 xl:pl-10">
      <div className="min-[960px]:sticky min-[960px]:top-[96px]">
        <div className="flex items-center justify-between gap-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-zinc-500">
            Sell call
          </p>
          <p className="font-mono text-[11px] text-zinc-500">{shortExpiry(snapshot.strike.expiry)}</p>
        </div>

        <div className="mt-5 border-b-[0.5px] border-zinc-200 pb-6">
          <CurrencyField size="medium">
            <CurrencyField.Label className="!text-sm !font-medium !leading-6 text-zinc-800">
              Amount to cover
            </CurrencyField.Label>
            <CurrencyField.Control
              disabled={controlsDisabled}
              value={amount}
              onChange={onAmountChange}
              prefix=""
              hasError={insufficient || exceedsMaximum}
              trailing={
                <span className="flex min-h-10 shrink-0 items-center gap-2 border-l-[0.5px] border-zinc-200 pl-3 text-sm font-medium text-zinc-800">
                  <MarketIcon marketId={assetSymbol} size={18} /> {collateralSymbol}
                </span>
              }
            />
          </CurrencyField>
          <p className="mt-3 font-mono text-[11px] leading-5 text-zinc-500">
            {isConnected
              ? `${balance.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${collateralSymbol} available · ${maxAmount} ${collateralSymbol} max`
              : "Connect a wallet to check collateral"}
          </p>
          {insufficient && (
            <p role="alert" className="mt-2 text-xs leading-5 text-red-600">
              This exceeds the {collateralSymbol} detected across your wallet and covered-call account.
            </p>
          )}
          {!insufficient && exceedsMaximum && (
            <p role="alert" className="mt-2 text-xs leading-5 text-red-600">
              Maximum order size is {maxAmount} {collateralSymbol}.
            </p>
          )}
        </div>

        <div className="pt-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-zinc-500">
            {!hasAmount
              ? "Estimated trade economics"
              : estimatedNet === null
                ? "Estimated gross premium"
                : "Expected net cash change"}
          </p>
          <Text as="p" variant="h2" className={cn("mt-2", estimatedNet !== null && estimatedNet < 0 ? "text-red-600" : "text-zinc-950")}>
            {hasAmount ? formatUsd(estimatedNet ?? displayPremium, 2) : "—"}
          </Text>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            {executableQuote
              ? `Live quote · ${formatUsd(executableQuote.premium, 2)}/${assetSymbol}`
              : `Indicative · ${formatPercent(snapshot.strike.apr)} APR`}
          </p>
          <dl className="mt-5">
            <DetailRow label="Premium" value={hasAmount ? formatUsd(displayPremium, 2) : "—"} />
            <DetailRow
              label="Protocol fee (est.)"
              value={
                !hasAmount
                  ? "—"
                  : estimatedOiFee !== null
                  ? `−${formatUsd(estimatedOiFee, 2)}`
                  : feeReadState === "loading"
                    ? "Loading…"
                    : "Unavailable"
              }
            />
          </dl>
          {hasAmount && estimatedNet !== null && estimatedNet < 0 && (
            <p className="mt-4 border-l-2 border-red-400 pl-3 text-xs leading-5 text-red-700">
              The estimated protocol fee is greater than the premium at this size. Increase the amount or compare a closer strike before requesting quotes.
            </p>
          )}
        </div>

        <ExecutionState
          setupPhase={setupPhase}
          sellPhase={sellPhase}
          auction={auction}
          quote={quote}
          indicativeTotal={snapshot.indicativeTotalPremium}
          error={error}
          doneInfo={doneInfo}
          assetSymbol={assetSymbol}
          collateralSymbol={collateralSymbol}
        />

        <div className="flex min-h-28 items-center">
          <Button
            type="button"
            action
            size="lg"
            disabled={primary.disabled || busy}
            onClick={handlePrimary}
            className="w-full"
          >
            {primary.label}
          </Button>
        </div>

        <details open className="group border-t-[0.5px] border-zinc-200">
          <summary className="flex min-h-14 list-none items-center justify-between text-sm font-medium text-zinc-700 marker:hidden hover:text-zinc-950">
            Contract details
            <span className="font-mono text-xs text-zinc-400 transition-transform group-open:rotate-45">+</span>
          </summary>
          <dl className="pb-5">
            <DetailRow label="Exact expiry" value={exactExpiry(snapshot.strike.expiry)} />
            <DetailRow label="Strike" value={formatUsd(snapshot.strike.strike)} />
            <DetailRow label="Above spot" value={`+${formatPercent(snapshot.strike.otmPercent)}`} />
            <DetailRow label="Indicative APR" value={formatPercent(snapshot.strike.apr)} />
            <DetailRow label="IV input" value={formatPercent(snapshot.strike.vol * 100)} />
            <DetailRow label="Instrument" value={snapshot.strike.instrumentName} />
          </dl>
        </details>

        <details className="group border-t-[0.5px] border-zinc-200">
          <summary className="flex min-h-14 list-none items-center justify-between text-sm font-medium text-zinc-700 marker:hidden hover:text-zinc-950">
            Payoff at expiry
            <span className="font-mono text-xs text-zinc-400 transition-transform group-open:rotate-45">+</span>
          </summary>
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
            assetName={assetName}
            assetSymbol={assetSymbol}
            collateralSymbol={collateralSymbol}
          />
        </details>
      </div>
    </aside>
  );
}

function primaryAction({
  isConnected,
  hasSubaccount,
  amountNumber,
  insufficient,
  exceedsMaximum,
  setupPhase,
  sellPhase,
  requiresSetup,
  feeReadState,
  done,
  collateralSymbol,
}: {
  isConnected: boolean;
  hasSubaccount: boolean;
  amountNumber: number;
  insufficient: boolean;
  exceedsMaximum: boolean;
  setupPhase: SetupPhase;
  sellPhase: SellPhase;
  requiresSetup: boolean;
  feeReadState: FeeReadState;
  done: boolean;
  collateralSymbol: string;
}): { label: string; disabled: boolean } {
  if (done) return { label: "Sell another call", disabled: false };
  if (!isConnected) return { label: "Connect wallet to continue", disabled: false };
  if (!hasSubaccount) {
    return { label: "Choose a subaccount in the navigation", disabled: true };
  }
  if (amountNumber <= 0) return { label: `Enter ${collateralSymbol} amount`, disabled: true };
  if (insufficient) return { label: `Insufficient ${collateralSymbol}`, disabled: true };
  if (exceedsMaximum) return { label: "Amount exceeds maximum", disabled: true };
  if (feeReadState === "loading") return { label: "Loading protocol fee…", disabled: true };
  if (feeReadState === "unavailable") return { label: "Fee data unavailable", disabled: true };
  if (setupPhase === "subaccount") return { label: "Creating account…", disabled: true };
  if (setupPhase === "deposit") return { label: `Depositing ${collateralSymbol}…`, disabled: true };
  if (sellPhase === "requesting") return { label: "Opening auction…", disabled: true };
  if (sellPhase === "auction") return { label: "Collecting quotes…", disabled: true };
  if (sellPhase === "quoted") return { label: "Accept & sign", disabled: false };
  if (sellPhase === "signing") return { label: "Confirm in wallet…", disabled: true };
  if (sellPhase === "executing") return { label: "Creating position…", disabled: true };
  if (sellPhase === "expired") return { label: "Request a new quote", disabled: false };
  if (sellPhase === "error") return { label: "Try again", disabled: false };
  return {
    label: requiresSetup ? "Prepare & request quote" : "Request live quote",
    disabled: amountNumber <= 0 || insufficient || exceedsMaximum,
  };
}

function ExecutionState({
  setupPhase,
  sellPhase,
  auction,
  quote,
  indicativeTotal,
  error,
  doneInfo,
  assetSymbol,
  collateralSymbol,
}: {
  setupPhase: SetupPhase;
  sellPhase: SellPhase;
  auction: AuctionState | null;
  quote: PreparedQuote | null;
  indicativeTotal: number;
  error: string | null;
  doneInfo: CompletedTradeInfo | null;
  assetSymbol: string;
  collateralSymbol: string;
}) {
  if (doneInfo) {
    return (
      <div className="mt-6 border-y-[0.5px] border-green-300 py-5">
        <div className="flex items-center gap-2 text-green-700">
          <CheckCircle2 className="size-4" />
          <p className="text-sm font-semibold">Covered call created</p>
        </div>
        <p className="mt-2 text-xs leading-5 text-zinc-600">
          Trade premium: {formatUsd(doneInfo.premium, 2)} before protocol fees. Check the subaccount cash balance for the net effect.
        </p>
        <a
          href={doneInfo.txUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex min-h-11 items-center font-mono text-[11px] text-green-800 underline underline-offset-4"
        >
          View transaction
        </a>
      </div>
    );
  }

  if (error && sellPhase === "error") {
    return (
      <div role="alert" className="mt-6 border-l-2 border-red-500 pl-4 text-sm leading-6 text-red-700">
        {error}
      </div>
    );
  }

  if (setupPhase !== "idle" || sellPhase === "requesting") {
    return (
      <StatusLine
        icon={<MoveRight className="size-4" />}
        title={
          setupPhase === "subaccount"
            ? "Creating the covered-call account"
            : setupPhase === "deposit"
              ? `Depositing ${collateralSymbol} collateral`
              : "Opening the quote auction"
        }
        text="Keep this page open while the wallet step is prepared."
      />
    );
  }

  if (sellPhase === "auction" && auction) return <AuctionLine auction={auction} />;

  if (quote && ["quoted", "signing", "executing", "expired"].includes(sellPhase)) {
    return (
      <ExecutableQuote
        quote={quote}
        indicativeTotal={indicativeTotal}
        expired={sellPhase === "expired"}
        assetSymbol={assetSymbol}
      />
    );
  }

  return null;
}

function StatusLine({
  icon,
  title,
  text,
}: {
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="mt-6 border-l-2 border-orange-400 pl-4">
      <div className="flex items-center gap-2 text-orange-700">
        {icon}
        <p className="text-sm font-semibold">{title}</p>
      </div>
      <p className="mt-1 font-mono text-[11px] leading-5 text-zinc-500">{text}</p>
    </div>
  );
}

function AuctionLine({ auction }: { auction: AuctionState }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, []);
  const remaining = Math.max(0, (auction.endsAt - now) / 1000);

  return (
    <StatusLine
      icon={<MoveRight className="size-4" />}
      title={`Collecting live quotes · ${remaining.toFixed(1)}s`}
      text={`${auction.quoteCount} quote${auction.quoteCount === 1 ? "" : "s"} received${auction.bestTotalPremium === null ? "" : ` · best ${formatUsd(auction.bestTotalPremium, 2)}`}`}
    />
  );
}

function ExecutableQuote({
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
    <div className={cn("mt-6 border-y-[0.5px] py-5", expired ? "border-zinc-300" : "border-orange-300")}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-zinc-500">
            {expired ? "Quote expired" : "Winning executable quote"}
          </p>
          <p className="mt-1 font-heading text-3xl font-bold text-zinc-950">
            {formatUsd(quote.totalPremium, 2)}
          </p>
          <p className="mt-1 font-mono text-[11px] text-zinc-500">
            {formatUsd(quote.premium, 2)}/{assetSymbol} · {quote.quoteCount} quote{quote.quoteCount === 1 ? "" : "s"}
          </p>
        </div>
        <span className="inline-flex min-h-9 items-center gap-2 font-mono text-xs text-orange-700">
          <Clock3 className="size-3.5" />
          {expired ? "Refresh" : `${seconds}s`}
        </span>
      </div>
      <div className="mt-4 flex items-center justify-between gap-4 border-t-[0.5px] border-zinc-200 pt-4 font-mono text-[11px]">
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
  assetName: string;
  assetSymbol: string;
  collateralSymbol: string;
}) {
  return (
    <div className="pb-6">
      <div className="flex items-start justify-between gap-4 pt-2">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-zinc-500">{assetName} at expiry</p>
          <p className="mt-1 font-heading text-2xl font-bold text-zinc-950">{formatUsd(scenarioPrice)}</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-zinc-500">Position value</p>
          <p className="mt-1 text-sm font-semibold text-zinc-950">{formatUsd(coveredPositionValue, 2)}</p>
        </div>
      </div>

      <div className="relative mt-7 px-1 pb-14">
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
        <Marker left={spotMarker} label="Now" value={formatUsd(spotPrice)} offsetClass="top-8" />
        <Marker left={strikeMarker} label="Cap" value={formatUsd(strikePrice)} offsetClass="top-14" />
      </div>

      <dl className="border-y-[0.5px] border-zinc-200">
        <DetailRow label="Settlement payment" value={formatUsd(settlementPayment, 2)} />
        <DetailRow label="Premium included" value={formatUsd(premium, 2)} />
        <DetailRow label={`At or below ${formatUsd(strikePrice)}`} value={`Keep ${collateralSymbol} + premium`} />
        <DetailRow
          label={`Above ${formatUsd(strikePrice)}`}
          value={`Pay difference × ${amount.toLocaleString("en-US", { maximumFractionDigits: 6 })} in USDT`}
        />
      </dl>
      <p className="mt-4 font-mono text-[11px] leading-5 text-zinc-500">
        USDT shortfalls borrow against {collateralSymbol} · no early exit
      </p>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-4 border-t-[0.5px] border-zinc-100 py-3 first:border-t-0">
      <dt className="font-mono text-[11px] leading-5 text-zinc-500">{label}</dt>
      <dd className="break-words text-right font-mono text-[11px] leading-5 text-zinc-700">{value}</dd>
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
      className={cn("pointer-events-none absolute -translate-x-1/2 text-center", offsetClass)}
      style={{ left: `${left}%` }}
    >
      <span className="mx-auto block h-2 w-px bg-zinc-400" />
      <span className="mt-1 block whitespace-nowrap font-mono text-[11px] text-zinc-500">
        {label} {value}
      </span>
    </div>
  );
}
