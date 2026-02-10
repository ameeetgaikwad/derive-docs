"use client";

import { useEffect, useState, useCallback } from "react";
import { useAccount } from "wagmi";
import TerminalCard from "./TerminalCard";
import { useDeriveSession } from "./DeriveSessionProvider";

interface Position {
  instrument_name: string;
  direction: "buy" | "sell";
  amount: string;
  average_price: string;
  mark_price: string;
  index_price: string;
  unrealized_pnl: string;
  realized_pnl: string;
}

/** Parse option instrument name: ETH-20250329-2000-C */
function parseOptionInstrument(name: string) {
  const parts = name.split("-");
  if (parts.length !== 4) return null;
  const [, dateStr, strikeStr, type] = parts;
  const year = dateStr.slice(0, 4);
  const month = dateStr.slice(4, 6);
  const day = dateStr.slice(6, 8);
  return {
    strike: strikeStr,
    expiry: new Date(`${year}-${month}-${day}`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    type: type === "C" ? "Call" : "Put",
    typeShort: type,
  };
}

export default function Positions() {
  const { address, isConnected } = useAccount();
  const { isAuthenticated, subaccountId, getAuthHeaders } = useDeriveSession();
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPositions = useCallback(async () => {
    if (!address || !subaccountId) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/derive/positions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ subaccount_id: subaccountId }),
      });

      const data = await res.json();

      if (data.error) {
        setError(data.error);
        return;
      }

      const posArr = data.result?.positions || data.result || [];
      setPositions(Array.isArray(posArr) ? posArr : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, [address, subaccountId, getAuthHeaders]);

  useEffect(() => {
    if (isAuthenticated && subaccountId) {
      fetchPositions();
      const interval = setInterval(fetchPositions, 15000);
      return () => clearInterval(interval);
    } else {
      setPositions([]);
    }
  }, [isAuthenticated, subaccountId, fetchPositions]);

  const columns = ["Instrument", "Type", "Strike", "Expiry", "Side", "Size", "Entry", "Mark", "uPnL"];

  const formatPrice = (val: string) => {
    const n = parseFloat(val);
    if (isNaN(n)) return val;
    return n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const formatPnl = (val: string) => {
    const n = parseFloat(val);
    if (isNaN(n)) return val;
    const formatted = n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return n >= 0
      ? `+$${formatted}`
      : `-$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <TerminalCard title="~/positions">
      {!isConnected ? (
        <div className="px-4 py-8 text-center">
          <p className="font-mono text-sm text-[#9b9590]">
            Connect wallet to view positions
          </p>
        </div>
      ) : !isAuthenticated ? (
        <div className="px-4 py-8 text-center">
          <p className="font-mono text-sm text-[#9b9590]">
            Sign in to Derive to view positions
          </p>
        </div>
      ) : !subaccountId ? (
        <div className="px-4 py-8 text-center">
          <p className="font-mono text-sm text-[#9b9590]">
            Set a subaccount to view positions
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="dashed-border">
                {columns.map((col) => (
                  <th
                    key={col}
                    className="px-3 py-2.5 text-left font-mono text-[10px] uppercase tracking-wider text-[#9b9590]"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && positions.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-4 py-10 text-center font-mono text-sm text-[#9b9590]"
                  >
                    Loading positions...
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-4 py-10 text-center font-mono text-xs text-[#ef4444]"
                  >
                    {error}
                  </td>
                </tr>
              ) : positions.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-4 py-10 text-center font-mono text-sm text-[#9b9590]"
                  >
                    No open positions
                  </td>
                </tr>
              ) : (
                positions.map((pos) => {
                  const pnl = parseFloat(pos.unrealized_pnl);
                  const opt = parseOptionInstrument(pos.instrument_name);
                  return (
                    <tr key={pos.instrument_name} className="dashed-border">
                      <td className="px-3 py-2.5 font-mono text-xs font-medium text-[#1a1a1a]">
                        {pos.instrument_name}
                      </td>
                      <td className="px-3 py-2.5">
                        {opt ? (
                          <span
                            className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-medium ${
                              opt.typeShort === "C"
                                ? "bg-[#22c55e]/10 text-[#22c55e]"
                                : "bg-[#ef4444]/10 text-[#ef4444]"
                            }`}
                          >
                            {opt.type}
                          </span>
                        ) : (
                          <span className="font-mono text-xs text-[#9b9590]">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-[#1a1a1a]">
                        {opt ? `$${parseFloat(opt.strike).toLocaleString()}` : "-"}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-[#6b6560]">
                        {opt ? opt.expiry : "-"}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`font-mono text-xs font-medium ${
                            pos.direction === "buy"
                              ? "text-[#22c55e]"
                              : "text-[#ef4444]"
                          }`}
                        >
                          {pos.direction === "buy" ? "Long" : "Short"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-[#1a1a1a]">
                        {pos.amount}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-[#1a1a1a]">
                        ${formatPrice(pos.average_price)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-[#1a1a1a]">
                        ${formatPrice(pos.mark_price)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`font-mono text-xs font-medium ${
                            pnl >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"
                          }`}
                        >
                          {formatPnl(pos.unrealized_pnl)}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </TerminalCard>
  );
}
