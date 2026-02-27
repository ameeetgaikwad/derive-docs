"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useAccount } from "wagmi";
import { useInstruments } from "@/hooks/market/useInstruments";
import { useTicker } from "@/hooks/market/useTicker";
import { useDerive } from "@/providers/DeriveProvider";
import { useSubmitOrder } from "@/hooks/mutations/useSubmitOrder";
import { calculateAPR, daysToExpiry, calculateOutcome } from "@/lib/derive/apr";
import type { StrategyType } from "@/lib/derive/apr";
import type { Currency, Ticker } from "@/lib/derive/types";
import { getSharedRestClient } from "@/hooks/account/useDeriveAuth";
import { StrikeSelector } from "./StrikeSelector";
import { AmountInput } from "./AmountInput";
import { OutcomePreview } from "./OutcomePreview";
import { EarnSummary } from "./EarnSummary";
import { cn } from "@/lib/utils";

interface StrikeOption {
  strike: number;
  instrumentName: string;
  apr: number;
  premium: number;
  otmPercent: number;
  bidPrice: number;
  expiry: number;
  baseAssetAddress: string;
  baseAssetSubId: string;
}

export function EarnFlow() {
  const { isConnected } = useAccount();
  const { isReady, isAuthenticated, authenticate, subaccountId } = useDerive();
  const submitOrder = useSubmitOrder();

  const [asset, setAsset] = useState<Currency>("ETH");
  const [strategyType, setStrategyType] = useState<StrategyType>("covered_call");
  const [selectedExpiry, setSelectedExpiry] = useState<number | null>(null);
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [tickers, setTickers] = useState<Map<string, Ticker>>(new Map());
  const [tickersLoading, setTickersLoading] = useState(false);
  const [balance, setBalance] = useState(0);

  const optionType = strategyType === "covered_call" ? "C" : "P";
  const { data: instruments, isLoading: instrumentsLoading } = useInstruments(asset, "option");
  const { data: perpTicker } = useTicker(`${asset}-PERP`);
  const spotPrice = perpTicker ? parseFloat(perpTicker.index_price) : 0;

  // Filter instruments by option type and active
  const filteredInstruments = useMemo(() => {
    if (!instruments) return [];
    return instruments.filter((i) => {
      const ot = i.option_details?.option_type;
      return ot === optionType && i.is_active;
    });
  }, [instruments, optionType]);

  // Extract unique expiries (only future dates with active instruments)
  const expiries = useMemo(() => {
    const now = Date.now() / 1000;
    const map = new Map<number, { epoch: number; label: string; dateStr: string }>();
    for (const inst of filteredInstruments) {
      const exp = inst.option_details?.expiry;
      if (!exp || exp <= now) continue; // Skip expired
      if (!map.has(exp)) {
        const d = new Date(exp * 1000);
        map.set(exp, {
          epoch: exp,
          label: d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
          dateStr: d.toISOString().slice(0, 10),
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.epoch - b.epoch);
  }, [filteredInstruments]);

  // Auto-select first expiry
  useEffect(() => {
    if (expiries.length > 0 && (selectedExpiry === null || !expiries.find((e) => e.epoch === selectedExpiry))) {
      setSelectedExpiry(expiries[0].epoch);
    }
  }, [expiries, selectedExpiry]);

  // Instruments for selected expiry
  const expiryInstruments = useMemo(() => {
    if (!selectedExpiry) return [];
    return filteredInstruments.filter((i) => i.option_details?.expiry === selectedExpiry);
  }, [filteredInstruments, selectedExpiry]);

  // Fetch tickers for expiry instruments
  useEffect(() => {
    if (expiryInstruments.length === 0) return;
    let cancelled = false;
    setTickersLoading(true);

    const client = getSharedRestClient();
    const names = expiryInstruments.map((i) => i.instrument_name);

    client.getTickers(names).then((results) => {
      if (cancelled) return;
      const map = new Map<string, Ticker>();
      for (const t of results) map.set(t.instrument_name, t);
      setTickers(map);
      setTickersLoading(false);
    }).catch(() => {
      if (!cancelled) setTickersLoading(false);
    });

    return () => { cancelled = true; };
  }, [expiryInstruments]);

  // Build strike options
  const strikes: StrikeOption[] = useMemo(() => {
    if (!selectedExpiry || spotPrice <= 0) return [];
    const opts: StrikeOption[] = [];
    for (const inst of expiryInstruments) {
      const strike = parseFloat(inst.option_details?.strike || "0");
      if (strike <= 0) continue;
      const ticker = tickers.get(inst.instrument_name);
      const bidPrice = parseFloat(ticker?.best_bid_price || "0");
      const dte = daysToExpiry(selectedExpiry);
      if (dte <= 0) continue;
      const notional = strategyType === "covered_call" ? spotPrice : strike;
      const apr = calculateAPR(bidPrice, notional, dte);
      opts.push({
        strike,
        instrumentName: inst.instrument_name,
        apr,
        premium: bidPrice,
        otmPercent: ((strike - spotPrice) / spotPrice) * 100,
        bidPrice,
        expiry: selectedExpiry,
        baseAssetAddress: inst.base_asset_address,
        baseAssetSubId: inst.base_asset_sub_id,
      });
    }
    opts.sort((a, b) => a.strike - b.strike);
    // Filter out strikes with no bids (no liquidity)
    return opts.filter((o) => o.bidPrice > 0);
  }, [expiryInstruments, tickers, selectedExpiry, spotPrice, strategyType]);

  // Auto-select closest ATM strike
  useEffect(() => {
    if (strikes.length > 0 && spotPrice > 0 && (selectedStrike === null || !strikes.find((s) => s.strike === selectedStrike))) {
      const closest = strikes.reduce((prev, curr) =>
        Math.abs(curr.strike - spotPrice) < Math.abs(prev.strike - spotPrice) ? curr : prev
      );
      setSelectedStrike(closest.strike);
    }
  }, [strikes, spotPrice, selectedStrike]);

  // Fetch balance
  useEffect(() => {
    if (!isReady || !subaccountId) { setBalance(0); return; }
    const client = getSharedRestClient();
    client.getCollaterals(subaccountId).then((collaterals) => {
      const key = strategyType === "covered_call" ? asset : "USDC";
      const col = collaterals.find((c) => c.asset_name === key);
      setBalance(parseFloat(col?.amount || "0"));
    }).catch(() => setBalance(0));
  }, [isReady, subaccountId, asset, strategyType]);

  const amountNum = parseFloat(amount) || 0;
  const collateralLabel = strategyType === "covered_call" ? asset : "USDC";
  const selectedStrikeData = strikes.find((s) => s.strike === selectedStrike);
  const selectedExpiryData = expiries.find((e) => e.epoch === selectedExpiry);
  const dte = selectedExpiry ? Math.ceil(daysToExpiry(selectedExpiry)) : 0;
  const insufficientBalance = amountNum > 0 && amountNum > balance;

  const outcome = selectedStrikeData && amountNum > 0
    ? calculateOutcome({
        type: strategyType,
        strikePrice: selectedStrikeData.strike,
        spotPrice,
        amount: amountNum,
        premium: selectedStrikeData.bidPrice,
      })
    : null;

  const handleSubmit = useCallback(async () => {
    if (!isConnected) return;
    if (!isAuthenticated) {
      await authenticate();
      return;
    }
    if (!selectedStrikeData || !outcome || amountNum <= 0) return;

    submitOrder.mutate({
      instrumentName: selectedStrikeData.instrumentName,
      direction: "sell",
      amount: outcome.contracts.toString(),
      limitPrice: selectedStrikeData.bidPrice.toString(),
      baseAssetAddress: selectedStrikeData.baseAssetAddress,
      baseAssetSubId: selectedStrikeData.baseAssetSubId,
    });
  }, [isConnected, isAuthenticated, authenticate, selectedStrikeData, outcome, amountNum, submitOrder]);

  const loading = instrumentsLoading || tickersLoading;
  const ctaEnabled = !!selectedStrikeData && amountNum > 0;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_320px]">
        {/* Main panel */}
        <div className="rounded-[10px] border-[0.5px] border-border bg-card p-6">
          {/* Top bar: dropdowns */}
          <div className="mb-6 flex flex-wrap items-center gap-3">
            {/* Asset */}
            <select
              value={asset}
              onChange={(e) => { setAsset(e.target.value as Currency); setSelectedStrike(null); }}
              className="rounded-md border-[0.5px] border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground disabled:opacity-50"
            >
              <option value="ETH">ETH</option>
              <option value="BTC">BTC</option>
            </select>

            {/* Strategy */}
            <select
              value={strategyType}
              onChange={(e) => { setStrategyType(e.target.value as StrategyType); setSelectedStrike(null); }}
              className="rounded-md border-[0.5px] border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground disabled:opacity-50"
            >
              <option value="covered_call">Covered Call</option>
              <option value="cash_secured_put">Cash Secured Put</option>
            </select>

            {/* Expiry */}
            <select
              value={selectedExpiry ?? ""}
              onChange={(e) => { setSelectedExpiry(Number(e.target.value)); setSelectedStrike(null); }}
              className="rounded-md border-[0.5px] border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground disabled:opacity-50"
            >
              {expiries.map((e) => (
                <option key={e.epoch} value={e.epoch}>{e.label}</option>
              ))}
            </select>

            <div className="flex-1" />

            {/* Spot price */}
            {spotPrice > 0 && (
              <div className="rounded-md border-[0.5px] border-border bg-background px-3 py-1.5 text-xs text-muted-foreground">
                Spot: <span className="font-semibold text-foreground">${spotPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              </div>
            )}
          </div>

          {/* Header text */}
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading strikes...</div>
          ) : (
            <>
              <div className="mb-1 text-sm text-secondary-foreground">
                Choose the price at which you are happy to{" "}
                {strategyType === "cash_secured_put" ? "buy" : "sell"}{" "}
                <span className="font-semibold text-foreground">{asset}</span> on{" "}
                <span className="font-semibold text-foreground">{selectedExpiryData?.label}</span>{" "}
                <span className="text-muted-foreground">(in {dte} days)</span>
              </div>
              <div className="mb-4 text-[10px] text-muted-foreground">
                Prices are live from the Derive exchange orderbook
              </div>

              {/* Strike selector */}
              <div className="mb-6">
                <StrikeSelector
                  strikes={strikes}
                  selectedStrike={selectedStrike}
                  onSelect={setSelectedStrike}
                />
              </div>
            </>
          )}

          {/* Amount input */}
          <div className="mb-5">
            <AmountInput
              amount={amount}
              onAmountChange={setAmount}
              balance={balance}
              collateralLabel={collateralLabel}
              insufficientBalance={insufficientBalance}
              step={strategyType === "covered_call" ? 0.01 : 100}
            />
          </div>

          {/* Outcome preview */}
          {selectedStrikeData && outcome && amountNum > 0 && (
            <div className="mb-5">
              <OutcomePreview
                asset={asset}
                strike={selectedStrikeData.strike}
                apr={selectedStrikeData.apr}
                outcome={outcome}
                expiryLabel={selectedExpiryData?.label || ""}
                strategyType={strategyType}
                collateralLabel={collateralLabel}
              />
            </div>
          )}

          {/* CTA */}
          <button
            onClick={handleSubmit}
            disabled={submitOrder.isPending || !selectedStrikeData || amountNum <= 0}
            className={cn(
              "w-full rounded-md py-3.5 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-30",
              ctaEnabled
                ? "bg-accent text-black"
                : "bg-card-elevated text-muted-foreground"
            )}
          >
            {submitOrder.isPending
              ? "Submitting..."
              : !isConnected
              ? "Connect Wallet"
              : !isAuthenticated
              ? "Sign in to Derive"
              : "Earn upfront premium now"}
          </button>
        </div>

        {/* Right side panel */}
        <div>
          <EarnSummary
            outcome={outcome}
            strike={selectedStrike}
            spotPrice={spotPrice}
            amount={amountNum}
            collateralLabel={collateralLabel}
            apr={selectedStrikeData?.apr ?? 0}
          />
        </div>
      </div>
    </div>
  );
}
