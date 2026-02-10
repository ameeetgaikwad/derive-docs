"use client";

import { useState, useEffect } from "react";
import TerminalCard from "./TerminalCard";
import { calculateAPR, daysToExpiry } from "@/lib/derive/apr";
import type { Instrument, Ticker } from "@/lib/derive/types";

type StrategyType = "covered_call" | "cash_secured_put";

interface AssetRow {
  asset: string;
  type: StrategyType;
  maxAPR: number;
  minAPR: number;
  instrumentCount: number;
}

interface AssetsListProps {
  onEarn: (asset: string, type: StrategyType) => void;
}

const SUPPORTED_CURRENCIES = ["ETH", "BTC"];

export default function AssetsList({ onEarn }: AssetsListProps) {
  const [tab, setTab] = useState<StrategyType>("covered_call");
  const [rows, setRows] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [capPercent] = useState(42); // placeholder cap

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      const allRows: AssetRow[] = [];

      for (const currency of SUPPORTED_CURRENCIES) {
        try {
          // Fetch option instruments
          const instRes = await fetch("/api/derive/instruments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              currency,
              instrument_type: "option",
              expired: false,
            }),
          });
          const instData = await instRes.json();
          const instruments: Instrument[] = instData.result || [];
          if (instruments.length === 0) continue;

          // Extract unique expiry dates (YYYYMMDD) from active instruments
          const expiryDates = new Set<string>();
          for (const inst of instruments) {
            if (!inst.is_active) continue;
            const expEpoch = inst.option_details?.expiry || inst.expiry;
            if (!expEpoch || daysToExpiry(expEpoch) <= 0) continue;
            const d = new Date(expEpoch * 1000);
            expiryDates.add(d.toISOString().slice(0, 10).replace(/-/g, ""));
          }

          // Fetch tickers per expiry (limit to first 3 expiries to avoid too many calls)
          const sortedExpiries = Array.from(expiryDates).sort().slice(0, 3);
          const allTickers: Ticker[] = [];
          for (const expiryDate of sortedExpiries) {
            try {
              const tickerRes = await fetch("/api/derive/tickers", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  currency,
                  instrument_type: "option",
                  expiry_date: expiryDate,
                }),
              });
              const tickerData = await tickerRes.json();
              const tickers: Ticker[] = tickerData.result || [];
              if (Array.isArray(tickers)) allTickers.push(...tickers);
            } catch {
              // skip failed expiry
            }
          }

          // Also fetch spot price
          let spotPrice = 0;
          try {
            const spotRes = await fetch("/api/derive/ticker", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ instrument_name: `${currency}-PERP` }),
            });
            const spotData = await spotRes.json();
            spotPrice = parseFloat(spotData.result?.index_price || "0");
          } catch {
            // ignore
          }

          // Build ticker map
          const tickerMap = new Map<string, Ticker>();
          for (const t of allTickers) {
            tickerMap.set(t.instrument_name, t);
          }

          // Calculate APRs for calls and puts
          const callAPRs: number[] = [];
          const putAPRs: number[] = [];

          for (const inst of instruments) {
            if (!inst.is_active) continue;
            const ticker = tickerMap.get(inst.instrument_name);
            if (!ticker) continue;
            const bidPrice = parseFloat(ticker.best_bid_price || "0");
            if (bidPrice <= 0) continue;

            // Use nested option_details, fall back to flat fields
            const optType = inst.option_details?.option_type || inst.option_type;
            const expEpoch = inst.option_details?.expiry || inst.expiry;
            const strikeStr = inst.option_details?.strike || inst.strike;

            const dte = expEpoch ? daysToExpiry(expEpoch) : 0;
            if (dte <= 0) continue;
            const strike = parseFloat(strikeStr || "0");

            if (optType === "C" && spotPrice > 0) {
              callAPRs.push(calculateAPR(bidPrice, spotPrice, dte));
            } else if (optType === "P" && strike > 0) {
              putAPRs.push(calculateAPR(bidPrice, strike, dte));
            }
          }

          if (callAPRs.length > 0) {
            callAPRs.sort((a, b) => a - b);
            allRows.push({
              asset: currency,
              type: "covered_call",
              maxAPR: callAPRs[callAPRs.length - 1],
              minAPR: callAPRs[0],
              instrumentCount: callAPRs.length,
            });
          }

          if (putAPRs.length > 0) {
            putAPRs.sort((a, b) => a - b);
            allRows.push({
              asset: currency,
              type: "cash_secured_put",
              maxAPR: putAPRs[putAPRs.length - 1],
              minAPR: putAPRs[0],
              instrumentCount: putAPRs.length,
            });
          }
        } catch {
          // skip failed currencies
        }
      }

      if (!cancelled) {
        setRows(allRows);
        setLoading(false);
      }
    }

    fetchData();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredRows = rows.filter((r) => r.type === tab);

  return (
    <TerminalCard title="~/assets">
      {/* Cap progress bar */}
      <div className="border-b border-dashed border-[#c8c3ba] px-5 py-3">
        <div className="flex items-center justify-between font-mono text-xs text-[#6b6560]">
          <span>Vault Cap</span>
          <span className="font-medium text-[#1a1a1a]">{capPercent}% sold</span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[#e5dfd6]">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${capPercent}%`,
              background: "linear-gradient(90deg, #22c55e, #16a34a)",
            }}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-3 border-b border-dashed border-[#c8c3ba] px-5 py-3">
        <button
          onClick={() => setTab("covered_call")}
          className={`tab-btn ${tab === "covered_call" ? "active" : ""}`}
        >
          covered calls
        </button>
        <button
          onClick={() => setTab("cash_secured_put")}
          className={`tab-btn ${tab === "cash_secured_put" ? "active" : ""}`}
        >
          cash secured puts
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="dashed-border">
              {["Asset", "Type", "Max APR", "Min APR", "Strikes", ""].map(
                (col) => (
                  <th
                    key={col}
                    className="px-5 py-2.5 text-left font-mono text-[10px] uppercase tracking-wider text-[#9b9590]"
                  >
                    {col}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-5 py-12 text-center font-mono text-sm text-[#9b9590]"
                >
                  Loading assets...
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-5 py-12 text-center font-mono text-sm text-[#9b9590]"
                >
                  No {tab === "covered_call" ? "covered call" : "cash secured put"} opportunities found
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => (
                <tr key={`${row.asset}-${row.type}`} className="dashed-border">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#f0ebe3] font-mono text-[10px] font-bold text-[#6b6560]">
                        {row.asset.slice(0, 2)}
                      </div>
                      <span className="font-mono text-sm font-medium text-[#1a1a1a]">
                        {row.asset}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span className="rounded border border-[#d4cfc6] bg-[#f8f5f0] px-2 py-0.5 font-mono text-[10px] uppercase text-[#6b6560]">
                      {row.type === "covered_call" ? "Call" : "Put"}
                    </span>
                  </td>
                  <td className="px-5 py-3 font-mono text-sm font-semibold text-[#16a34a]">
                    {row.maxAPR.toFixed(1)}%
                  </td>
                  <td className="px-5 py-3 font-mono text-sm text-[#6b6560]">
                    {row.minAPR.toFixed(1)}%
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-[#9b9590]">
                    {row.instrumentCount}
                  </td>
                  <td className="px-5 py-3">
                    <button
                      onClick={() => onEarn(row.asset, row.type)}
                      className="rounded-lg border border-[#1a1a1a] bg-white px-4 py-1.5 font-mono text-xs font-medium text-[#1a1a1a] transition-all hover:bg-[#1a1a1a] hover:text-white"
                    >
                      Earn on {row.asset}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </TerminalCard>
  );
}
