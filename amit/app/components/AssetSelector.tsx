"use client";

import { useState, useEffect, useRef } from "react";

interface AssetSelectorProps {
  selectedAsset: string;
  onSelectAsset: (asset: string) => void;
  spotPrice: string | null;
}

export default function AssetSelector({
  selectedAsset,
  onSelectAsset,
  spotPrice,
}: AssetSelectorProps) {
  const [assets, setAssets] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function fetchAssets() {
      try {
        // Fetch instruments for a few known currencies to discover available assets
        const currencies = ["ETH", "BTC"];
        const found = new Set<string>();
        for (const currency of currencies) {
          try {
            const res = await fetch("/api/derive/instruments", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                currency,
                instrument_type: "option",
                expired: false,
              }),
            });
            const data = await res.json();
            const instruments = data.result || [];
            if (Array.isArray(instruments) && instruments.length > 0) {
              found.add(currency);
            }
          } catch {
            // skip unavailable currencies
          }
        }
        if (found.size > 0) {
          setAssets(Array.from(found).sort());
        } else {
          setAssets(["ETH", "BTC"]);
        }
      } catch {
        setAssets(["ETH", "BTC"]);
      }
    }
    fetchAssets();
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const formatSpotPrice = (p: string | null) => {
    if (!p) return "";
    const n = parseFloat(p);
    if (isNaN(n)) return "";
    return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-3 rounded-lg border border-[#d4cfc6] bg-white px-4 py-2.5 font-mono text-sm transition-colors hover:border-[#1a1a1a]"
        style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}
      >
        <span className="font-medium text-[#1a1a1a]">{selectedAsset}</span>
        {spotPrice && (
          <span className="text-[#6b6560]">{formatSpotPrice(spotPrice)}</span>
        )}
        <svg
          className={`h-3 w-3 text-[#9b9590] transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-1 min-w-[140px] overflow-hidden rounded-lg border border-[#d4cfc6] bg-white"
          style={{ boxShadow: "5px 6px 0px rgba(0,0,0,0.18)" }}
        >
          {assets.map((asset) => (
            <button
              key={asset}
              onClick={() => {
                onSelectAsset(asset);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 px-4 py-2.5 font-mono text-sm transition-colors hover:bg-[#f0ebe3] ${
                asset === selectedAsset ? "bg-[#f0ebe3] font-medium text-[#1a1a1a]" : "text-[#6b6560]"
              }`}
            >
              {asset === selectedAsset && (
                <span className="h-1.5 w-1.5 rounded-full bg-[#22c55e]" />
              )}
              {asset}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
