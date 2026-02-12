"use client";

import { useState, useEffect } from "react";
import { useAccount, useWalletClient } from "wagmi";
import TerminalCard from "./TerminalCard";
import { useDeriveSession } from "./DeriveSessionProvider";
import { signOrderViem } from "@/lib/derive/signOrder";
import type { Ticker } from "@/lib/derive/types";

function cleanError(msg: string): string {
  if (msg.includes("non-JSON")) return "API endpoint unavailable. Check network.";
  if (msg.includes("<!doctype") || msg.includes("<html")) return "API request failed";
  if (msg.includes("User denied") || msg.includes("rejected")) return "Signature rejected";
  return msg.replace(/Derive API error \(\d+\): /, "");
}

/** Parse option instrument name: ETH-20250329-2000-C */
function parseOptionName(name: string) {
  const parts = name.split("-");
  if (parts.length !== 4) return null;
  const [asset, dateStr, strikeStr, type] = parts;
  const year = dateStr.slice(0, 4);
  const month = dateStr.slice(4, 6);
  const day = dateStr.slice(6, 8);
  return {
    asset,
    expiry: `${year}-${month}-${day}`,
    expiryLabel: new Date(`${year}-${month}-${day}`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    strike: parseFloat(strikeStr),
    type: type === "C" ? "Call" : "Put",
    typeShort: type,
  };
}

interface OrderFormProps {
  selectedInstrument: string;
  prefillPrice?: string;
  prefillDirection?: "buy" | "sell";
}

export default function OrderForm({
  selectedInstrument,
  prefillPrice,
  prefillDirection,
}: OrderFormProps) {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const {
    isAuthenticated,
    subaccountId,
    isAuthenticating,
    authError,
    authenticate,
    getAuthHeaders,
  } = useDeriveSession();

  const [direction, setDirection] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<"limit" | "market">("limit");
  const [price, setPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [maxFee] = useState("10");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ msg: string; type: "info" | "success" | "error" } | null>(null);
  const [ticker, setTicker] = useState<Ticker | null>(null);

  // Apply prefill values when they change
  useEffect(() => {
    if (prefillPrice) setPrice(prefillPrice);
    if (prefillDirection) setDirection(prefillDirection);
  }, [prefillPrice, prefillDirection]);

  // Fetch ticker for the selected instrument
  useEffect(() => {
    if (!selectedInstrument) return;
    let cancelled = false;

    async function fetchTicker() {
      try {
        const res = await fetch("/api/derive/ticker", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instrument_name: selectedInstrument }),
        });
        const data = await res.json();
        if (!cancelled && data.result) setTicker(data.result);
      } catch {
        // ignore
      }
    }

    fetchTicker();
    const interval = setInterval(fetchTicker, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedInstrument]);

  const optionDetails = parseOptionName(selectedInstrument);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnected || !address || !walletClient) return;

    if (!isAuthenticated) {
      const ok = await authenticate();
      if (!ok) return;
      return;
    }

    if (!subaccountId) return;

    if (!amount || parseFloat(amount) <= 0) {
      setStatus({ msg: "Enter a valid amount", type: "error" });
      return;
    }
    if (orderType === "limit" && (!price || parseFloat(price) <= 0)) {
      setStatus({ msg: "Enter a valid price", type: "error" });
      return;
    }

    setSubmitting(true);
    setStatus(null);

    try {
      const limitPrice =
        orderType === "market"
          ? direction === "buy" ? "999999" : "0.01"
          : price;

      const sigResult = await signOrderViem(walletClient, {
        subaccount_id: subaccountId,
        instrument_name: selectedInstrument,
        direction,
        limit_price: limitPrice,
        amount,
        max_fee: maxFee,
        order_type: orderType,
        owner: address,
      });

      const res = await fetch("/api/derive/order", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          instrument_name: selectedInstrument,
          subaccount_id: subaccountId,
          direction,
          limit_price: limitPrice,
          amount,
          order_type: orderType,
          time_in_force: orderType === "market" ? "ioc" : "gtc",
          max_fee: maxFee,
          signature: sigResult.signature,
          signature_expiry_sec: sigResult.signature_expiry_sec,
          nonce: sigResult.nonce,
          signer: sigResult.signer,
          mmp: false,
        }),
      });

      const data = await res.json();
      if (data.error) {
        setStatus({ msg: cleanError(data.error), type: "error" });
      } else {
        setStatus({ msg: "Order placed", type: "success" });
        setPrice("");
        setAmount("");
      }
    } catch (err) {
      setStatus({ msg: cleanError(err instanceof Error ? err.message : "Unknown error"), type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const getButtonLabel = () => {
    if (submitting) return "Signing order...";
    if (isAuthenticating) return "Authenticating...";
    if (!isConnected) return "Connect Wallet";
    if (!isAuthenticated || !subaccountId) return "Sign in to Derive";
    return `${direction === "buy" ? "Buy" : "Sell"} ${optionDetails ? `${optionDetails.strike} ${optionDetails.type}` : selectedInstrument}`;
  };

  const greeks = ticker?.option_pricing;

  return (
    <TerminalCard title="~/order">
      <div className="p-4">
        {/* Option Details Header */}
        {optionDetails && (
          <div className="mb-3 rounded-lg border border-[#d4cfc6] bg-[#f8f5f0] p-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm font-medium text-[#1a1a1a]">
                {optionDetails.asset} ${optionDetails.strike.toLocaleString()} {optionDetails.type}
              </span>
              <span className={`rounded px-2 py-0.5 font-mono text-[10px] font-medium ${
                optionDetails.typeShort === "C"
                  ? "bg-[#22c55e]/10 text-[#22c55e]"
                  : "bg-[#ef4444]/10 text-[#ef4444]"
              }`}>
                {optionDetails.type}
              </span>
            </div>
            <div className="mt-1 font-mono text-[10px] text-[#9b9590]">
              Expires {optionDetails.expiryLabel}
            </div>
            {ticker?.option_pricing?.mark_iv && (
              <div className="mt-1 font-mono text-xs text-[#6b6560]">
                IV: {(parseFloat(ticker.option_pricing.mark_iv) * 100).toFixed(1)}%
              </div>
            )}
          </div>
        )}

        {/* Greeks Grid */}
        {greeks && (
          <div className="mb-3 grid grid-cols-4 gap-0 rounded-lg border border-[#d4cfc6]">
            {[
              { label: "Delta", value: greeks.delta },
              { label: "Gamma", value: greeks.gamma },
              { label: "Theta", value: greeks.theta },
              { label: "Vega", value: greeks.vega },
            ].map((g, i) => (
              <div
                key={g.label}
                className={`px-2 py-1.5 ${i < 3 ? "border-r border-[#d4cfc6]" : ""}`}
              >
                <div className="font-mono text-[9px] uppercase tracking-wider text-[#9b9590]">
                  {g.label}
                </div>
                <div className="font-mono text-xs text-[#1a1a1a]">
                  {g.value ? parseFloat(g.value).toFixed(4) : "-"}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Instrument label + subaccount */}
        <div className="mb-3 flex items-center justify-between font-mono text-xs text-[#6b6560]">
          <span>{selectedInstrument}</span>
          {isAuthenticated && subaccountId && (
            <span className="text-[#9b9590]">#{subaccountId}</span>
          )}
        </div>

        {/* Buy/Sell Toggle */}
        <div className="mb-3 flex gap-2">
          <button
            onClick={() => setDirection("buy")}
            className={`flex-1 rounded-lg border py-2.5 font-mono text-sm font-medium transition-all ${
              direction === "buy"
                ? "border-[#1a1a1a] bg-[#1a1a1a] text-white"
                : "border-[#d4cfc6] bg-white text-[#6b6560] hover:border-[#1a1a1a] hover:text-[#1a1a1a]"
            }`}
          >
            Buy
          </button>
          <button
            onClick={() => setDirection("sell")}
            className={`flex-1 rounded-lg border py-2.5 font-mono text-sm font-medium transition-all ${
              direction === "sell"
                ? "border-[#1a1a1a] bg-[#1a1a1a] text-white"
                : "border-[#d4cfc6] bg-white text-[#6b6560] hover:border-[#1a1a1a] hover:text-[#1a1a1a]"
            }`}
          >
            Sell
          </button>
        </div>

        {/* Order Type Tabs */}
        <div className="mb-3 flex gap-2">
          {(["limit", "market"] as const).map((type) => (
            <button
              key={type}
              onClick={() => setOrderType(type)}
              className={`tab-btn ${orderType === type ? "active" : ""}`}
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {orderType === "limit" && (
            <div>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-[#9b9590]">
                Price
              </label>
              <input
                type="number"
                step="any"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-[#d4cfc6] bg-white px-3 py-2.5 font-mono text-sm text-[#1a1a1a] transition-colors placeholder:text-[#c8c3ba] focus:border-[#1a1a1a] focus:outline-none"
              />
            </div>
          )}

          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-[#9b9590]">
              Amount
            </label>
            <input
              type="number"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-lg border border-[#d4cfc6] bg-white px-3 py-2.5 font-mono text-sm text-[#1a1a1a] transition-colors placeholder:text-[#c8c3ba] focus:border-[#1a1a1a] focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={submitting || isAuthenticating || !isConnected}
            className="w-full rounded-lg border border-[#1a1a1a] bg-white py-3 font-mono text-sm font-medium text-[#1a1a1a] transition-all hover:bg-[#1a1a1a] hover:text-white disabled:opacity-40"
          >
            {getButtonLabel()}
          </button>
        </form>

        {(status || authError) && (
          <div
            className={`mt-3 rounded-lg border p-3 font-mono text-xs ${
              status?.type === "success"
                ? "border-[#22c55e]/30 bg-[#22c55e]/5 text-[#22c55e]"
                : status?.type === "error" || authError
                ? "border-[#ef4444]/30 bg-[#ef4444]/5 text-[#ef4444]"
                : "border-[#d4cfc6] bg-[#f8f5f0] text-[#6b6560]"
            }`}
          >
            {status?.msg || (authError ? cleanError(authError) : "")}
          </div>
        )}
      </div>
    </TerminalCard>
  );
}
