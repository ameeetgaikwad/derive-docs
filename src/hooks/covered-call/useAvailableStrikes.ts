"use client";

import { useQuery } from "@tanstack/react-query";
import { useDerive } from "@/providers/DeriveProvider";
import { useMemo } from "react";
import type { Instrument } from "@/lib/derive/types";

interface StrikeOption {
  instrumentName: string;
  strike: number;
  expiry: number;
  premium?: string;
  askPrice?: string;
  bidPrice?: string;
}

interface GroupedStrikes {
  expiry: number;
  expiryLabel: string;
  strikes: StrikeOption[];
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
 * Fetch available BTC call options for the strike picker.
 * Filters to active, non-expired calls, groups by expiry, and fetches ticker data for premiums.
 */
export function useAvailableStrikes() {
  const { restClient } = useDerive();

  const instrumentsQuery = useQuery({
    queryKey: ["btc-call-instruments"],
    queryFn: () => restClient.getInstruments("BTC", "option"),
    refetchInterval: 30_000,
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

  // Fetch tickers for all filtered instruments
  const tickerQuery = useQuery({
    queryKey: ["btc-call-tickers", callInstruments.map((i) => i.instrument_name)],
    queryFn: async () => {
      if (callInstruments.length === 0) return [];
      return restClient.getTickers(callInstruments.map((i) => i.instrument_name));
    },
    enabled: callInstruments.length > 0,
    refetchInterval: 30_000,
  });

  // Build grouped strikes with ticker data
  const strikes = useMemo((): GroupedStrikes[] => {
    if (callInstruments.length === 0) return [];

    // Build a map of instrument_name -> ticker data
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

    // Group by expiry
    const expiryMap = new Map<number, StrikeOption[]>();

    for (const inst of callInstruments) {
      const details = inst.option_details!;
      const ticker = tickerMap.get(inst.instrument_name);

      const option: StrikeOption = {
        instrumentName: inst.instrument_name,
        strike: parseFloat(details.strike),
        expiry: details.expiry,
        premium: ticker?.markPrice,
        askPrice: ticker?.askPrice,
        bidPrice: ticker?.bidPrice,
      };

      const existing = expiryMap.get(details.expiry);
      if (existing) {
        existing.push(option);
      } else {
        expiryMap.set(details.expiry, [option]);
      }
    }

    // Sort each group by strike ascending, then sort groups by expiry ascending
    const grouped: GroupedStrikes[] = [];
    for (const [expiry, options] of expiryMap) {
      options.sort((a, b) => a.strike - b.strike);
      grouped.push({
        expiry,
        expiryLabel: formatExpiryLabel(expiry),
        strikes: options,
      });
    }

    grouped.sort((a, b) => a.expiry - b.expiry);

    return grouped;
  }, [callInstruments, tickerQuery.data]);

  return {
    strikes,
    isLoading: instrumentsQuery.isLoading || tickerQuery.isLoading,
    error: instrumentsQuery.error || tickerQuery.error,
  };
}
