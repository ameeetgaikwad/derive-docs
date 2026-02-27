"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { usePositions } from "@/hooks/portfolio/usePositions";
import { useCollaterals } from "@/hooks/portfolio/useCollaterals";
import { useOpenOrders } from "@/hooks/portfolio/useOpenOrders";
import { useTradeHistory } from "@/hooks/portfolio/useTradeHistory";
import { useDerive } from "@/providers/DeriveProvider";
import { FundsModal } from "@/components/portfolio/FundsModal";
import { TokenIcon, tokenDisplayName } from "@/components/ui/TokenIcon";
import { formatUsd } from "@/lib/derive/utils";
import { cn } from "@/lib/utils";
import type { Collateral, Position, Order, TradeHistoryEntry } from "@/lib/derive/types";

const displayName = tokenDisplayName;

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
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
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
      <div className="min-h-screen bg-background">
        <div className="mx-auto flex max-w-lg flex-col items-center justify-center px-6 py-32 text-center">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border-[0.5px] border-border bg-accent/10">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
              <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
              <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
              <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
            </svg>
          </div>
          <h1 className="mb-3 text-2xl font-bold tracking-[-0.03em] text-foreground font-heading">
            Portfolio
          </h1>
          <p className="mb-10 max-w-xs text-sm leading-relaxed text-secondary-foreground">
            Sign in to view your balances, positions, and manage your funds on Derive.
          </p>
          <button
            onClick={() => {
              if (!isConnected && openConnectModal) {
                openConnectModal();
              } else {
                authenticate();
              }
            }}
            className="rounded-md bg-foreground px-8 py-3 text-sm font-semibold uppercase tracking-wide text-background transition-all hover:opacity-90"
          >
            {isConnected ? "Sign in to Derive" : "Connect Wallet"}
          </button>
        </div>
      </div>
    );
  }

  const totalValue = collaterals.reduce((sum, c) => sum + parseFloat(c.mark_value || "0"), 0);

  /* ── authenticated layout ──────────────────────────────────── */
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl space-y-5 px-5 py-6">
        {/* header row */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold tracking-[-0.03em] text-foreground font-heading">
            Portfolio
          </h1>
          <div className="flex gap-2">
            {([
              { key: "deposit" as const, label: "Deposit", highlight: true },
              { key: "withdraw" as const, label: "Withdraw", highlight: false },
              { key: "bridge" as const, label: "Bridge", highlight: false },
            ]).map(({ key, label, highlight }) => (
              <button
                key={key}
                onClick={() => setFundsTab(key)}
                className={cn(
                  "rounded-md border-[0.5px] border-border px-4 py-2 text-xs font-medium transition-all hover:bg-white/5",
                  highlight
                    ? "bg-accent/10 text-accent"
                    : "text-secondary-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* balance + assets grid */}
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          {/* total balance card — with dot pattern */}
          <div className="relative overflow-hidden rounded-[10px] border-[0.5px] border-border bg-card p-6">
            {/* dot grid overlay */}
            <div
              className="pointer-events-none absolute inset-0 opacity-60"
              style={{ backgroundImage: dotPatternSvg, backgroundSize: "24px 24px" }}
            />
            <div className="relative z-10">
              <div className="mb-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Account Value
              </div>
              {colLoading ? (
                <div className="mt-3 h-10 w-36 animate-pulse rounded bg-card-elevated" />
              ) : (
                <div className="mt-1 text-4xl font-bold tracking-[-0.03em] text-foreground font-heading">
                  {formatUsd(totalValue)}
                </div>
              )}
              <div className="mt-4 text-xs text-muted-foreground">
                on Derive L2
              </div>
            </div>
          </div>

          {/* assets card */}
          <div className="overflow-hidden rounded-[10px] border-[0.5px] border-border bg-card">
            <div className="border-b border-border bg-card-elevated px-5 py-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Assets
              </span>
            </div>
            {colLoading ? (
              <div className="space-y-0">
                {[1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-4">
                    <div className="h-9 w-9 animate-pulse rounded-full bg-card-elevated" />
                    <div className="flex-1">
                      <div className="mb-1 h-4 w-16 animate-pulse rounded bg-card-elevated" />
                      <div className="h-3 w-24 animate-pulse rounded bg-card-elevated" />
                    </div>
                  </div>
                ))}
              </div>
            ) : collaterals.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <div className="mb-2 text-sm text-secondary-foreground">
                  No assets yet
                </div>
                <button
                  onClick={() => setFundsTab("deposit")}
                  className="text-xs font-semibold text-accent transition-colors hover:brightness-125"
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
        <div className="overflow-hidden rounded-[10px] border-[0.5px] border-border bg-card">
          {/* tab bar */}
          <div className="flex items-center gap-0 border-b border-border bg-card-elevated px-5">
            {(["positions", "activity"] as const).map((tab) => {
              const active = bottomTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => setBottomTab(tab)}
                  className={cn(
                    "relative mr-6 py-3 text-xs font-semibold uppercase tracking-wider transition-colors",
                    active ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {tab === "positions" ? "Positions" : "Activity"}
                  {tab === "positions" && positions.length > 0 && (
                    <span className="ml-2 rounded-[4px] bg-accent/10 px-1.5 py-0.5 text-[10px] font-bold text-accent">
                      {positions.length}
                    </span>
                  )}
                  {tab === "activity" && trades.length > 0 && (
                    <span className="ml-2 rounded-[4px] bg-accent/10 px-1.5 py-0.5 text-[10px] font-bold text-accent">
                      {trades.length}
                    </span>
                  )}
                  {active && (
                    <div className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full bg-accent" />
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
                    <div key={i} className="mb-3 h-14 animate-pulse rounded-lg bg-card-elevated" />
                  ))}
                </div>
              ) : positions.length === 0 && openOrders.length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <div className="mb-1 text-sm text-secondary-foreground">
                    No open positions
                  </div>
                  <div className="text-xs text-muted-foreground">
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
                      <div className="border-t border-border px-5 py-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Open Orders
                        </span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-border">
                              {["Instrument", "Side", "Size", "Price", "Status"].map((h, i) => (
                                <th
                                  key={h}
                                  className={cn(
                                    "px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground",
                                    i < 2 ? "text-left" : "text-right"
                                  )}
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
                    <div key={i} className="mb-3 h-12 animate-pulse rounded-lg bg-card-elevated" />
                  ))}
                </div>
              ) : trades.length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <div className="mb-1 text-sm text-secondary-foreground">
                    No trade history
                  </div>
                  <div className="text-xs text-muted-foreground">
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
      className={cn(
        "flex items-center justify-between px-5 py-3.5 transition-colors hover:bg-white/[0.02]",
        !isLast && "border-b border-border/40"
      )}
    >
      <div className="flex items-center gap-3">
        <TokenIcon symbol={c.asset_name} size={36} />
        <div>
          <div className="text-sm font-semibold text-foreground">
            {displayName(c.asset_name)}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {amount.toFixed(isStable ? 2 : 6)} {displayName(c.asset_name)}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className="text-sm font-semibold tracking-[-0.02em] text-foreground font-heading">
            {formatUsd(value)}
          </div>
        </div>
        <div className="flex gap-1">
          <button
            onClick={onDeposit}
            className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/10 text-xs font-bold text-accent transition-all hover:brightness-150"
            title="Deposit"
          >
            +
          </button>
          <button
            onClick={onWithdraw}
            className="flex h-7 w-7 items-center justify-center rounded-md bg-secondary-foreground/[0.08] text-xs font-bold text-secondary-foreground transition-all hover:brightness-150"
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
      className={cn(
        "flex items-center justify-between px-5 py-4 transition-colors hover:bg-white/[0.02]",
        !isLast && "border-b border-border/40"
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-lg border-[0.5px] text-[10px] font-bold",
            isLong
              ? "border-success/20 bg-success/[0.08] text-success"
              : "border-destructive/20 bg-destructive/[0.08] text-destructive"
          )}
        >
          {isLong ? "L" : "S"}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-[-0.02em] text-foreground font-heading">
              {parsed.asset} {parsed.strike} {parsed.type}
            </span>
            <span
              className={cn(
                "rounded-[4px] px-1.5 py-0.5 text-[9px] font-bold uppercase",
                isLong
                  ? "bg-success/[0.08] text-success"
                  : "bg-destructive/[0.08] text-destructive"
              )}
            >
              {isLong ? "Long" : "Short"}
            </span>
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {parsed.expiry} · {absSize.toFixed(4)} contracts
          </div>
        </div>
      </div>
      <div className="flex items-center gap-6">
        <div className="text-right">
          <div className="text-[10px] font-medium uppercase text-muted-foreground">Entry</div>
          <div className="text-xs font-medium text-secondary-foreground">
            {formatUsd(pos.average_price)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-medium uppercase text-muted-foreground">Mark</div>
          <div className="text-xs font-medium text-secondary-foreground">
            {formatUsd(pos.mark_price)}
          </div>
        </div>
        <div className="min-w-[72px] text-right">
          <div className="text-[10px] font-medium uppercase text-muted-foreground">PnL</div>
          <div className={cn(
            "text-xs font-bold font-heading",
            pnl >= 0 ? "text-success" : "text-destructive"
          )}>
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
      className={cn(
        "flex cursor-pointer items-center justify-between px-5 py-3.5 transition-colors hover:bg-white/[0.02]",
        !isLast && "border-b border-border/40"
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-lg border-[0.5px] text-[10px] font-bold",
            isBuy
              ? "border-success/20 bg-success/[0.08] text-success"
              : "border-destructive/20 bg-destructive/[0.08] text-destructive"
          )}
        >
          {isBuy ? "B" : "S"}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-[-0.02em] text-foreground font-heading">
              {parsed.asset} {parsed.strike} {parsed.type}
            </span>
            <span
              className={cn(
                "rounded-[4px] px-1.5 py-0.5 text-[9px] font-bold uppercase",
                isBuy
                  ? "bg-success/[0.08] text-success"
                  : "bg-destructive/[0.08] text-destructive"
              )}
            >
              {isBuy ? "Buy" : "Sell"}
            </span>
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {timeStr} · {parseFloat(trade.trade_amount).toFixed(4)} contracts
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="text-[10px] font-medium uppercase text-muted-foreground">
          {isBuy ? "Cost" : "Premium"}
        </div>
        <div className={cn(
          "text-sm font-bold tracking-[-0.02em] font-heading",
          isBuy ? "text-destructive" : "text-success"
        )}>
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
    ["Side", isBuy ? "Buy" : "Sell", isBuy ? "text-success" : "text-destructive"],
    ["Contracts", parseFloat(trade.trade_amount).toFixed(4)],
    ["Price per contract", formatUsd(trade.trade_price)],
    [isBuy ? "Total Cost" : "Gross Premium", formatUsd(premium), isBuy ? "text-destructive" : "text-success"],
    ["Fee", `-${formatUsd(trade.trade_fee)}`],
    [isBuy ? "Net Cost" : "Net Premium", formatUsd(netPremium), isBuy ? "text-destructive" : "text-success"],
    ["Role", trade.liquidity_role],
    ["Realized PnL", formatUsd(trade.realized_pnl)],
    ["Status", trade.tx_status],
    ["Date", fullDate],
    ["Trade ID", trade.trade_id],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-[10px] border-[0.5px] border-border bg-card">
        {/* header */}
        <div className="flex items-center justify-between border-b border-border bg-card-elevated px-5 py-4">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-lg border-[0.5px] text-xs font-bold",
                isBuy
                  ? "border-success/20 bg-success/[0.08] text-success"
                  : "border-destructive/20 bg-destructive/[0.08] text-destructive"
              )}
            >
              {isBuy ? "B" : "S"}
            </div>
            <div>
              <div className="text-sm font-bold tracking-[-0.02em] text-foreground font-heading">
                {parsed.asset} {parsed.strike} {parsed.type}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {parsed.expiry}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-secondary-foreground transition-colors hover:bg-white/5"
          >
            ✕
          </button>
        </div>

        {/* detail rows */}
        <div className="px-5 py-2">
          {rows.map(([label, value, colorClass]) => (
            <div
              key={label}
              className="flex items-center justify-between border-b border-border/40 py-2.5"
            >
              <span className="text-xs text-muted-foreground">{label}</span>
              <span className={cn("text-xs font-semibold", colorClass ?? "text-foreground")}>
                {value}
              </span>
            </div>
          ))}
        </div>

        {/* close button */}
        <div className="border-t border-border px-5 py-4">
          <button
            onClick={onClose}
            className="w-full rounded-md bg-card-elevated py-2.5 text-xs font-semibold uppercase tracking-wide text-secondary-foreground transition-all hover:opacity-90"
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
    <tr className="border-b border-border/40">
      <td className="px-5 py-3">
        <div className="font-medium tracking-[-0.02em] text-foreground font-heading">
          {parsed.asset} {parsed.strike} {parsed.type}
        </div>
        <div className="text-[10px] text-muted-foreground">{parsed.expiry}</div>
      </td>
      <td className="px-5 py-3">
        <span
          className={cn(
            "rounded-[4px] px-1.5 py-0.5 text-[10px] font-bold",
            isBuy
              ? "bg-success/[0.08] text-success"
              : "bg-destructive/[0.08] text-destructive"
          )}
        >
          {isBuy ? "BUY" : "SELL"}
        </span>
      </td>
      <td className="px-5 py-3 text-right text-foreground">
        {parseFloat(order.amount).toFixed(4)}
      </td>
      <td className="px-5 py-3 text-right text-secondary-foreground">
        {formatUsd(order.limit_price)}
      </td>
      <td className="px-5 py-3 text-right">
        <span className="rounded-[4px] bg-accent/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-accent">
          {order.status}
        </span>
      </td>
    </tr>
  );
}
