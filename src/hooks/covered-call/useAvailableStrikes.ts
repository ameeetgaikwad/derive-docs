"use client";

import { useQuery } from "@tanstack/react-query";
import { useDerive } from "@/providers/DeriveProvider";
import { useMemo } from "react";
import type { Instrument } from "@/lib/derive/types";

export interface StrikeOption {
  instrumentName: string;
  strike: number;
  expiry: number;
  markPrice?: string;
  askPrice?: string;
  bidPrice?: string;
  /** Distance from spot as percentage, e.g. 5 = 5% OTM */
  otmPercent?: number;
}

export interface ExpiryInfo {
  epoch: number;
  label: string;
  instrumentCount: number;
}

function formatExpiryLabel(expiryTimestamp: number): string {
  const date = new Date(expiryTimestamp * 1000);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * OTM target percentages above spot for suggested covered call strikes.
 * Near-ATM through deep OTM, covering typical covered call strategies.
 */
const OTM_TARGETS = [2, 5, 8, 10, 15, 20, 25, 30, 40, 50];

/**
 * For a given spot price, find the closest instrument strike to each OTM target.
 * Returns a deduplicated, sorted list of the best matching strikes.
 */
function selectSuggestedStrikes(
  instruments: Instrument[],
  spotPrice: number
): Map<number, Instrument> {
  const selected = new Map<number, Instrument>();

  for (const targetPct of OTM_TARGETS) {
    const targetStrike = spotPrice * (1 + targetPct / 100);
    let bestInst: Instrument | null = null;
    let bestDist = Infinity;

    for (const inst of instruments) {
      const strike = parseFloat(inst.option_details!.strike);
      const dist = Math.abs(strike - targetStrike);
      // Only consider strikes that are OTM (above spot for calls)
      if (strike <= spotPrice) continue;
      if (dist < bestDist) {
        bestDist = dist;
        bestInst = inst;
      }
    }

    if (bestInst) {
      const strike = parseFloat(bestInst.option_details!.strike);
      // Avoid duplicates — same instrument might match multiple targets
      if (!selected.has(strike)) {
        selected.set(strike, bestInst);
      }
    }
  }

  return selected;
}

/**
 * Fetch available BTC call options for the strike picker.
 *
 * Strategy: Instead of showing all 50+ strikes per expiry, we algorithmically
 * select ~8-10 OTM strikes at meaningful distances from spot (2%, 5%, 10%, etc).
 * We use mark_price for estimated yield — the real price comes from RFQ.
 */
export function useAvailableStrikes(selectedExpiry: number | null = null, spotPrice: number = 0) {
  const { restClient } = useDerive();

  const instrumentsQuery = useQuery({
    queryKey: ["btc-call-instruments"],
    queryFn: () => restClient.getInstruments("BTC", "option"),
    refetchInterval: 60_000,
  });

  // Filter to active call options that haven't expired
  const callInstruments = useMemo(() => {
    if (!instrumentsQuery.data) return [];
    const now = Math.floor(Date.now() / 1000);

    return instrumentsQuery.data.filter((inst: Instrument) => {
      if (!inst.is_active) return false;
      if (!inst.option_details) return false;
      if (inst.option_details.option_type !== "C") return false;
      if (inst.option_details.expiry <= now) return false;
      return true;
    });
  }, [instrumentsQuery.data]);

  // Extract unique expiries
  const expiries = useMemo((): ExpiryInfo[] => {
    const map = new Map<number, number>();
    for (const inst of callInstruments) {
      const exp = inst.option_details!.expiry;
      map.set(exp, (map.get(exp) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([epoch, count]) => ({ epoch, label: formatExpiryLabel(epoch), instrumentCount: count }))
      .sort((a, b) => a.epoch - b.epoch);
  }, [callInstruments]);

  // Instruments for the selected expiry
  const expiryInstruments = useMemo(() => {
    if (!selectedExpiry) return [];
    return callInstruments.filter(
      (inst) => inst.option_details!.expiry === selectedExpiry
    );
  }, [callInstruments, selectedExpiry]);

  // Select suggested strikes algorithmically
  const suggestedInstruments = useMemo(() => {
    if (expiryInstruments.length === 0 || spotPrice <= 0) return [];
    const selected = selectSuggestedStrikes(expiryInstruments, spotPrice);
    return Array.from(selected.values()).sort(
      (a, b) => parseFloat(a.option_details!.strike) - parseFloat(b.option_details!.strike)
    );
  }, [expiryInstruments, spotPrice]);

  // Fetch tickers only for suggested instruments (small batch, ~8-10 calls)
  const tickerQuery = useQuery({
    queryKey: ["btc-call-tickers", selectedExpiry, suggestedInstruments.map((i) => i.instrument_name)],
    queryFn: async () => {
      if (suggestedInstruments.length === 0) return [];
      return restClient.getTickers(suggestedInstruments.map((i) => i.instrument_name));
    },
    enabled: suggestedInstruments.length > 0,
    refetchInterval: 15_000,
  });

  // Build strike options with ticker data
  const strikes = useMemo((): StrikeOption[] => {
    if (suggestedInstruments.length === 0 || spotPrice <= 0) return [];

    const tickerMap = new Map<string, { markPrice: string; askPrice: string; bidPrice: string }>();
    if (tickerQuery.data) {
      for (const ticker of tickerQuery.data) {
        tickerMap.set(ticker.instrument_name, {
          markPrice: ticker.mark_price,
          askPrice: ticker.best_ask_price,
          bidPrice: ticker.best_bid_price,
        });
      }
    }

    return suggestedInstruments.map((inst) => {
      const details = inst.option_details!;
      const strike = parseFloat(details.strike);
      const ticker = tickerMap.get(inst.instrument_name);
      const otmPercent = ((strike - spotPrice) / spotPrice) * 100;

      return {
        instrumentName: inst.instrument_name,
        strike,
        expiry: details.expiry,
        markPrice: ticker?.markPrice,
        askPrice: ticker?.askPrice,
        bidPrice: ticker?.bidPrice,
        otmPercent,
      };
    });
  }, [suggestedInstruments, tickerQuery.data, spotPrice]);

  return {
    expiries,
    strikes,
    isLoading: instrumentsQuery.isLoading,
    isTickersLoading: tickerQuery.isLoading && suggestedInstruments.length > 0,
    error: instrumentsQuery.error || tickerQuery.error,
  };
}
