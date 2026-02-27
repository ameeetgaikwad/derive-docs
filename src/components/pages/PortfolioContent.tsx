"use client";

import { useState } from "react";
import { usePositions } from "@/hooks/portfolio/usePositions";
import { useCollaterals } from "@/hooks/portfolio/useCollaterals";
import { useOpenOrders } from "@/hooks/portfolio/useOpenOrders";
import { useTradeHistory } from "@/hooks/portfolio/useTradeHistory";
import { useDerive } from "@/providers/DeriveProvider";
import { FundsModal } from "@/components/portfolio/FundsModal";
import { formatUsd } from "@/lib/derive/utils";
import type { Collateral, Position, Order, TradeHistoryEntry } from "@/lib/derive/types";

/* ── design tokens ─────────────────────────────────────────────── */
const T = {
  pageBg: "#121212",
  cardBg: "#18181b",
  cardHeaderBg: "#27272a",
  border: "#3f3f46",
  borderSubtle: "rgba(63,63,70,0.4)",
  text: "#fafafa",
  textMuted: "#a1a1aa",
  textDim: "#71717a",
  accent: "#fb923c",
  green: "#22c55e",
  red: "#ef4444",
  greenBg: "rgba(34,197,94,0.08)",
  redBg: "rgba(239,68,68,0.08)",
  accentBg: "rgba(251,146,60,0.1)",
} as const;

const heading = "var(--font-schibsted, 'Schibsted Grotesk', sans-serif)";
const body = "var(--font-dm-sans, 'DM Sans', sans-serif)";

/* ── dot-grid SVG pattern for value card ───────────────────────── */
const dotPatternSvg = `url("data:image/svg+xml,%3Csvg width='24' height='24' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='2' cy='2' r='1.2' fill='%23fb923c' opacity='0.18'/%3E%3C/svg%3E")`;

/* ── instrument parser ─────────────────────────────────────────── */
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

