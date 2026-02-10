"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAccount, useWalletClient } from "wagmi";
import TerminalCard from "./TerminalCard";
import StrikeCard from "./StrikeCard";
import { useDeriveSession } from "./DeriveSessionProvider";
import { signOrderViem } from "@/lib/derive/signOrder";
import { calculateAPR, daysToExpiry, calculateOutcome } from "@/lib/derive/apr";
import type { Instrument, Ticker } from "@/lib/derive/types";

type StrategyType = "covered_call" | "cash_secured_put";

interface EarnDetailProps {
  asset: string;
  strategyType: StrategyType;
  onBack: () => void;
  onChangeAsset: (asset: string) => void;
  onChangeType: (type: StrategyType) => void;
}

interface StrikeOption {
  strike: number;
  instrumentName: string;
  apr: number;
  bidPrice: number;
  askPrice: number;
  expiry: number; // epoch seconds
}

const COLLATERAL_OPTIONS = ["USDC", "USDT"];

export default function EarnDetail({
  asset,
  strategyType,
  onBack,
  onChangeAsset,
  onChangeType,
}: EarnDetailProps) {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const {
    isAuthenticated,
    subaccountId,
    isAuthenticating,
    authError,
    authenticate,
    logout,
    setSubaccountId,
    getAuthHeaders,
    deriveWallet,
    needsDeriveWallet,
    setDeriveWallet,
  } = useDeriveSession();

  const [expiries, setExpiries] = useState<{ date: string; label: string; epoch: number }[]>([]);
  const [selectedExpiry, setSelectedExpiry] = useState("");
  const [strikes, setStrikes] = useState<StrikeOption[]>([]);
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [spotPrice, setSpotPrice] = useState(0);
  const [amount, setAmount] = useState("");
  const [collateral, setCollateral] = useState(COLLATERAL_OPTIONS[0]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [loading, setLoading] = useState(true);

  const [assetDropdownOpen, setAssetDropdownOpen] = useState(false);
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);
  const [expiryDropdownOpen, setExpiryDropdownOpen] = useState(false);
  const [collateralDropdownOpen, setCollateralDropdownOpen] = useState(false);

  const spotPriceRef = useRef(spotPrice);
  spotPriceRef.current = spotPrice;
  const selectedExpiryRef = useRef(selectedExpiry);
  selectedExpiryRef.current = selectedExpiry;
  const selectedStrikeRef = useRef(selectedStrike);
  selectedStrikeRef.current = selectedStrike;

  const assetRef = useRef<HTMLDivElement>(null);
  const typeRef = useRef<HTMLDivElement>(null);
  const expiryRef = useRef<HTMLDivElement>(null);
  const collateralRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (assetRef.current && !assetRef.current.contains(e.target as Node)) setAssetDropdownOpen(false);
      if (typeRef.current && !typeRef.current.contains(e.target as Node)) setTypeDropdownOpen(false);
      if (expiryRef.current && !expiryRef.current.contains(e.target as Node)) setExpiryDropdownOpen(false);
      if (collateralRef.current && !collateralRef.current.contains(e.target as Node)) setCollateralDropdownOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Fetch spot price
  const fetchSpot = useCallback(async () => {
    try {
      const res = await fetch("/api/derive/ticker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instrument_name: `${asset}-PERP` }),
      });
      const data = await res.json();
      if (data.result?.index_price) {
        setSpotPrice(parseFloat(data.result.index_price));
      }
    } catch {
      // ignore
    }
  }, [asset]);

  // Fetch instruments and build expiry list (only when asset/strategy changes)
  const fetchInstruments = useCallback(async () => {
    const optionType = strategyType === "covered_call" ? "C" : "P";
    const instRes = await fetch("/api/derive/instruments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currency: asset, instrument_type: "option", expired: false }),
    });
    const instData = await instRes.json();
    const allInstruments: Instrument[] = instData.result || [];
    return allInstruments.filter((i) => {
      const ot = i.option_details?.option_type || i.option_type;
      return ot === optionType && i.is_active;
    });
  }, [asset, strategyType]);

  // Build expiries + strikes from instruments + tickers
  // Uses refs to avoid dependency cycles that cause re-render loops
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const instruments = await fetchInstruments();

      // Extract unique expiries
      const expiryMap = new Map<string, { label: string; epoch: number }>();
      for (const inst of instruments) {
        const expEpoch = inst.option_details?.expiry || inst.expiry;
        if (!expEpoch) continue;
        const d = new Date(expEpoch * 1000);
        const dateStr = d.toISOString().slice(0, 10).replace(/-/g, "");
        if (!expiryMap.has(dateStr)) {
          expiryMap.set(dateStr, {
            label: d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
            epoch: expEpoch,
          });
        }
      }

      const sortedExpiries = Array.from(expiryMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, info]) => ({ date, ...info }));

      setExpiries(sortedExpiries);

      // Determine which expiry to use (keep current if valid, else first)
      let expToUse = selectedExpiryRef.current;
      if (!expToUse || !sortedExpiries.find((e) => e.date === expToUse)) {
        expToUse = sortedExpiries[0]?.date || "";
        setSelectedExpiry(expToUse);
      }

      // Fetch tickers for the selected expiry date
      const tickerMap = new Map<string, Ticker>();
      if (expToUse) {
        try {
          const tickerRes = await fetch("/api/derive/tickers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              currency: asset,
              instrument_type: "option",
              expiry_date: expToUse,
            }),
          });
          const tickerData = await tickerRes.json();
          const tickers: Ticker[] = tickerData.result || [];
          if (Array.isArray(tickers)) {
            for (const t of tickers) tickerMap.set(t.instrument_name, t);
          }
        } catch {
          // ignore ticker fetch failures
        }
      }

      // Build strikes for the selected expiry
      const strikeOptions: StrikeOption[] = [];
      for (const inst of instruments) {
        const expEpoch = inst.option_details?.expiry || inst.expiry;
        if (!expEpoch) continue;
        const d = new Date(expEpoch * 1000);
        const dateStr = d.toISOString().slice(0, 10).replace(/-/g, "");
        if (dateStr !== expToUse) continue;

        const ticker = tickerMap.get(inst.instrument_name);
        const bidPrice = parseFloat(ticker?.best_bid_price || "0");
        const askPrice = parseFloat(ticker?.best_ask_price || "0");
        const strikeStr = inst.option_details?.strike || inst.strike;
        const strike = parseFloat(strikeStr || "0");
        if (strike <= 0) continue;

        const dte = daysToExpiry(expEpoch);
        if (dte <= 0) continue;

        const notional = strategyType === "covered_call" ? spotPriceRef.current : strike;
        const apr = notional > 0 ? calculateAPR(bidPrice, notional, dte) : 0;

        strikeOptions.push({
          strike,
          instrumentName: inst.instrument_name,
          apr,
          bidPrice,
          askPrice,
          expiry: expEpoch,
        });
      }

      strikeOptions.sort((a, b) => a.strike - b.strike);
      setStrikes(strikeOptions);

      // Auto-select a strike near ATM (only if no strike selected yet)
      if (selectedStrikeRef.current === null && strikeOptions.length > 0) {
        if (spotPriceRef.current > 0) {
          const closest = strikeOptions.reduce((prev, curr) =>
            Math.abs(curr.strike - spotPriceRef.current) < Math.abs(prev.strike - spotPriceRef.current) ? curr : prev
          );
          setSelectedStrike(closest.strike);
        } else {
          setSelectedStrike(strikeOptions[Math.floor(strikeOptions.length / 2)].strike);
        }
      }
    } catch (err) {
      console.error("Failed to fetch earn data:", err);
    } finally {
      setLoading(false);
    }
  }, [asset, strategyType, fetchInstruments]);

  useEffect(() => {
    fetchSpot();
    const interval = setInterval(fetchSpot, 10000);
    return () => clearInterval(interval);
  }, [fetchSpot]);

  // Load data once spot price is available, and when asset/strategy changes
  const hasSpot = spotPrice > 0;
  useEffect(() => {
    if (hasSpot) {
      loadData();
    }
  }, [loadData, hasSpot]);

  // Reload strikes when expiry changes
  useEffect(() => {
    if (hasSpot && selectedExpiry) {
      loadData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExpiry]);

  // Fetch collateral balances from Derive subaccount
  useEffect(() => {
    if (!isAuthenticated || subaccountId == null) {
      setBalances({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/derive/account", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ subaccount_id: subaccountId }),
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const collaterals = data.result?.collaterals || [];
        const map: Record<string, number> = {};
        for (const c of collaterals) {
          map[c.asset_name] = parseFloat(c.amount) || 0;
        }
        if (!cancelled) setBalances(map);
      } catch {
        // silently fail - balance will show 0
      }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated, subaccountId, getAuthHeaders]);

  // Derived values
  const collateralKey = strategyType === "cash_secured_put" ? collateral : asset;
  const balance = balances[collateralKey] ?? 0;
  const selectedStrikeData = strikes.find((s) => s.strike === selectedStrike);
  const amountNum = parseFloat(amount) || 0;
  const insufficientBalance = amountNum > 0 && amountNum > balance;

  const selectedExpiryData = expiries.find((e) => e.date === selectedExpiry);
  const dte = selectedStrikeData ? daysToExpiry(selectedStrikeData.expiry) : 0;
  const dteDays = Math.ceil(dte);
  const expiryDateLabel = selectedExpiryData?.label || "";

  const outcome =
    selectedStrikeData && amountNum > 0
      ? calculateOutcome({
          type: strategyType,
          strikePrice: selectedStrikeData.strike,
          spotPrice,
          amount: amountNum,
          premium: selectedStrikeData.bidPrice,
        })
      : null;

  // Submit order
  const handleSubmit = async () => {
    if (!isConnected || !address || !walletClient || !selectedStrikeData) return;

    if (!isAuthenticated || !subaccountId) {
      const ok = await authenticate();
      if (!ok) return;
      // authenticate() sets subaccountId automatically - retry on next click
      if (!subaccountId) {
        setStatus({ msg: "Signed in. Click again to submit order.", type: "error" });
      }
      return;
    }
    if (amountNum <= 0) {
      setStatus({ msg: "Enter a valid amount", type: "error" });
      return;
    }

    setSubmitting(true);
    setStatus(null);

    try {
      const contracts = outcome?.contracts || 0;
      if (contracts <= 0) {
        setStatus({ msg: "Invalid contract amount", type: "error" });
        return;
      }

      const sigResult = await signOrderViem(walletClient, {
        subaccount_id: subaccountId,
        instrument_name: selectedStrikeData.instrumentName,
        direction: "sell",
        limit_price: selectedStrikeData.bidPrice.toString(),
        amount: contracts.toString(),
        max_fee: "10",
        order_type: "limit",
        owner: address,
      });

      const res = await fetch("/api/derive/order", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          instrument_name: selectedStrikeData.instrumentName,
          subaccount_id: subaccountId,
          direction: "sell",
          limit_price: selectedStrikeData.bidPrice.toString(),
          amount: contracts.toString(),
          order_type: "limit",
          time_in_force: "gtc",
          max_fee: "10",
          signature: sigResult.signature,
          signature_expiry_sec: sigResult.signature_expiry_sec,
          nonce: sigResult.nonce,
          signer: sigResult.signer,
          mmp: false,
        }),
      });

      const data = await res.json();
      if (data.error) {
        const errMsg = typeof data.error === "object" ? (data.error.message || JSON.stringify(data.error)) : data.error;
        // If account not found, clear the bad subaccount so user can re-authenticate
        if (typeof errMsg === "string" && errMsg.toLowerCase().includes("account not found")) {
          logout();
          setStatus({ msg: "Subaccount not found. Please sign in again to Derive.", type: "error" });
        } else {
          setStatus({ msg: errMsg, type: "error" });
        }
      } else {
        setStatus({ msg: "Order placed successfully!", type: "success" });
        setAmount("");
      }
    } catch (err) {
      setStatus({
        msg: err instanceof Error ? err.message : "Unknown error",
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const collateralLabel = strategyType === "cash_secured_put" ? collateral : asset;
  const terminalPath = `~/earn/${asset}/${collateralLabel}`;

  const ChevronDown = ({ open }: { open?: boolean }) => (
    <svg
      className={`h-3 w-3 text-[#9b9590] transition-transform ${open ? "rotate-180" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );

  return (
    <TerminalCard title={terminalPath}>
      <div className="p-5">
        {/* Back button + Top bar */}
        <div className="mb-4 flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 font-mono text-xs text-[#6b6560] transition-colors hover:text-[#1a1a1a]"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>

          <div className="flex-1" />

          {/* Asset dropdown */}
          <div className="relative" ref={assetRef}>
            <button
              onClick={() => setAssetDropdownOpen(!assetDropdownOpen)}
              className="flex items-center gap-2 rounded-lg border border-[#d4cfc6] bg-white px-3 py-1.5 font-mono text-xs transition-colors hover:border-[#1a1a1a]"
            >
              <span className="font-medium text-[#1a1a1a]">{asset}</span>
              <ChevronDown open={assetDropdownOpen} />
            </button>
            {assetDropdownOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-[#d4cfc6] bg-white" style={{ boxShadow: "5px 6px 0px rgba(0,0,0,0.18)" }}>
                {["ETH", "BTC"].map((a) => (
                  <button
                    key={a}
                    onClick={() => { onChangeAsset(a); setAssetDropdownOpen(false); }}
                    className={`flex w-full px-4 py-2 font-mono text-xs hover:bg-[#f0ebe3] ${a === asset ? "bg-[#f0ebe3] font-medium text-[#1a1a1a]" : "text-[#6b6560]"}`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Type dropdown */}
          <div className="relative" ref={typeRef}>
            <button
              onClick={() => setTypeDropdownOpen(!typeDropdownOpen)}
              className="flex items-center gap-2 rounded-lg border border-[#d4cfc6] bg-white px-3 py-1.5 font-mono text-xs transition-colors hover:border-[#1a1a1a]"
            >
              <span className="font-medium text-[#1a1a1a]">
                {strategyType === "covered_call" ? "Covered Call" : "Cash Secured Put"}
              </span>
              <ChevronDown open={typeDropdownOpen} />
            </button>
            {typeDropdownOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-[#d4cfc6] bg-white" style={{ boxShadow: "5px 6px 0px rgba(0,0,0,0.18)" }}>
                {(["covered_call", "cash_secured_put"] as StrategyType[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => { onChangeType(t); setTypeDropdownOpen(false); }}
                    className={`flex w-full whitespace-nowrap px-4 py-2 font-mono text-xs hover:bg-[#f0ebe3] ${t === strategyType ? "bg-[#f0ebe3] font-medium text-[#1a1a1a]" : "text-[#6b6560]"}`}
                  >
                    {t === "covered_call" ? "Covered Call" : "Cash Secured Put"}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Expiry dropdown */}
          <div className="relative" ref={expiryRef}>
            <button
              onClick={() => setExpiryDropdownOpen(!expiryDropdownOpen)}
              className="flex items-center gap-2 rounded-lg border border-[#d4cfc6] bg-white px-3 py-1.5 font-mono text-xs transition-colors hover:border-[#1a1a1a]"
            >
              <span className="font-medium text-[#1a1a1a]">{expiryDateLabel || "Expiry"}</span>
              <ChevronDown open={expiryDropdownOpen} />
            </button>
            {expiryDropdownOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-lg border border-[#d4cfc6] bg-white" style={{ boxShadow: "5px 6px 0px rgba(0,0,0,0.18)" }}>
                {expiries.map((exp) => (
                  <button
                    key={exp.date}
                    onClick={() => { setSelectedExpiry(exp.date); setExpiryDropdownOpen(false); }}
                    className={`flex w-full whitespace-nowrap px-4 py-2 font-mono text-xs hover:bg-[#f0ebe3] ${exp.date === selectedExpiry ? "bg-[#f0ebe3] font-medium text-[#1a1a1a]" : "text-[#6b6560]"}`}
                  >
                    {exp.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Spot price */}
          <div className="rounded-lg border border-[#d4cfc6] bg-[#f8f5f0] px-3 py-1.5 font-mono text-xs text-[#6b6560]">
            Spot: <span className="font-medium text-[#1a1a1a]">${spotPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
          </div>
        </div>

        {/* Strike selection */}
        {loading ? (
          <div className="py-10 text-center font-mono text-sm text-[#9b9590]">
            Loading strikes...
          </div>
        ) : strikes.length === 0 ? (
          <div className="py-10 text-center font-mono text-sm text-[#9b9590]">
            No strikes available for this expiry
          </div>
        ) : (
          <>
            {/* Prompt text */}
            <div className="mb-4 font-mono text-sm text-[#6b6560]">
              Choose the price at which you are happy to{" "}
              {strategyType === "cash_secured_put" ? "buy" : "sell"}{" "}
              <span className="font-medium text-[#1a1a1a]">{asset}</span> on{" "}
              <span className="font-medium text-[#1a1a1a]">{expiryDateLabel}</span>{" "}
              (in {dteDays} days)
            </div>

            {/* Strike cards row */}
            <div className="mb-6 flex gap-2 overflow-x-auto pb-2 pt-3">
              {strikes.map((s) => (
                <StrikeCard
                  key={s.strike}
                  strike={s.strike}
                  apr={s.apr}
                  selected={s.strike === selectedStrike}
                  onClick={() => setSelectedStrike(s.strike)}
                />
              ))}
            </div>
          </>
        )}

        {/* Amount input section */}
        <div className="mb-5 rounded-lg border border-[#d4cfc6] bg-[#faf8f5] p-4">
          <div className="flex items-center gap-3">
            {/* MAX button */}
            <button
              onClick={() => setAmount(balance.toString())}
              className="rounded border border-[#d4cfc6] bg-white px-2.5 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-[#6b6560] transition-colors hover:border-[#1a1a1a] hover:text-[#1a1a1a]"
            >
              MAX
            </button>

            {/* -/+ buttons */}
            <button
              onClick={() => setAmount(Math.max(0, amountNum - 100).toString())}
              className="flex h-8 w-8 items-center justify-center rounded border border-[#d4cfc6] bg-white font-mono text-sm text-[#6b6560] transition-colors hover:border-[#1a1a1a]"
            >
              -
            </button>

            {/* Amount input */}
            <input
              type="number"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="flex-1 bg-transparent text-center font-mono text-2xl font-semibold text-[#1a1a1a] outline-none placeholder:text-[#c8c3ba]"
            />

            <button
              onClick={() => setAmount((amountNum + 100).toString())}
              className="flex h-8 w-8 items-center justify-center rounded border border-[#d4cfc6] bg-white font-mono text-sm text-[#6b6560] transition-colors hover:border-[#1a1a1a]"
            >
              +
            </button>

            {/* Collateral selector */}
            {strategyType === "cash_secured_put" && (
              <div className="relative" ref={collateralRef}>
                <button
                  onClick={() => setCollateralDropdownOpen(!collateralDropdownOpen)}
                  className="flex items-center gap-1.5 rounded-lg border border-[#d4cfc6] bg-white px-3 py-1.5 font-mono text-xs font-medium text-[#1a1a1a] transition-colors hover:border-[#1a1a1a]"
                >
                  {collateral}
                  <ChevronDown open={collateralDropdownOpen} />
                </button>
                {collateralDropdownOpen && (
                  <div className="absolute right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-[#d4cfc6] bg-white" style={{ boxShadow: "5px 6px 0px rgba(0,0,0,0.18)" }}>
                    {COLLATERAL_OPTIONS.map((c) => (
                      <button
                        key={c}
                        onClick={() => { setCollateral(c); setCollateralDropdownOpen(false); }}
                        className={`flex w-full px-4 py-2 font-mono text-xs hover:bg-[#f0ebe3] ${c === collateral ? "bg-[#f0ebe3] font-medium" : "text-[#6b6560]"}`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Balance row */}
          <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-[#9b9590]">
            <div className="flex items-center gap-2">
              <span>Balance: {balance.toFixed(2)} {collateralLabel}</span>
              <a
                href="https://app.derive.xyz"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded border border-[#d4cfc6] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#6b6560] transition-colors hover:border-[#1a1a1a] hover:text-[#1a1a1a]"
              >
                Deposit
              </a>
            </div>
            {insufficientBalance && (
              <span className="font-semibold uppercase text-[#ef4444]">
                Insufficient Balance
              </span>
            )}
          </div>
        </div>

        {/* Outcome summary */}
        {selectedStrikeData && outcome && amountNum > 0 && (
          <div className="mb-5 grid grid-cols-2 gap-3">
            {/* Now card */}
            <div className="rounded-lg border border-[#d4cfc6] p-4" style={{ background: "repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(0,0,0,0.015) 8px, rgba(0,0,0,0.015) 16px)" }}>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[#9b9590]">
                Now
              </div>
              <div className="mb-0.5 font-mono text-lg font-bold text-[#16a34a]">
                APR {selectedStrikeData.apr.toFixed(1)}%
              </div>
              <div className="font-mono text-xs text-[#6b6560]">
                Upfront premium:{" "}
                <span className="font-medium text-[#1a1a1a]">
                  {outcome.totalPremium.toFixed(4)} {collateralLabel}
                </span>
              </div>
            </div>

            {/* On expiry card */}
            <div className="rounded-lg border border-[#d4cfc6] p-4" style={{ background: "repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(0,0,0,0.015) 8px, rgba(0,0,0,0.015) 16px)" }}>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[#9b9590]">
                On {expiryDateLabel}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="font-mono text-[10px] text-[#9b9590]">
                    If {asset}{" "}
                    {strategyType === "cash_secured_put" ? "BELOW" : "ABOVE"}{" "}
                    ${selectedStrikeData.strike.toLocaleString()}
                  </div>
                  <div className="mt-0.5 font-mono text-xs font-medium text-[#1a1a1a]">
                    {strategyType === "cash_secured_put"
                      ? `Receive ${outcome.ifBelow.value.toFixed(4)} ${asset}`
                      : `Sold at $${outcome.ifAbove.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                  </div>
                </div>
                <div>
                  <div className="font-mono text-[10px] text-[#9b9590]">
                    If {asset}{" "}
                    {strategyType === "cash_secured_put" ? "ABOVE" : "BELOW"}{" "}
                    ${selectedStrikeData.strike.toLocaleString()}
                  </div>
                  <div className="mt-0.5 font-mono text-xs font-medium text-[#1a1a1a]">
                    {strategyType === "cash_secured_put"
                      ? `Get $${outcome.ifAbove.value.toLocaleString(undefined, { maximumFractionDigits: 2 })} back`
                      : `Keep ${outcome.ifBelow.value.toFixed(4)} ${asset}`}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* CTA Button */}
        <button
          onClick={handleSubmit}
          disabled={submitting || isAuthenticating || !selectedStrikeData || amountNum <= 0}
          className="w-full rounded-lg py-3.5 font-mono text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            background: selectedStrikeData && amountNum > 0 ? "#4a5a3a" : "#d4cfc6",
            color: selectedStrikeData && amountNum > 0 ? "#ffffff" : "#9b9590",
            border: "1px solid",
            borderColor: selectedStrikeData && amountNum > 0 ? "#3d4d2f" : "#d4cfc6",
          }}
        >
          {submitting
            ? "Signing order..."
            : isAuthenticating
            ? "Authenticating..."
            : !isConnected
            ? "Connect Wallet"
            : !isAuthenticated || !subaccountId
            ? "Sign in to Derive"
            : "Earn upfront premium now"}
        </button>

        {/* Derive wallet input */}
        {needsDeriveWallet && (
          <div className="mt-3 rounded-lg border border-[#d4cfc6] p-3">
            <label className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-wider text-[#6b6560]">
              Derive Wallet Address
            </label>
            <p className="mb-2 font-mono text-[10px] text-[#9b9590]">
              Find this on{" "}
              <a href="https://app.derive.xyz" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#1a1a1a]">
                app.derive.xyz
              </a>
              {" "}→ Settings → Developers → &quot;Derive Wallet&quot;
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="0x..."
                className="flex-1 rounded-lg border border-[#d4cfc6] bg-white px-3 py-2 font-mono text-xs text-[#1a1a1a] outline-none focus:border-[#1a1a1a]"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const val = (e.target as HTMLInputElement).value.trim();
                    if (val.startsWith("0x") && val.length === 42) {
                      setDeriveWallet(val);
                    }
                  }
                }}
              />
              <button
                onClick={(e) => {
                  const input = (e.currentTarget.previousElementSibling as HTMLInputElement);
                  const val = input?.value?.trim();
                  if (val?.startsWith("0x") && val.length === 42) {
                    setDeriveWallet(val);
                  }
                }}
                className="rounded-lg border border-[#1a1a1a] bg-[#1a1a1a] px-3 py-2 font-mono text-xs font-semibold text-white transition-colors hover:bg-[#333]"
              >
                Save
              </button>
            </div>
          </div>
        )}

        {/* Show saved Derive wallet */}
        {deriveWallet && !needsDeriveWallet && (
          <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-[#9b9590]">
            <span>Derive: {deriveWallet.slice(0, 6)}...{deriveWallet.slice(-4)}</span>
            <button
              onClick={() => setDeriveWallet("")}
              className="text-[9px] underline hover:text-[#1a1a1a]"
            >
              Change
            </button>
          </div>
        )}

        {/* Status message */}
        {(status || (authError && !needsDeriveWallet)) && (
          <div
            className={`mt-3 rounded-lg border p-3 font-mono text-xs ${
              status?.type === "success"
                ? "border-[#22c55e]/30 bg-[#22c55e]/5 text-[#22c55e]"
                : "border-[#ef4444]/30 bg-[#ef4444]/5 text-[#ef4444]"
            }`}
          >
            {status?.msg || authError || ""}
          </div>
        )}
      </div>
    </TerminalCard>
  );
}
