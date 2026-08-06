"use client";

import { useState } from "react";
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
  return `${new Date(expiry * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })} · 08:00 UTC`;
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

  return (
    <article className="overflow-hidden rounded-[8px] border-[0.5px] border-zinc-200 bg-white transition-colors hover:border-zinc-300">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="grid min-h-[92px] w-full items-center gap-4 px-4 py-4 text-left sm:grid-cols-[minmax(0,1.3fr)_minmax(140px,0.8fr)_minmax(120px,0.7fr)_auto] sm:px-5"
      >
        <span className="flex min-w-0 items-center gap-3">
          <ChevronRight
            className={cn(
              "size-4 shrink-0 text-zinc-400 transition-transform",
              expanded && "rotate-90",
            )}
          />
          <span className="min-w-0">
            <span className="block font-heading text-base font-bold text-zinc-950">
              BTC covered call
            </span>
            <span className="mt-1 block truncate font-mono text-[11px] text-zinc-500">
              {formatUsd(position.strike)} strike · {amount.toLocaleString("en-US", { maximumFractionDigits: 6 })} BTCB · {timeRemaining(position.expiry)}
            </span>
          </span>
        </span>

        <span className="pl-7 sm:pl-0">
          <span className="block font-mono text-[10px] uppercase tracking-wide text-zinc-400">
            BTC spot
          </span>
          <span className="mt-1 block text-sm font-medium text-zinc-950">
            {spotPrice > 0 ? formatUsd(spotPrice, 2) : "—"}
          </span>
          <span className="mt-0.5 block font-mono text-[10px] text-zinc-500">
            {distanceLabel}
          </span>
        </span>

        <span className="pl-7 sm:pl-0">
          <span className="block font-mono text-[10px] uppercase tracking-wide text-zinc-400">
            Premium earned
          </span>
          <span className="mt-1 block text-sm font-medium text-green-700">
            {premium === null ? "—" : `+${formatUsd(premium, 2)}`}
          </span>
        </span>

        <span
          className={cn(
            "ml-7 w-fit whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide sm:ml-0",
            statusStyle[status.type],
          )}
        >
          {status.label}
        </span>
      </button>

      {expanded && (
        <div className="border-t-[0.5px] border-zinc-200 bg-zinc-50 px-5 py-5 sm:px-12">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <PositionDetail label="Exact expiry" value={exactExpiry(position.expiry)} />
            <PositionDetail
              label="Collateral represented"
              value={`${amount.toLocaleString("en-US", { maximumFractionDigits: 6 })} BTCB`}
            />
            <PositionDetail
              label="Settlement"
              value={settlementLabel(position)}
            />
            <div>
              <span className="block font-mono text-[10px] uppercase tracking-wide text-zinc-400">
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

          <div className="mt-5 flex items-start gap-3 rounded-[5px] bg-white p-4">
            <Info className="mt-0.5 size-4 shrink-0 text-zinc-500" />
            <p className="text-xs font-medium leading-5 text-zinc-600 sm:text-sm">
              BTCB remains held in the covered-call subaccount. When BTC settles above the strike, gains above the strike are offset through USDT cash settlement.
            </p>
          </div>
        </div>
      )}
    </article>
  );
}

function PositionDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block font-mono text-[10px] uppercase tracking-wide text-zinc-400">
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
  const { subaccountId, cash, btcb, options, isLoading } = usePositions();
  const { spotPrice } = useSpotPrice();

  if (subaccountId === null) return null;

  return (
    <section
      id="positions"
      className="scroll-mt-24 border-t-[0.5px] border-zinc-200 bg-zinc-50 py-14 sm:py-20"
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="mb-6 flex flex-wrap items-end gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              Subaccount #{subaccountId.toString()}
            </div>
            <h2 className="mt-1 font-heading text-2xl font-bold text-zinc-950">
              Covered-call positions
            </h2>
          </div>
          <div className="flex-1" />
          <BalancePill label="BTCB collateral" value={btcb.toFixed(6)} />
          <BalancePill
            label="USDT cash"
            value={cash.toLocaleString("en-US", { maximumFractionDigits: 2 })}
            warning={cash < 0}
          />
        </div>

        {isLoading ? (
          <div className="rounded-[8px] border-[0.5px] border-zinc-200 bg-white py-10 text-center text-xs text-zinc-500">
            Loading positions…
          </div>
        ) : options.length === 0 ? (
          <div className="rounded-[8px] border-[0.5px] border-zinc-200 bg-white p-8 text-center">
            <p className="font-heading text-base font-bold text-zinc-900">
              No covered calls yet
            </p>
            <p className="mt-1 text-xs font-medium text-zinc-500">
              Select an expiry and strike above to create your first position.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {options.map((position) => (
              <PositionRow
                key={position.subId.toString()}
                position={position}
                spotPrice={spotPrice}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function BalancePill({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <div className="rounded-[5px] border-[0.5px] border-zinc-200 bg-white px-3 py-2 font-mono text-xs text-zinc-500">
      {label}:{" "}
      <span className={cn("font-medium text-zinc-950", warning && "text-amber-700")}>
        {value}
      </span>
    </div>
  );
}
