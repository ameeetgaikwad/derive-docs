"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import type { BitcoinPriceHistoryPoint } from "@/lib/market/bitcoin-history";

type HistoryResponse = {
  success: boolean;
  points?: BitcoinPriceHistoryPoint[];
};

type LoadState = "loading" | "ready" | "error";

const strikeDistances = [5, 10, 15] as const;

function formatUsd(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatChange(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function HistoryChart({ points }: { points: BitcoinPriceHistoryPoint[] }) {
  const gradientId = useId();
  const titleId = useId();
  const descriptionId = useId();
  const geometry = useMemo(() => {
    const values = points.map((point) => point.value);
    const plotBottom = 202;
    const plotTop = 18;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = Math.max((max - min) * 0.12, max * 0.005);
    const floor = min - padding;
    const ceiling = max + padding;
    const span = Math.max(1, ceiling - floor);
    const y = (value: number) =>
      plotTop + ((ceiling - value) / span) * (plotBottom - plotTop);
    const coordinates = values.map((value, index) => ({
      x: (index / Math.max(1, values.length - 1)) * 708,
      y: y(value),
    }));
    const linePath = coordinates
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`,
      )
      .join(" ");
    const first = coordinates[0];
    const last = coordinates.at(-1);

    return {
      areaPath:
        first && last
          ? `${linePath} L${last.x.toFixed(2)},${plotBottom} L${first.x.toFixed(2)},${plotBottom} Z`
          : "",
      last,
      linePath,
    };
  }, [points]);

  const firstPrice = points[0]?.value ?? 0;
  const lastPrice = points.at(-1)?.value ?? 0;
  const change = firstPrice > 0 ? ((lastPrice / firstPrice) - 1) * 100 : 0;

  return (
    <div className="relative mt-7 h-[238px] w-full">
      <svg
        viewBox="0 0 720 238"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        className="h-full w-full overflow-visible"
        preserveAspectRatio="none"
      >
        <title id={titleId}>BTC price over the last 30 days</title>
        <desc id={descriptionId}>
          BTC moved {formatChange(change)} from {formatUsd(firstPrice)} to {formatUsd(lastPrice)}.
        </desc>
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#f97316" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[48, 99, 150, 201].map((y) => (
          <line
            key={y}
            x1="0"
            x2="720"
            y1={y}
            y2={y}
            stroke="#f4f4f5"
            strokeWidth="1"
          />
        ))}
        <path d={geometry.areaPath} fill={`url(#${gradientId})`} />
        <path
          d={geometry.linePath}
          fill="none"
          stroke="#18181b"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        {geometry.last && (
          <circle
            cx={geometry.last.x}
            cy={geometry.last.y}
            r="4"
            fill="#f97316"
            stroke="white"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between font-mono text-[11px] uppercase tracking-[0.05em] text-zinc-500">
        <span>30 days ago</span>
        <span>Today</span>
      </div>
    </div>
  );
}

export function PublicMarketPreview() {
  const [points, setPoints] = useState<BitcoinPriceHistoryPoint[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/bitcoin-price?history=30d", { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as HistoryResponse;
        const usablePoints = (payload.points ?? []).filter(
          (point) => Number.isFinite(point.value) && point.value > 0,
        );

        if (!response.ok || !payload.success || usablePoints.length < 2) {
          throw new Error("BTC history unavailable");
        }

        setPoints(usablePoints);
        setLoadState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPoints([]);
        setLoadState("error");
      });

    return () => controller.abort();
  }, []);

  const spot = points.at(-1)?.value ?? 0;
  const first = points[0]?.value ?? 0;
  const high = points.length > 0 ? Math.max(...points.map((point) => point.value)) : 0;
  const low = points.length > 0 ? Math.min(...points.map((point) => point.value)) : 0;
  const change = first > 0 ? ((spot / first) - 1) * 100 : 0;

  return (
    <section
      aria-labelledby="btc-market-preview-title"
      className="min-w-0 border-y-[0.5px] border-zinc-200 py-7 sm:py-9 lg:px-2"
    >
      <div className="flex items-end justify-between gap-5">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-zinc-500">
            BTC / USD
          </p>
          <h2
            id="btc-market-preview-title"
            className="mt-2 font-heading text-3xl font-bold tracking-[-0.035em] text-zinc-950 sm:text-4xl"
          >
            {loadState === "ready" ? formatUsd(spot) : "BTC market"}
          </h2>
        </div>
        {loadState === "ready" && (
          <div className="text-right">
            <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-zinc-500">
              30-day move
            </p>
            <p
              className={`mt-1 font-mono text-sm font-medium ${
                change >= 0 ? "text-green-600" : "text-red-600"
              }`}
            >
              {formatChange(change)}
            </p>
          </div>
        )}
      </div>

      {loadState === "ready" ? (
        <>
          <HistoryChart points={points} />
          <div className="mt-4 flex items-center justify-between border-t-[0.5px] border-zinc-100 pt-3 font-mono text-[11px] text-zinc-500">
            <span>30D low {formatUsd(low)}</span>
            <span>30D high {formatUsd(high)}</span>
          </div>

          <div className="mt-7 border-t-[0.5px] border-zinc-200">
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-5 py-3 font-mono text-[11px] uppercase tracking-[0.05em] text-zinc-500">
              <span>Cap above BTC</span>
              <span className="text-right">Example strike</span>
              <span className="w-16 text-right">Premium</span>
            </div>
            {strikeDistances.map((distance, index) => {
              const strike = Math.round((spot * (1 + distance / 100)) / 500) * 500;
              const premiumProfile = index === 0 ? "Higher" : index === 1 ? "Middle" : "Lower";

              return (
                <div
                  key={distance}
                  className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-5 border-t-[0.5px] border-zinc-100 py-3"
                >
                  <span className="font-mono text-xs text-orange-600">+{distance}%</span>
                  <span className="font-mono text-sm font-medium tabular-nums text-zinc-950">
                    {formatUsd(strike)}
                  </span>
                  <span className="w-16 text-right text-xs text-zinc-500">{premiumProfile}</span>
                </div>
              );
            })}
          </div>
        </>
      ) : loadState === "error" ? (
        <div
          role="status"
          className="mt-8 flex min-h-[238px] items-center border-y-[0.5px] border-zinc-100 py-8"
        >
          <div>
            <p className="text-sm font-medium text-zinc-800">BTC history is unavailable.</p>
            <p className="mt-2 max-w-sm text-xs leading-5 text-zinc-500">
              Open the market to load the latest BTC reference and covered-call terms.
            </p>
          </div>
        </div>
      ) : (
        <div
          role="status"
          aria-label="Loading 30-day BTC price history"
          className="mt-8 h-[238px] animate-pulse border-y-[0.5px] border-zinc-100 bg-[linear-gradient(180deg,transparent,#fafafa)]"
        />
      )}

      <div className="mt-5 flex flex-col items-start justify-between gap-3 border-t-[0.5px] border-zinc-200 pt-5 sm:flex-row sm:items-center sm:gap-5">
        <p className="max-w-sm text-[11px] leading-5 text-zinc-500">
          Premium direction is illustrative, not a quote. Executable premiums come from the live RFQ.
        </p>
        <Link
          href="/app"
          className="inline-flex min-h-11 shrink-0 items-center gap-2 font-mono text-xs text-zinc-950 hover:text-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-4"
        >
          Compare live terms <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
