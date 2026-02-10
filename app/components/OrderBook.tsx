"use client";

import { useEffect, useState, useCallback } from "react";
import type { Ticker } from "@/lib/derive/types";
import TerminalCard from "./TerminalCard";

interface OrderBookLevel {
  price: string;
  amount: string;
}

interface OrderBookData {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

export default function OrderBook({
  selectedInstrument,
}: {
  selectedInstrument: string;
}) {
  const [ticker, setTicker] = useState<Ticker | null>(null);
  const [orderbook, setOrderbook] = useState<OrderBookData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [tickerRes, orderbookRes] = await Promise.all([
        fetch("/api/derive/ticker", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instrument_name: selectedInstrument }),
        }),
        fetch("/api/derive/orderbook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instrument_name: selectedInstrument,
            depth: 10,
          }),
        }),
      ]);

      const tickerData = await tickerRes.json();
      if (tickerData.result) setTicker(tickerData.result);

      const orderbookData = await orderbookRes.json();
      if (orderbookData.result) setOrderbook(orderbookData.result);
    } catch (err) {
      console.error("Failed to fetch orderbook:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedInstrument]);

  useEffect(() => {
    setLoading(true);
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const formatPrice = (p: string | undefined) => {
    if (!p) return "---";
    return parseFloat(p).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const formatAmount = (a: string | undefined) => {
    if (!a) return "---";
    return parseFloat(a).toFixed(4);
  };

  const asks = orderbook?.asks?.slice(0, 8).reverse() ?? [];
  const bids = orderbook?.bids?.slice(0, 8) ?? [];

  // Check if this is an option instrument
  const isOption = selectedInstrument.split("-").length === 4;
  const greeks = ticker?.option_pricing;

  return (
    <TerminalCard title="~/orderbook">
      <div className="p-4">
        <div className="mb-3 font-mono text-xs text-[#6b6560]">
          {selectedInstrument}
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-6 animate-pulse rounded bg-[#e5dfd6]"
              />
            ))}
          </div>
        ) : !ticker ? (
          <p className="font-mono text-sm text-[#9b9590]">
            No data available
          </p>
        ) : (
          <div>
            {/* Column Headers */}
            <div className="dashed-border mb-0 flex justify-between pb-2 font-mono text-[10px] uppercase tracking-wider text-[#9b9590]">
              <span>Price</span>
              <span>Amount</span>
            </div>

            {/* Asks (sells) - red */}
            {asks.length > 0 ? (
              asks.map((ask, i) => (
                <div
                  key={`ask-${i}`}
                  className="flex items-center justify-between px-2 py-1.5"
                >
                  <span className="font-mono text-sm text-[#ef4444]">
                    ${formatPrice(ask.price)}
                  </span>
                  <span className="font-mono text-xs text-[#6b6560]">
                    {formatAmount(ask.amount)}
                  </span>
                </div>
              ))
            ) : (
              <div className="flex items-center justify-between px-2 py-1.5">
                <span className="font-mono text-sm text-[#ef4444]">
                  ${formatPrice(ticker.best_ask_price)}
                </span>
                <span className="font-mono text-xs text-[#6b6560]">
                  {formatAmount(ticker.best_ask_amount)}
                </span>
              </div>
            )}

            {/* Mark Price - center */}
            <div className="flex items-center justify-center border-y border-[#d4cfc6] py-3">
              <div className="text-center">
                <div className="font-mono text-xl font-bold text-[#1a1a1a]">
                  ${formatPrice(ticker.mark_price)}
                </div>
                <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-[#9b9590]">
                  Mark Price
                </div>
              </div>
            </div>

            {/* Bids (buys) - green */}
            {bids.length > 0 ? (
              bids.map((bid, i) => (
                <div
                  key={`bid-${i}`}
                  className="flex items-center justify-between px-2 py-1.5"
                >
                  <span className="font-mono text-sm text-[#22c55e]">
                    ${formatPrice(bid.price)}
                  </span>
                  <span className="font-mono text-xs text-[#6b6560]">
                    {formatAmount(bid.amount)}
                  </span>
                </div>
              ))
            ) : (
              <div className="flex items-center justify-between px-2 py-1.5">
                <span className="font-mono text-sm text-[#22c55e]">
                  ${formatPrice(ticker.best_bid_price)}
                </span>
                <span className="font-mono text-xs text-[#6b6560]">
                  {formatAmount(ticker.best_bid_amount)}
                </span>
              </div>
            )}

            {/* Stats Grid */}
            <div className="mt-3 grid grid-cols-3 gap-0 border-t border-[#d4cfc6]">
              {isOption && greeks ? (
                // Option-specific stats
                [
                  { label: "IV", value: greeks.mark_iv ? `${(parseFloat(greeks.mark_iv) * 100).toFixed(1)}%` : "---" },
                  { label: "Delta", value: greeks.delta ? parseFloat(greeks.delta).toFixed(4) : "---" },
                  { label: "Gamma", value: greeks.gamma ? parseFloat(greeks.gamma).toFixed(6) : "---" },
                  { label: "Theta", value: greeks.theta ? parseFloat(greeks.theta).toFixed(4) : "---" },
                  { label: "Vega", value: greeks.vega ? parseFloat(greeks.vega).toFixed(4) : "---" },
                  { label: "OI", value: ticker.stats?.open_interest ? parseFloat(ticker.stats.open_interest).toFixed(2) : "---" },
                ].map((stat, i) => (
                  <div
                    key={stat.label}
                    className={`px-3 py-2.5 ${i < 3 ? "dashed-border" : ""} ${
                      i % 3 !== 2
                        ? "border-r border-dashed border-[#c8c3ba]"
                        : ""
                    }`}
                  >
                    <div className="font-mono text-[10px] uppercase tracking-wider text-[#9b9590]">
                      {stat.label}
                    </div>
                    <div className="mt-0.5 font-mono text-sm text-[#1a1a1a]">
                      {stat.value}
                    </div>
                  </div>
                ))
              ) : (
                // Perp/generic stats
                [
                  { label: "Index", value: `$${formatPrice(ticker.index_price)}` },
                  { label: "24h Vol", value: ticker.stats?.contract_volume ? parseFloat(ticker.stats.contract_volume).toFixed(2) : "---" },
                  { label: "Open Interest", value: ticker.stats?.open_interest ? parseFloat(ticker.stats.open_interest).toFixed(2) : "---" },
                  { label: "24h High", value: `$${formatPrice(ticker.stats?.high)}` },
                  { label: "24h Low", value: `$${formatPrice(ticker.stats?.low)}` },
                  { label: "Last Price", value: `$${formatPrice(ticker.last_price || ticker.mark_price)}` },
                ].map((stat, i) => (
                  <div
                    key={stat.label}
                    className={`px-3 py-2.5 ${i < 3 ? "dashed-border" : ""} ${
                      i % 3 !== 2
                        ? "border-r border-dashed border-[#c8c3ba]"
                        : ""
                    }`}
                  >
                    <div className="font-mono text-[10px] uppercase tracking-wider text-[#9b9590]">
                      {stat.label}
                    </div>
                    <div className="mt-0.5 font-mono text-sm text-[#1a1a1a]">
                      {stat.value}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </TerminalCard>
  );
}
