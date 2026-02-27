"use client";

import { useState } from "react";
import { usePositions } from "@/hooks/portfolio/usePositions";
import { useCollaterals } from "@/hooks/portfolio/useCollaterals";
import { useOpenOrders } from "@/hooks/portfolio/useOpenOrders";
import { useDerive } from "@/providers/DeriveProvider";
import { FundsModal } from "@/components/portfolio/FundsModal";
import { formatUsd } from "@/lib/derive/utils";
import type { Collateral, Position, Order } from "@/lib/derive/types";

/** Parse instrument name like "BTC-20260306-68000-C" into readable parts */
function parseInstrument(name: string) {
  const parts = name.split("-");
  if (parts.length < 4) return { asset: name, expiry: "", strike: "", type: "" };
  const [asset, dateStr, strike, type] = parts;
  const year = dateStr.slice(0, 4);
  const month = dateStr.slice(4, 6);
  const day = dateStr.slice(6, 8);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthLabel = months[parseInt(month, 10) - 1] || month;
  return {
    asset,
    expiry: `${day} ${monthLabel} ${year}`,
    strike: `$${Number(strike).toLocaleString()}`,
    type: type === "C" ? "Call" : type === "P" ? "Put" : type,
  };
}

export default function PortfolioContent() {
  const { isAuthenticated, authenticate } = useDerive();
  const { data: positions = [], isLoading: posLoading } = usePositions();
  const { data: collaterals = [], isLoading: colLoading } = useCollaterals();
  const { data: openOrders = [], isLoading: ordLoading } = useOpenOrders();
  const [fundsTab, setFundsTab] = useState<"deposit" | "withdraw" | "bridge" | null>(null);

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen p-6" style={{ background: "#0b1018" }}>
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-center py-24 text-center">
          <div
            className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl"
            style={{ background: "rgba(34, 197, 94, 0.1)", border: "1px solid rgba(34, 197, 94, 0.2)" }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
              <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
              <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
            </svg>
          </div>
          <div className="mb-2 font-mono text-lg font-bold" style={{ color: "#e5e7eb" }}>
            Portfolio
          </div>
          <div className="mb-8 max-w-xs font-mono text-sm leading-relaxed" style={{ color: "#6b7280" }}>
            Sign in to view your balances, positions, and manage your funds on Derive.
          </div>
          <button
            onClick={authenticate}
            className="rounded-lg px-8 py-3 font-mono text-sm font-semibold transition-opacity hover:opacity-90"
            style={{ background: "#22c55e", color: "#0b1018" }}
          >
            Sign in to Derive
          </button>
        </div>
      </div>
    );
  }

  const totalValue = collaterals.reduce((sum, c) => sum + parseFloat(c.mark_value || "0"), 0);

  return (
    <div className="min-h-screen p-6" style={{ background: "#0b1018" }}>
      <div className="mx-auto max-w-5xl space-y-5">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div className="font-mono text-lg font-bold tracking-tight" style={{ color: "#e5e7eb" }}>
            Portfolio
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setFundsTab("deposit")}
              className="rounded-lg border px-4 py-2 font-mono text-xs font-semibold transition-all hover:brightness-125"
              style={{ borderColor: "rgba(34, 197, 94, 0.3)", background: "rgba(34, 197, 94, 0.08)", color: "#22c55e" }}
            >
              Deposit
            </button>
            <button
              onClick={() => setFundsTab("withdraw")}
              className="rounded-lg border px-4 py-2 font-mono text-xs font-semibold transition-all hover:brightness-125"
              style={{ borderColor: "#1e293b", background: "rgba(107, 114, 128, 0.08)", color: "#9ca3af" }}
            >
              Withdraw
            </button>
            <button
              onClick={() => setFundsTab("bridge")}
              className="rounded-lg border px-4 py-2 font-mono text-xs font-semibold transition-all hover:brightness-125"
              style={{ borderColor: "rgba(59, 130, 246, 0.3)", background: "rgba(59, 130, 246, 0.08)", color: "#3b82f6" }}
            >
              Bridge
            </button>
          </div>
        </div>

        {/* Balance + Assets row */}
        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          {/* Total balance card */}
          <div className="rounded-xl border p-5" style={{ borderColor: "#1e293b", background: "#111827" }}>
            <div className="mb-4 font-mono text-xs font-semibold uppercase tracking-widest" style={{ color: "#6b7280" }}>
              Account Value
            </div>
            {colLoading ? (
              <div className="h-12 w-40 animate-pulse rounded" style={{ background: "#1e293b" }} />
            ) : (
              <div className="font-mono text-4xl font-bold tracking-tight" style={{ color: "#e5e7eb" }}>
                {formatUsd(totalValue)}
              </div>
            )}
            <div className="mt-4 font-mono text-xs" style={{ color: "#4b5563" }}>
              on Derive L2
            </div>
          </div>

          {/* Asset cards */}
          <div className="rounded-xl border" style={{ borderColor: "#1e293b", background: "#111827" }}>
            <div className="border-b px-5 py-3" style={{ borderColor: "#1e293b" }}>
              <span className="font-mono text-xs font-semibold uppercase tracking-wider" style={{ color: "#6b7280" }}>
                Assets
              </span>
            </div>
            {colLoading ? (
              <div className="space-y-0">
                {[1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-4">
                    <div className="h-9 w-9 animate-pulse rounded-full" style={{ background: "#1e293b" }} />
                    <div className="flex-1">
                      <div className="mb-1 h-4 w-16 animate-pulse rounded" style={{ background: "#1e293b" }} />
                      <div className="h-3 w-24 animate-pulse rounded" style={{ background: "#1e293b" }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : collaterals.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <div className="mb-2 font-mono text-sm" style={{ color: "#6b7280" }}>No assets yet</div>
                <button
                  onClick={() => setFundsTab("deposit")}
                  className="font-mono text-xs font-semibold transition-colors hover:brightness-125"
                  style={{ color: "#22c55e" }}
                >
                  Deposit to get started
                </button>
              </div>
            ) : (
              <div>
                {collaterals.map((c, i) => (
                  <AssetRow
                    key={c.asset_name}
                    collateral={c}
                    isLast={i === collaterals.length - 1}
                    onDeposit={() => setFundsTab("deposit")}
                    onWithdraw={() => setFundsTab("withdraw")}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Positions */}
        <div className="rounded-xl border" style={{ borderColor: "#1e293b", background: "#111827" }}>
          <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: "#1e293b" }}>
            <span className="font-mono text-xs font-semibold uppercase tracking-wider" style={{ color: "#6b7280" }}>
              Open Positions
            </span>
            {positions.length > 0 && (
              <span className="rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold" style={{ background: "rgba(34, 197, 94, 0.1)", color: "#22c55e" }}>
                {positions.length}
              </span>
            )}
          </div>
          {posLoading ? (
            <div className="space-y-0 p-5">
              {[1, 2].map((i) => (
                <div key={i} className="mb-3 h-14 animate-pulse rounded-lg" style={{ background: "#1e293b" }} />
              ))}
            </div>
          ) : positions.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <div className="mb-1 font-mono text-sm" style={{ color: "#6b7280" }}>No open positions</div>
              <div className="font-mono text-[11px]" style={{ color: "#4b5563" }}>
                Sell a covered call from the trade page to get started
              </div>
            </div>
          ) : (
            <div>
              {positions.map((pos, i) => (
                <PositionRow key={pos.instrument_name} pos={pos} isLast={i === positions.length - 1} />
              ))}
            </div>
          )}
        </div>

        {/* Open Orders */}
        {openOrders.length > 0 && (
          <div className="rounded-xl border" style={{ borderColor: "#1e293b", background: "#111827" }}>
            <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: "#1e293b" }}>
              <span className="font-mono text-xs font-semibold uppercase tracking-wider" style={{ color: "#6b7280" }}>
                Open Orders
              </span>
              <span className="rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold" style={{ background: "rgba(245, 158, 11, 0.1)", color: "#f59e0b" }}>
                {openOrders.length}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-xs">
                <thead>
                  <tr style={{ borderBottom: "1px solid #1e293b" }}>
                    <th className="px-5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#4b5563" }}>Instrument</th>
                    <th className="px-5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#4b5563" }}>Side</th>
                    <th className="px-5 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#4b5563" }}>Size</th>
                    <th className="px-5 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#4b5563" }}>Price</th>
                    <th className="px-5 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#4b5563" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {openOrders.map((order) => (
                    <OrderRow key={order.order_id} order={order} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <FundsModal
        open={fundsTab !== null}
        onClose={() => setFundsTab(null)}
        collaterals={collaterals}
        initialTab={fundsTab ?? "deposit"}
      />
    </div>
  );
}

function AssetRow({ collateral: c, isLast, onDeposit, onWithdraw }: { collateral: Collateral; isLast: boolean; onDeposit: () => void; onWithdraw: () => void }) {
  const amount = parseFloat(c.amount);
  const value = parseFloat(c.mark_value || "0");
  const isStable = c.asset_name === "USDC" || c.asset_name === "USDT";

  return (
    <div
      className="flex items-center justify-between px-5 py-3.5 transition-colors"
      style={{ borderBottom: isLast ? "none" : "1px solid #1e293b" }}
    >
      <div className="flex items-center gap-3">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-full font-mono text-xs font-bold"
          style={{
            background: isStable ? "rgba(59, 130, 246, 0.12)" : "rgba(245, 158, 11, 0.12)",
            color: isStable ? "#3b82f6" : "#f59e0b",
          }}
        >
          {isStable ? "$" : "₿"}
        </div>
        <div>
          <div className="font-mono text-sm font-semibold" style={{ color: "#e5e7eb" }}>
            {c.asset_name}
          </div>
          <div className="font-mono text-[11px]" style={{ color: "#6b7280" }}>
            {amount.toFixed(isStable ? 2 : 6)} {c.asset_name}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className="font-mono text-sm font-semibold" style={{ color: "#e5e7eb" }}>
            {formatUsd(value)}
          </div>
        </div>
        <div className="flex gap-1">
          <button
            onClick={onDeposit}
            className="flex h-7 w-7 items-center justify-center rounded-md font-mono text-xs font-bold transition-all hover:brightness-150"
            style={{ color: "#22c55e", background: "rgba(34, 197, 94, 0.1)" }}
            title="Deposit"
          >
            +
          </button>
          <button
            onClick={onWithdraw}
            className="flex h-7 w-7 items-center justify-center rounded-md font-mono text-xs font-bold transition-all hover:brightness-150"
            style={{ color: "#9ca3af", background: "rgba(107, 114, 128, 0.1)" }}
            title="Withdraw"
          >
            -
          </button>
        </div>
      </div>
    </div>
  );
}

function PositionRow({ pos, isLast }: { pos: Position; isLast: boolean }) {
  const pnl = parseFloat(pos.unrealized_pnl || "0");
  const isLong = pos.direction === "buy";
  const parsed = parseInstrument(pos.instrument_name);
  const absSize = Math.abs(parseFloat(pos.amount));

  return (
    <div
      className="flex items-center justify-between px-5 py-4"
      style={{ borderBottom: isLast ? "none" : "1px solid #1e293b" }}
    >
      {/* Left: instrument info */}
      <div className="flex items-center gap-3">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg font-mono text-[10px] font-bold"
          style={{
            background: isLong ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)",
            color: isLong ? "#22c55e" : "#ef4444",
            border: `1px solid ${isLong ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.2)"}`,
          }}
        >
          {isLong ? "L" : "S"}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold" style={{ color: "#e5e7eb" }}>
              {parsed.asset} {parsed.strike} {parsed.type}
            </span>
            <span
              className="rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase"
              style={{
                background: isLong ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)",
                color: isLong ? "#22c55e" : "#ef4444",
              }}
            >
              {isLong ? "Long" : "Short"}
            </span>
          </div>
          <div className="mt-0.5 font-mono text-[11px]" style={{ color: "#6b7280" }}>
            {parsed.expiry} · {absSize.toFixed(4)} contracts
          </div>
        </div>
      </div>

      {/* Right: prices + PnL */}
      <div className="flex items-center gap-6">
        <div className="text-right">
          <div className="font-mono text-[10px]" style={{ color: "#4b5563" }}>Entry</div>
          <div className="font-mono text-xs font-medium" style={{ color: "#9ca3af" }}>
            {formatUsd(pos.average_price)}
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-[10px]" style={{ color: "#4b5563" }}>Mark</div>
          <div className="font-mono text-xs font-medium" style={{ color: "#9ca3af" }}>
            {formatUsd(pos.mark_price)}
          </div>
        </div>
        <div className="text-right" style={{ minWidth: "72px" }}>
          <div className="font-mono text-[10px]" style={{ color: "#4b5563" }}>PnL</div>
          <div className="font-mono text-xs font-semibold" style={{ color: pnl >= 0 ? "#22c55e" : "#ef4444" }}>
            {pnl >= 0 ? "+" : ""}{formatUsd(pnl)}
          </div>
        </div>
      </div>
    </div>
  );
}

