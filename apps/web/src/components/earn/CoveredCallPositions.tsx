"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, ExternalLink, Info } from "lucide-react";
import {
  usePositions,
  type OptionPosition,
} from "@/hooks/protocol/usePositionMonitor";
import { useSpotPrice } from "@/hooks/protocol/useSpotPrice";
import { explorerTxUrl } from "@/lib/protocol/deployments";
import { cn } from "@/lib/utils";

type DisplayStatus = "unknown" | "otm" | "itm" | "expired" | "settled";

const statusStyle: Record<DisplayStatus, string> = {
  unknown: "border-zinc-200 bg-zinc-100 text-zinc-600",
  otm: "border-green-200 bg-green-50 text-green-700",
  itm: "border-orange-200 bg-orange-50 text-orange-700",
  expired: "border-amber-200 bg-amber-50 text-amber-700",
  settled: "border-zinc-200 bg-zinc-100 text-zinc-600",
};

function formatUsd(value: number, digits = 0): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
  });
}

function exactExpiry(expiry: number): string {
  const date = new Date(expiry * 1000);
  return `${date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })} · ${date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })} UTC`;
}

function timeRemaining(expiry: number): string {
  const seconds = Math.max(0, expiry - Date.now() / 1000);
  if (seconds <= 0) return "Expired";
  const hours = Math.ceil(seconds / 3600);
  return hours >= 48 ? `${Math.ceil(hours / 24)}d remaining` : `${hours}h remaining`;
}

function positionStatus(position: OptionPosition, spotPrice: number): {
  type: DisplayStatus;
  label: string;
} {
  if (position.status === "settled") {
    return {
      type: "settled",
      label: position.settledItm ? "Settled ITM" : "Settled OTM",
    };
  }
  if (position.status === "expired") {
    return { type: "expired", label: "Awaiting settlement" };
  }
  if (spotPrice <= 0) {
    return { type: "unknown", label: "Spot unavailable" };
  }
  if (spotPrice > position.strike) {
    return { type: "itm", label: "ITM" };
  }
  return { type: "otm", label: "OTM" };
}