/* ══════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════════════ */
export default function PortfolioContent() {
  const { isAuthenticated, authenticate } = useDerive();
  const { data: positions = [], isLoading: posLoading } = usePositions();
  const { data: collaterals = [], isLoading: colLoading } = useCollaterals();
  const { data: openOrders = [], isLoading: ordLoading } = useOpenOrders();
  const { data: trades = [], isLoading: tradesLoading } = useTradeHistory();
  const [fundsTab, setFundsTab] = useState<"deposit" | "withdraw" | "bridge" | null>(null);
  const [bottomTab, setBottomTab] = useState<"positions" | "activity">("positions");
  const [selectedTrade, setSelectedTrade] = useState<TradeHistoryEntry | null>(null);

  /* ── unauthenticated state ─────────────────────────────────── */
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen" style={{ background: T.pageBg }}>
        <div className="mx-auto flex max-w-lg flex-col items-center justify-center px-6 py-32 text-center">
          <div
            className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl"
            style={{ background: T.accentBg, border: `0.5px solid ${T.border}` }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
              <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
              <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
            </svg>
          </div>
          <h1
            className="mb-3 text-2xl font-bold"
            style={{ fontFamily: heading, color: T.text, letterSpacing: "-0.03em" }}
          >
            Portfolio
          </h1>
          <p
            className="mb-10 max-w-xs text-sm leading-relaxed"
            style={{ fontFamily: body, color: T.textMuted }}
          >
            Sign in to view your balances, positions, and manage your funds on Derive.
          </p>
          <button
            onClick={authenticate}
            className="rounded-md px-8 py-3 text-sm font-semibold tracking-wide transition-all hover:opacity-90"
            style={{
              fontFamily: body,
              background: T.text,
              color: T.pageBg,
              letterSpacing: "0.04em",
              textTransform: "uppercase" as const,
            }}
          >
            Connect Wallet
          </button>
        </div>
      </div>
    );
  }

  const totalValue = collaterals.reduce((sum, c) => sum + parseFloat(c.mark_value || "0"), 0);

  /* ── authenticated layout ──────────────────────────────────── */
  return (
    <div className="min-h-screen" style={{ background: T.pageBg }}>
      <div className="mx-auto max-w-5xl space-y-5 px-5 py-6">
        {/* header row */}
        <div className="flex items-center justify-between">
          <h1
            className="text-xl font-bold"
            style={{ fontFamily: heading, color: T.text, letterSpacing: "-0.03em" }}
          >
            Portfolio
          </h1>
          <div className="flex gap-2">
            {([
              { key: "deposit" as const, label: "Deposit" },
              { key: "withdraw" as const, label: "Withdraw" },
              { key: "bridge" as const, label: "Bridge" },
            ]).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFundsTab(key)}
                className="rounded-md px-4 py-2 text-xs font-medium transition-all hover:bg-white/5"
                style={{
                  fontFamily: body,
                  border: `0.5px solid ${T.border}`,
                  color: key === "deposit" ? T.accent : T.textMuted,
                  background: key === "deposit" ? T.accentBg : "transparent",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* balance + assets grid */}
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          {/* total balance card — with dot pattern */}
          <div
            className="relative overflow-hidden rounded-[10px] p-6"
            style={{
              background: T.cardBg,
              border: `0.5px solid ${T.border}`,
            }}
          >
            {/* dot grid overlay */}
            <div
              className="pointer-events-none absolute inset-0 opacity-60"
              style={{ backgroundImage: dotPatternSvg, backgroundSize: "24px 24px" }}
            />
            <div className="relative z-10">
              <div
                className="mb-1 text-xs font-medium uppercase tracking-widest"
                style={{ fontFamily: body, color: T.textDim }}
              >
                Account Value
              </div>
              {colLoading ? (
                <div className="mt-3 h-10 w-36 animate-pulse rounded" style={{ background: T.cardHeaderBg }} />
              ) : (
                <div
                  className="mt-1 text-4xl font-bold tracking-tight"
                  style={{ fontFamily: heading, color: T.text, letterSpacing: "-0.03em" }}
                >
                  {formatUsd(totalValue)}
                </div>
              )}
              <div
                className="mt-4 text-xs"
                style={{ fontFamily: body, color: T.textDim }}
              >
                on Derive L2
              </div>
            </div>
          </div>

          {/* assets card */}
          <div
            className="overflow-hidden rounded-[10px]"
            style={{ border: `0.5px solid ${T.border}`, background: T.cardBg }}
          >
            <div
              className="px-5 py-3"
              style={{ background: T.cardHeaderBg, borderBottom: `0.5px solid ${T.border}` }}
            >
              <span
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ fontFamily: body, color: T.textDim }}
              >
                Assets
              </span>
            </div>
            {colLoading ? (
              <div className="space-y-0">
                {[1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-4">
                    <div className="h-9 w-9 animate-pulse rounded-full" style={{ background: T.cardHeaderBg }} />
                    <div className="flex-1">
                      <div className="mb-1 h-4 w-16 animate-pulse rounded" style={{ background: T.cardHeaderBg }} />
                      <div className="h-3 w-24 animate-pulse rounded" style={{ background: T.cardHeaderBg }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : collaterals.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <div className="mb-2 text-sm" style={{ fontFamily: body, color: T.textMuted }}>
                  No assets yet
                </div>
                <button
                  onClick={() => setFundsTab("deposit")}
                  className="text-xs font-semibold transition-colors hover:brightness-125"
                  style={{ fontFamily: body, color: T.accent }}
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

        {/* tabs: positions / activity */}
        <div
          className="overflow-hidden rounded-[10px]"
          style={{ border: `0.5px solid ${T.border}`, background: T.cardBg }}
        >
          {/* tab bar */}
          <div
            className="flex items-center gap-0 px-5"
            style={{ background: T.cardHeaderBg, borderBottom: `0.5px solid ${T.border}` }}
          >
            {(["positions", "activity"] as const).map((tab) => {
              const active = bottomTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => setBottomTab(tab)}
                  className="relative px-0 py-3 text-xs font-semibold uppercase tracking-wider transition-colors"
                  style={{
                    fontFamily: body,
                    color: active ? T.text : T.textDim,
                    marginRight: 24,
                  }}
                >
                  {tab === "positions" ? "Positions" : "Activity"}
                  {tab === "positions" && positions.length > 0 && (
                    <span
                      className="ml-2 rounded-[4px] px-1.5 py-0.5 text-[10px] font-bold"
                      style={{ background: T.accentBg, color: T.accent }}
                    >
                      {positions.length}
                    </span>
                  )}
                  {tab === "activity" && trades.length > 0 && (
                    <span
                      className="ml-2 rounded-[4px] px-1.5 py-0.5 text-[10px] font-bold"
                      style={{ background: T.accentBg, color: T.accent }}
                    >
                      {trades.length}
                    </span>
                  )}
                  {active && (
                    <div
                      className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full"
                      style={{ background: T.accent }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* tab content */}
          {bottomTab === "positions" ? (
            <>
              {posLoading ? (
                <div className="space-y-0 p-5">
                  {[1, 2].map((i) => (
                    <div key={i} className="mb-3 h-14 animate-pulse rounded-lg" style={{ background: T.cardHeaderBg }} />
                  ))}
                </div>
              ) : positions.length === 0 && openOrders.length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <div className="mb-1 text-sm" style={{ fontFamily: body, color: T.textMuted }}>
                    No open positions
                  </div>
                  <div className="text-xs" style={{ fontFamily: body, color: T.textDim }}>
                    Sell a covered call from the trade page to get started
                  </div>
                </div>
              ) : (
                <div>
                  {positions.map((pos, i) => (
                    <PositionRow key={pos.instrument_name} pos={pos} isLast={i === positions.length - 1 && openOrders.length === 0} />
                  ))}
                  {openOrders.length > 0 && (
                    <>
                      <div className="px-5 py-2" style={{ borderTop: `0.5px solid ${T.border}` }}>
                        <span
                          className="text-[10px] font-semibold uppercase tracking-wider"
                          style={{ fontFamily: body, color: T.textDim }}
                        >
                          Open Orders
                        </span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs" style={{ fontFamily: body }}>
                          <thead>
                            <tr style={{ borderBottom: `0.5px solid ${T.border}` }}>
                              {["Instrument", "Side", "Size", "Price", "Status"].map((h, i) => (
                                <th
                                  key={h}
                                  className={`px-5 py-2 text-[10px] font-semibold uppercase tracking-wider ${i < 2 ? "text-left" : "text-right"}`}
                                  style={{ color: T.textDim }}
                                >
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {openOrders.map((order) => (
                              <OrderRow key={order.order_id} order={order} />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              {tradesLoading ? (
                <div className="space-y-0 p-5">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="mb-3 h-12 animate-pulse rounded-lg" style={{ background: T.cardHeaderBg }} />
                  ))}
                </div>
              ) : trades.length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <div className="mb-1 text-sm" style={{ fontFamily: body, color: T.textMuted }}>
                    No trade history
                  </div>
                  <div className="text-xs" style={{ fontFamily: body, color: T.textDim }}>
                    Your completed trades will appear here
                  </div>
                </div>
              ) : (
                <div>
                  {trades.map((trade, i) => (
                    <TradeRow key={trade.trade_id} trade={trade} isLast={i === trades.length - 1} onSelect={() => setSelectedTrade(trade)} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* modals */}
      {selectedTrade && (
        <TradeDetailModal trade={selectedTrade} onClose={() => setSelectedTrade(null)} />
      )}

      <FundsModal
        open={fundsTab !== null}
        onClose={() => setFundsTab(null)}
        collaterals={collaterals}
        initialTab={fundsTab ?? "deposit"}
      />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   SUB-COMPONENTS
   ══════════════════════════════════════════════════════════════════ */

function AssetRow({ collateral: c, isLast, onDeposit, onWithdraw }: { collateral: Collateral; isLast: boolean; onDeposit: () => void; onWithdraw: () => void }) {
  const amount = parseFloat(c.amount);
  const value = parseFloat(c.mark_value || "0");
  const isStable = c.asset_name === "USDC" || c.asset_name === "USDT";

  return (
    <div
      className="flex items-center justify-between px-5 py-3.5 transition-colors hover:bg-white/[0.02]"
      style={{ borderBottom: isLast ? "none" : `0.5px solid ${T.borderSubtle}` }}
    >
      <div className="flex items-center gap-3">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold"
          style={{
            fontFamily: body,
            background: isStable ? "rgba(59,130,246,0.1)" : T.accentBg,
            color: isStable ? "#3b82f6" : T.accent,
          }}
        >
          {isStable ? "$" : "₿"}
        </div>
        <div>
          <div className="text-sm font-semibold" style={{ fontFamily: body, color: T.text }}>
            {c.asset_name}
          </div>
          <div className="text-[11px]" style={{ fontFamily: body, color: T.textDim }}>
            {amount.toFixed(isStable ? 2 : 6)} {c.asset_name}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className="text-sm font-semibold" style={{ fontFamily: heading, color: T.text, letterSpacing: "-0.02em" }}>
            {formatUsd(value)}
          </div>
        </div>
        <div className="flex gap-1">
          <button
            onClick={onDeposit}
            className="flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold transition-all hover:brightness-150"
            style={{ color: T.accent, background: T.accentBg, fontFamily: body }}
            title="Deposit"
          >
            +
          </button>
          <button
            onClick={onWithdraw}
            className="flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold transition-all hover:brightness-150"
            style={{ color: T.textMuted, background: "rgba(161,161,170,0.08)", fontFamily: body }}
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
      className="flex items-center justify-between px-5 py-4 transition-colors hover:bg-white/[0.02]"
      style={{ borderBottom: isLast ? "none" : `0.5px solid ${T.borderSubtle}` }}
    >
      <div className="flex items-center gap-3">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg text-[10px] font-bold"
          style={{
            fontFamily: body,
            background: isLong ? T.greenBg : T.redBg,
            color: isLong ? T.green : T.red,
            border: `0.5px solid ${isLong ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
          }}
        >
          {isLong ? "L" : "S"}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold" style={{ fontFamily: heading, color: T.text, letterSpacing: "-0.02em" }}>
              {parsed.asset} {parsed.strike} {parsed.type}
            </span>
            <span
              className="rounded-[4px] px-1.5 py-0.5 text-[9px] font-bold uppercase"
              style={{
                fontFamily: body,
                background: isLong ? T.greenBg : T.redBg,
                color: isLong ? T.green : T.red,
              }}
            >
              {isLong ? "Long" : "Short"}
            </span>
          </div>
          <div className="mt-0.5 text-[11px]" style={{ fontFamily: body, color: T.textDim }}>
            {parsed.expiry} · {absSize.toFixed(4)} contracts
          </div>
        </div>
      </div>
      <div className="flex items-center gap-6">
        <div className="text-right">
          <div className="text-[10px] font-medium uppercase" style={{ fontFamily: body, color: T.textDim }}>Entry</div>
          <div className="text-xs font-medium" style={{ fontFamily: body, color: T.textMuted }}>
            {formatUsd(pos.average_price)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-medium uppercase" style={{ fontFamily: body, color: T.textDim }}>Mark</div>
          <div className="text-xs font-medium" style={{ fontFamily: body, color: T.textMuted }}>
            {formatUsd(pos.mark_price)}
          </div>
        </div>
        <div className="text-right" style={{ minWidth: 72 }}>
          <div className="text-[10px] font-medium uppercase" style={{ fontFamily: body, color: T.textDim }}>PnL</div>
          <div className="text-xs font-bold" style={{ fontFamily: heading, color: pnl >= 0 ? T.green : T.red }}>
            {pnl >= 0 ? "+" : ""}{formatUsd(pnl)}
          </div>
        </div>
      </div>
    </div>
  );
}

function TradeRow({ trade, isLast, onSelect }: { trade: TradeHistoryEntry; isLast: boolean; onSelect: () => void }) {
  const isBuy = trade.direction === "buy";
  const parsed = parseInstrument(trade.instrument_name);
  const premium = parseFloat(trade.trade_price) * parseFloat(trade.trade_amount);
  const date = new Date(trade.timestamp);
  const timeStr = date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div
      onClick={onSelect}
      className="flex cursor-pointer items-center justify-between px-5 py-3.5 transition-colors hover:bg-white/[0.02]"
      style={{ borderBottom: isLast ? "none" : `0.5px solid ${T.borderSubtle}` }}
    >
      <div className="flex items-center gap-3">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg text-[10px] font-bold"
          style={{
            fontFamily: body,
            background: isBuy ? T.greenBg : T.redBg,
            color: isBuy ? T.green : T.red,
            border: `0.5px solid ${isBuy ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
          }}
        >
          {isBuy ? "B" : "S"}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span
              className="text-sm font-semibold"
              style={{ fontFamily: heading, color: T.text, letterSpacing: "-0.02em" }}
            >
              {parsed.asset} {parsed.strike} {parsed.type}
            </span>
            <span
              className="rounded-[4px] px-1.5 py-0.5 text-[9px] font-bold uppercase"
              style={{
                fontFamily: body,
                background: isBuy ? T.greenBg : T.redBg,
                color: isBuy ? T.green : T.red,
              }}
            >
              {isBuy ? "Buy" : "Sell"}
            </span>
          </div>
          <div className="mt-0.5 text-[11px]" style={{ fontFamily: body, color: T.textDim }}>
            {timeStr} · {parseFloat(trade.trade_amount).toFixed(4)} contracts
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="text-[10px] font-medium uppercase" style={{ fontFamily: body, color: T.textDim }}>
          {isBuy ? "Cost" : "Premium"}
        </div>
        <div
          className="text-sm font-bold"
          style={{ fontFamily: heading, color: isBuy ? T.red : T.green, letterSpacing: "-0.02em" }}
        >
          {isBuy ? "-" : "+"}{formatUsd(premium)}
        </div>
      </div>
    </div>
  );
}

function TradeDetailModal({ trade, onClose }: { trade: TradeHistoryEntry; onClose: () => void }) {
  const isBuy = trade.direction === "buy";
  const parsed = parseInstrument(trade.instrument_name);
  const premium = parseFloat(trade.trade_price) * parseFloat(trade.trade_amount);
  const netPremium = premium - parseFloat(trade.trade_fee);
  const fullDate = new Date(trade.timestamp).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });

  const rows: [string, string, string?][] = [
    ["Instrument", trade.instrument_name],
    ["Side", isBuy ? "Buy" : "Sell", isBuy ? T.green : T.red],
    ["Contracts", parseFloat(trade.trade_amount).toFixed(4)],
    ["Price per contract", formatUsd(trade.trade_price)],
    [isBuy ? "Total Cost" : "Gross Premium", formatUsd(premium), isBuy ? T.red : T.green],
    ["Fee", `-${formatUsd(trade.trade_fee)}`],
    [isBuy ? "Net Cost" : "Net Premium", formatUsd(netPremium), isBuy ? T.red : T.green],
    ["Role", trade.liquidity_role],
    ["Realized PnL", formatUsd(trade.realized_pnl)],
    ["Status", trade.tx_status],
    ["Date", fullDate],
    ["Trade ID", trade.trade_id],
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-[10px]"
        style={{ border: `0.5px solid ${T.border}`, background: T.cardBg }}
      >
        {/* header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ background: T.cardHeaderBg, borderBottom: `0.5px solid ${T.border}` }}
        >
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-lg text-xs font-bold"
              style={{
                fontFamily: body,
                background: isBuy ? T.greenBg : T.redBg,
                color: isBuy ? T.green : T.red,
                border: `0.5px solid ${isBuy ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
              }}
            >
              {isBuy ? "B" : "S"}
            </div>
            <div>
              <div className="text-sm font-bold" style={{ fontFamily: heading, color: T.text, letterSpacing: "-0.02em" }}>
                {parsed.asset} {parsed.strike} {parsed.type}
              </div>
              <div className="text-[11px]" style={{ fontFamily: body, color: T.textDim }}>
                {parsed.expiry}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-white/5"
            style={{ color: T.textMuted }}
          >
            ✕
          </button>
        </div>

        {/* detail rows */}
        <div className="px-5 py-2">
          {rows.map(([label, value, color]) => (
            <div
              key={label}
              className="flex items-center justify-between py-2.5"
              style={{ borderBottom: `0.5px solid ${T.borderSubtle}` }}
            >
              <span className="text-xs" style={{ fontFamily: body, color: T.textDim }}>{label}</span>
              <span
                className="text-xs font-semibold"
                style={{ fontFamily: body, color: color ?? T.text }}
              >
                {value}
              </span>
            </div>
          ))}
        </div>

        {/* close button */}
        <div className="px-5 py-4" style={{ borderTop: `0.5px solid ${T.border}` }}>
          <button
            onClick={onClose}
            className="w-full rounded-md py-2.5 text-xs font-semibold uppercase tracking-wide transition-all hover:opacity-90"
            style={{ fontFamily: body, background: T.cardHeaderBg, color: T.textMuted }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function OrderRow({ order }: { order: Order }) {
  const isBuy = order.direction === "buy";
  const parsed = parseInstrument(order.instrument_name);

  return (
    <tr style={{ borderBottom: `0.5px solid ${T.borderSubtle}` }}>
      <td className="px-5 py-3">
        <div className="font-medium" style={{ fontFamily: heading, color: T.text, letterSpacing: "-0.02em" }}>
          {parsed.asset} {parsed.strike} {parsed.type}
        </div>
        <div className="text-[10px]" style={{ fontFamily: body, color: T.textDim }}>{parsed.expiry}</div>
      </td>
      <td className="px-5 py-3">
        <span
          className="rounded-[4px] px-1.5 py-0.5 text-[10px] font-bold"
          style={{
            fontFamily: body,
            background: isBuy ? T.greenBg : T.redBg,
            color: isBuy ? T.green : T.red,
          }}
        >
          {isBuy ? "BUY" : "SELL"}
        </span>
      </td>
      <td className="px-5 py-3 text-right" style={{ fontFamily: body, color: T.text }}>
        {parseFloat(order.amount).toFixed(4)}
      </td>
      <td className="px-5 py-3 text-right" style={{ fontFamily: body, color: T.textMuted }}>
        {formatUsd(order.limit_price)}
      </td>
      <td className="px-5 py-3 text-right">
        <span
          className="rounded-[4px] px-1.5 py-0.5 text-[10px] font-bold uppercase"
          style={{ fontFamily: body, background: T.accentBg, color: T.accent }}
        >
          {order.status}
        </span>
      </td>
    </tr>
  );
}