function OrderRow({ order }: { order: Order }) {
  const isBuy = order.direction === "buy";
  const parsed = parseInstrument(order.instrument_name);

  return (
    <tr style={{ borderBottom: "1px solid #1e293b" }}>
      <td className="px-5 py-3">
        <div className="font-medium" style={{ color: "#e5e7eb" }}>
          {parsed.asset} {parsed.strike} {parsed.type}
        </div>
        <div className="text-[10px]" style={{ color: "#6b7280" }}>{parsed.expiry}</div>
      </td>
      <td className="px-5 py-3">
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
          style={{
            background: isBuy ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)",
            color: isBuy ? "#22c55e" : "#ef4444",
          }}
        >
          {isBuy ? "BUY" : "SELL"}
        </span>
      </td>
      <td className="px-5 py-3 text-right" style={{ color: "#e5e7eb" }}>
        {parseFloat(order.amount).toFixed(4)}
      </td>
      <td className="px-5 py-3 text-right" style={{ color: "#9ca3af" }}>
        {formatUsd(order.limit_price)}
      </td>
      <td className="px-5 py-3 text-right">
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
          style={{ background: "rgba(245, 158, 11, 0.1)", color: "#f59e0b" }}
        >
          {order.status}
        </span>
      </td>
    </tr>
  );
}