function PositionRow({
  position,
  spotPrice,
}: {
  position: OptionPosition;
  spotPrice: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = positionStatus(position, spotPrice);
  const distance =
    spotPrice > 0 ? ((spotPrice - position.strike) / position.strike) * 100 : 0;
  const distanceLabel =
    spotPrice <= 0
      ? "Spot unavailable"
      : Math.abs(distance) < 0.05
        ? "At strike"
        : `${Math.abs(distance).toFixed(Math.abs(distance) >= 10 ? 0 : 1)}% ${distance > 0 ? "above" : "below"} strike`;
  const amount = Math.abs(position.balance);
  const premium = position.trade ? Number.parseFloat(position.trade.premium) : null;
  const assetSymbol = position.marketId ?? "BTC";
  const assetName = position.assetName ?? "Bitcoin";
  const collateralSymbol = position.collateralSymbol ?? "BTCB";

  return (
    <article className="border-b-[0.5px] border-zinc-200 bg-white last:border-b-0">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="grid min-h-[88px] w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-3 px-0 py-4 text-left transition-colors hover:bg-zinc-50 sm:grid-cols-[minmax(0,1.3fr)_minmax(140px,0.8fr)_minmax(120px,0.7fr)_auto] sm:items-center sm:gap-4 sm:px-3"
      >
        <span className="col-start-1 row-start-1 flex min-w-0 items-center gap-3 sm:col-auto sm:row-auto">
          <ChevronRight
            className={cn(
              "size-4 shrink-0 text-zinc-400 transition-transform",
              expanded && "rotate-90",
            )}
          />
          <span className="min-w-0">
            <span className="block font-heading text-base font-bold text-zinc-950">
              {assetSymbol} covered call
            </span>
            <span className="mt-1 block truncate font-mono text-[11px] text-zinc-500">
              {formatUsd(position.strike)} strike · {amount.toLocaleString("en-US", { maximumFractionDigits: 6 })} {collateralSymbol} · {timeRemaining(position.expiry)}
            </span>
          </span>
        </span>

        <span className="col-start-1 row-start-2 pl-7 sm:col-auto sm:row-auto sm:pl-0">
          <span className="block font-mono text-[11px] uppercase tracking-wide text-zinc-500">
            {assetSymbol} spot
          </span>
          <span className="mt-1 block text-sm font-medium text-zinc-950">
            {spotPrice > 0 ? formatUsd(spotPrice, 2) : "—"}
          </span>
          <span className="mt-0.5 block font-mono text-[11px] text-zinc-500">
            {distanceLabel}
          </span>
        </span>

        <span className="col-start-2 row-start-2 sm:col-auto sm:row-auto sm:pl-0">
          <span className="block font-mono text-[11px] uppercase tracking-wide text-zinc-500">
            Gross premium
          </span>
          <span className="mt-1 block text-sm font-medium text-zinc-950">
            {premium === null ? "—" : `+${formatUsd(premium, 2)}`}
          </span>
        </span>

        <span
          className={cn(
            "col-start-2 row-start-1 ml-0 w-fit justify-self-end whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide sm:col-auto sm:row-auto sm:justify-self-auto",
            statusStyle[status.type],
          )}
        >
          {status.label}
        </span>
      </button>

      {expanded && (
        <div className="border-t-[0.5px] border-zinc-200 bg-zinc-50 px-5 py-5 sm:px-10">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <PositionDetail label="Exact expiry" value={exactExpiry(position.expiry)} />
            <PositionDetail
              label="Collateral represented"
              value={`${amount.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${collateralSymbol}`}
            />
            <PositionDetail
              label="Settlement"
              value={settlementLabel(position)}
            />
            <div>
              <span className="block font-mono text-[11px] uppercase tracking-wide text-zinc-500">
                Trade record
              </span>
              {position.trade ? (
                <a
                  href={explorerTxUrl(position.trade.txHash, position.trade.chainId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-orange-600 underline-offset-4 hover:underline"
                >
                  View transaction <ExternalLink className="size-3.5" />
                </a>
              ) : (
                <span className="mt-1 block text-sm font-medium text-zinc-700">
                  On-chain position
                </span>
              )}
            </div>
          </div>

          <div className="mt-5 flex items-start gap-3 border-l-2 border-orange-400 pl-4">
            <Info className="mt-0.5 size-4 shrink-0 text-zinc-500" />
            <p className="text-xs font-medium leading-5 text-zinc-600 sm:text-sm">
              {collateralSymbol} remains in the covered-call subaccount. When {assetName} settles above the strike, the account owes (settlement − strike) × covered {collateralSymbol} in USDT; a cash shortfall becomes borrowing against {collateralSymbol}.
            </p>
          </div>
        </div>
      )}
    </article>
  );
}

function PositionRowWithSpot({ position }: { position: OptionPosition }) {
  const { spotPrice } = useSpotPrice(position.marketId ?? "BTC");
  return <PositionRow position={position} spotPrice={spotPrice} />;
}

function PositionDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block font-mono text-[11px] uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <span className="mt-1 block text-sm font-medium text-zinc-800">{value}</span>
    </div>
  );
}

function settlementLabel(position: OptionPosition): string {
  if (position.status === "open") return "Cash settled at expiry";
  if (position.status === "expired") return "Settlement price pending";
  if (position.settlementPrice === null) return "Settled";
  return `${formatUsd(position.settlementPrice, 2)} · ${position.settledItm ? "ITM" : "OTM"}`;
}

export function CoveredCallPositions() {
  const positions = usePositions();
  const { subaccountId, cash, options, isLoading } = positions;
  const collateralByMarket = positions.collateralByMarket ?? { BTC: positions.btcb ?? 0 };

  if (subaccountId === null) return null;

  return (
    <section id="positions" className="scroll-mt-24">
      <div>
        <div className="mb-5 grid grid-cols-2 items-end gap-x-4 gap-y-4 sm:mb-6 sm:flex sm:flex-wrap sm:gap-3">
          <div className="col-span-2 sm:col-auto">
            <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              Subaccount #{subaccountId.toString()}
            </div>
            <h2 className="mt-1 font-heading text-2xl font-bold text-zinc-950">
              Covered-call positions
            </h2>
          </div>
          <div className="hidden flex-1 sm:block" />
          {Object.entries(collateralByMarket).map(([marketId, value]) => {
            const position = options.find((option) => option.marketId === marketId);
            const symbol = position?.collateralSymbol ?? (marketId === "BTC" ? "BTCB" : marketId);
            return <BalanceReadout key={marketId} label={`${symbol} collateral`} value={(value ?? 0).toFixed(6)} />;
          })}
          <span aria-hidden className="hidden h-5 w-px bg-zinc-200 sm:block" />
          <BalanceReadout
            label="USDT cash"
            value={cash.toLocaleString("en-US", { maximumFractionDigits: 2 })}
            warning={cash < 0}
          />
        </div>

        {isLoading ? (
          <div className="border-y-[0.5px] border-zinc-200 py-12 text-center text-xs text-zinc-500">
            Loading positions…
          </div>
        ) : options.length === 0 ? (
          <div className="border-y-[0.5px] border-zinc-200 py-12 text-center">
            <p className="font-heading text-base font-bold text-zinc-900">
              No covered calls yet
            </p>
            <p className="mt-1 text-xs font-medium text-zinc-500">
              <Link href="/app" className="text-orange-700 underline-offset-4 hover:underline">
                Open trade
              </Link>{" "}
              to choose an expiry and target for your first position.
            </p>
          </div>
        ) : (
          <div className="border-y-[0.5px] border-zinc-200">
            {options.map((position) => (
              <PositionRowWithSpot
                key={position.subId.toString()}
                position={position}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function BalanceReadout({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <div className="font-mono text-xs text-zinc-500">
      {label}:{" "}
      <span className={cn("font-medium text-zinc-950", warning && "text-amber-700")}>
        {value}
      </span>
    </div>
  );
}
