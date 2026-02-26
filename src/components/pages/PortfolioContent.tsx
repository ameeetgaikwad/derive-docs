"use client";

import { useState } from "react";
import { usePositions } from "@/hooks/portfolio/usePositions";
import { useCollaterals } from "@/hooks/portfolio/useCollaterals";
import { useOpenOrders } from "@/hooks/portfolio/useOpenOrders";
import { useDerive } from "@/providers/DeriveProvider";
import { FundsModal } from "@/components/portfolio/FundsModal";
import { formatUsd } from "@/lib/derive/utils";
import type { Collateral, Position, Order } from "@/lib/derive/types";

export default function PortfolioContent() {
  const { isAuthenticated, authenticate } = useDerive();
  const { data: positions = [], isLoading: posLoading } = usePositions();
  const { data: collaterals = [], isLoading: colLoading } = useCollaterals();
  const { data: openOrders = [], isLoading: ordLoading } = useOpenOrders();
  const [fundsTab, setFundsTab] = useState<"deposit" | "withdraw" | "bridge" | null>(null);

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen p-6" style={{ background: "#0b1018" }}>
        <div className="mx-auto flex max-w-4xl flex-col items-center justify-center py-20 text-center">
          <div className="mb-2 font-mono text-xl font-bold" style={{ color: "#e5e7eb" }}>
            Portfolio
          </div>
          <div className="mb-6 font-mono text-sm" style={{ color: "#6b7280" }}>
            Connect your wallet and sign in to view your portfolio
          </div>
          <button
            onClick={authenticate}
            className="rounded-lg px-6 py-2.5 font-mono text-sm font-semibold"
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
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="font-mono text-lg font-bold" style={{ color: "#e5e7eb" }}>Portfolio</div>
          <div className="flex gap-2">
            <button
              onClick={() => setFundsTab("deposit")}
              className="rounded-lg border px-4 py-1.5 font-mono text-xs font-semibold transition-colors"
              style={{ borderColor: "rgba(34, 197, 94, 0.3)", background: "rgba(34, 197, 94, 0.1)", color: "#22c55e" }}
            >
              Deposit
            </button>
            <button
              onClick={() => setFundsTab("bridge")}
              className="rounded-lg border px-4 py-1.5 font-mono text-xs font-semibold transition-colors"
              style={{ borderColor: "rgba(59, 130, 246, 0.3)", background: "rgba(59, 130, 246, 0.1)", color: "#3b82f6" }}
            >
              Bridge
            </button>
          </div>
        </div>

        {/* Total balance card */}
        <div className="rounded-xl border p-6" style={{ borderColor: "#1e293b", background: "#111827" }}>
          <div className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#6b7280" }}>
            Total Balance
          </div>
          {colLoading ? (
            <div className="h-8 w-40 animate-pulse rounded" style={{ background: "#1e293b" }} />
          ) : (
            <div className="font-mono text-2xl font-bold" style={{ color: "#e5e7eb" }}>
              {formatUsd(totalValue)}
            </div>
          )}
        </div>

        {/* Asset balances */}
        <div className="rounded-xl border" style={{ borderColor: "#1e293b", background: "#111827" }}>
          <div className="border-b px-5 py-3" style={{ borderColor: "#1e293b" }}>
            <span className="font-mono text-sm font-semibold" style={{ color: "#e5e7eb" }}>Assets</span>
          </div>
          {colLoading ? (
            <div className="space-y-3 p-5">
              {[1, 2].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg" style={{ background: "#1e293b" }} />
              ))}
            </div>
          ) : collaterals.length === 0 ? (
            <div className="p-8 text-center">
              <div className="mb-2 font-mono text-sm" style={{ color: "#6b7280" }}>No assets deposited</div>
              <button
                onClick={() => setFundsTab("deposit")}
                className="font-mono text-xs font-semibold"
                style={{ color: "#22c55e" }}
              >
                Deposit to get started
              </button>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: "#1e293b" }}>
              {collaterals.map((c) => (
                <AssetRow key={c.asset_name} collateral={c} onDeposit={() => setFundsTab("deposit")} onWithdraw={() => setFundsTab("withdraw")} />
              ))}
            </div>
          )}
        </div>

        {/* Positions */}
        <div className="rounded-xl border" style={{ borderColor: "#1e293b", background: "#111827" }}>
          <div className="border-b px-5 py-3" style={{ borderColor: "#1e293b" }}>
            <span className="font-mono text-sm font-semibold" style={{ color: "#e5e7eb" }}>Open Positions</span>
          </div>
          {posLoading ? (
            <div className="space-y-3 p-5">
              {[1, 2].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-lg" style={{ background: "#1e293b" }} />
              ))}
            </div>
          ) : positions.length === 0 ? (
            <div className="p-8 text-center font-mono text-sm" style={{ color: "#6b7280" }}>
              No open positions
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-xs">
                <thead>
                  <tr className="border-b" style={{ borderColor: "#1e293b" }}>
                    <th className="px-5 py-2 text-left font-medium" style={{ color: "#6b7280" }}>Instrument</th>
                    <th className="px-5 py-2 text-left font-medium" style={{ color: "#6b7280" }}>Side</th>
                    <th className="px-5 py-2 text-right font-medium" style={{ color: "#6b7280" }}>Size</th>
                    <th className="px-5 py-2 text-right font-medium" style={{ color: "#6b7280" }}>Entry</th>
                    <th className="px-5 py-2 text-right font-medium" style={{ color: "#6b7280" }}>Mark</th>
                    <th className="px-5 py-2 text-right font-medium" style={{ color: "#6b7280" }}>PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((pos) => (
                    <PositionRow key={pos.instrument_name} pos={pos} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Open Orders */}
        {openOrders.length > 0 && (
          <div className="rounded-xl border" style={{ borderColor: "#1e293b", background: "#111827" }}>
            <div className="border-b px-5 py-3" style={{ borderColor: "#1e293b" }}>
              <span className="font-mono text-sm font-semibold" style={{ color: "#e5e7eb" }}>Open Orders</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-xs">
                <thead>
                  <tr className="border-b" style={{ borderColor: "#1e293b" }}>
                    <th className="px-5 py-2 text-left font-medium" style={{ color: "#6b7280" }}>Instrument</th>
                    <th className="px-5 py-2 text-left font-medium" style={{ color: "#6b7280" }}>Side</th>
                    <th className="px-5 py-2 text-right font-medium" style={{ color: "#6b7280" }}>Size</th>
                    <th className="px-5 py-2 text-right font-medium" style={{ color: "#6b7280" }}>Price</th>
                    <th className="px-5 py-2 text-right font-medium" style={{ color: "#6b7280" }}>Status</th>
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

function AssetRow({ collateral: c, onDeposit, onWithdraw }: { collateral: Collateral; onDeposit: () => void; onWithdraw: () => void }) {
  const amount = parseFloat(c.amount);
  const value = parseFloat(c.mark_value || "0");

  return (
    <div className="flex items-center justify-between px-5 py-3">
      <div className="flex items-center gap-3">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-full font-mono text-[10px] font-bold"
          style={{
            background: c.asset_name === "USDC" ? "rgba(59, 130, 246, 0.15)" : "rgba(245, 158, 11, 0.15)",
            color: c.asset_name === "USDC" ? "#3b82f6" : "#f59e0b",
          }}
        >
          {c.asset_name === "USDC" ? "$" : "₿"}
        </div>
        <div>
          <div className="font-mono text-sm font-semibold" style={{ color: "#e5e7eb" }}>{c.asset_name}</div>
          <div className="font-mono text-[10px]" style={{ color: "#6b7280" }}>
            {amount.toFixed(c.asset_name === "USDC" ? 2 : 6)}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <div className="font-mono text-sm font-semibold" style={{ color: "#e5e7eb" }}>
            {formatUsd(value)}
          </div>
        </div>
        <div className="flex gap-1">
          <button
            onClick={onDeposit}
            className="rounded-md px-2 py-1 font-mono text-[10px] font-semibold"
            style={{ color: "#22c55e", background: "rgba(34, 197, 94, 0.1)" }}
          >
            +
          </button>
          <button
            onClick={onWithdraw}
            className="rounded-md px-2 py-1 font-mono text-[10px] font-semibold"
            style={{ color: "#6b7280", background: "rgba(107, 114, 128, 0.1)" }}
          >
            -
          </button>
        </div>
      </div>
    </div>
  );
}

function PositionRow({ pos }: { pos: Position }) {
  const pnl = parseFloat(pos.unrealized_pnl || "0");
  const isLong = pos.direction === "buy";

  return (
    <tr className="border-b transition-colors" style={{ borderColor: "#1e293b" }}>
      <td className="px-5 py-3 font-medium" style={{ color: "#e5e7eb" }}>
        {pos.instrument_name}
      </td>
      <td className="px-5 py-3">
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
          style={{
            background: isLong ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)",
            color: isLong ? "#22c55e" : "#ef4444",
          }}
        >
          {isLong ? "LONG" : "SHORT"}
        </span>
      </td>
      <td className="px-5 py-3 text-right" style={{ color: "#e5e7eb" }}>
        {parseFloat(pos.amount).toFixed(4)}
      </td>
      <td className="px-5 py-3 text-right" style={{ color: "#9ca3af" }}>
        {formatUsd(pos.average_price)}
      </td>
      <td className="px-5 py-3 text-right" style={{ color: "#9ca3af" }}>
        {formatUsd(pos.mark_price)}
      </td>
      <td className="px-5 py-3 text-right font-medium" style={{ color: pnl >= 0 ? "#22c55e" : "#ef4444" }}>
        {pnl >= 0 ? "+" : ""}{formatUsd(pnl)}
      </td>
    </tr>
  );
}

function OrderRow({ order }: { order: Order }) {
  const isBuy = order.direction === "buy";

  return (
    <tr className="border-b transition-colors" style={{ borderColor: "#1e293b" }}>
      <td className="px-5 py-3 font-medium" style={{ color: "#e5e7eb" }}>
        {order.instrument_name}
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
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
          style={{ background: "rgba(245, 158, 11, 0.1)", color: "#f59e0b" }}
        >
          {order.status}
        </span>
      </td>
    </tr>
  );
}
