"use client";

import { useEffect, useMemo, useState } from "react";
import type { ContractFunctionParameters } from "viem";
import { useReadContracts } from "wagmi";
import {
  lyraForwardFeedAbi,
  lyraRateFeedAbi,
  lyraVolFeedAbi,
} from "@/lib/protocol/abis";
import {
  formatExpiryLabel,
  strikesForExpiry,
  weeklyExpiries,
  rwaWeeklyExpiries,
  type BoardStrike,
} from "@/lib/protocol/board";
import { black76Price, yearsToExpiry } from "@/lib/protocol/black76";
import { calculateAPR, daysToExpiry } from "@/lib/protocol/apr";
import { unitToNumber } from "@/lib/protocol/units";
import { useSpotPrice } from "./useSpotPrice";
import { useNetwork } from "./useNetwork";
import { getMarket, type MarketId } from "@/lib/protocol/markets";
import { getRfqMarkets, type PublicMarketStatus } from "@/lib/protocol/rfq-engine";

/** Fallbacks when an expiry has no posted feed data yet (testnet reality). */
const DEFAULT_IV = 0.6;
const DEFAULT_RATE = 0.05;

export interface ExpiryInfo {
  epoch: number;
  label: string;
}

export interface StrikeOption extends BoardStrike {
  /** Indicative Black-76 premium per contract, USD */
  premium: number;
  /** Annualized premium yield on spot notional, % */
  apr: number;
  /** IV used for pricing */
  vol: number;
  /** Forward price used for Black-76 pricing and fee estimation, USD */
  forwardPrice: number;
  /** true when any pricing input used an off-chain or documented default */
  usedFallback: boolean;
}

/**
 * The option board, generated locally (there is no instruments API):
 * weekly Friday 08:00 UTC expiries and an OTM strike grid around on-chain
 * spot. Indicative premiums are computed client-side with Black-76 from the
 * on-chain feeds (forward/vol/rate, posted by oracle-feeds) — the same model
 * the reference maker-bot quotes with. Executable pricing always comes from
 * the RFQ auction.
 */
export function useAvailableStrikes(
  selectedExpiry: number | null,
  marketId: MarketId = "BTC",
) {
  const { chainId } = useNetwork();
  const market = getMarket(chainId, marketId);
  const {
    spotPrice,
    multiplier,
    indicative: spotUsedFallback,
    isLoading: spotLoading,
    isUnavailable,
  } = useSpotPrice(marketId);
  const [serverMarket, setServerMarket] = useState<PublicMarketStatus | null>(null);
  const [statusErrorMarketId, setStatusErrorMarketId] = useState<MarketId | null>(null);

  useEffect(() => {
    if (market.marketHours !== "24/5" || !market.enabled) {
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const statuses = await getRfqMarkets(chainId);
        if (!cancelled) {
          setServerMarket(statuses.find((status) => status.id === marketId) ?? null);
          setStatusErrorMarketId(null);
        }
      } catch {
        if (!cancelled) setStatusErrorMarketId(marketId);
      }
    };
    void load();
    const interval = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [chainId, market.enabled, market.marketHours, marketId]);
  const activeServerMarket = serverMarket?.id === marketId ? serverMarket : null;
  const statusError = statusErrorMarketId === marketId;
  const unavailableReason = !market.enabled
    ? "Market deployment is staged but not enabled"
    : market.marketHours === "24/5" && activeServerMarket?.status !== "open"
      ? activeServerMarket?.disableReason ?? (statusError ? "Market readiness service is unavailable" : "Checking market readiness")
      : null;
  const marketUnavailable = isUnavailable || unavailableReason !== null;

  const expiries = useMemo<ExpiryInfo[]>(
    () =>
      (market.marketHours === "24/7"
        ? weeklyExpiries(4)
        : activeServerMarket?.supportedExpiries?.length
          ? activeServerMarket.supportedExpiries
          : rwaWeeklyExpiries(4)).map((epoch) => ({
        epoch,
        label: formatExpiryLabel(epoch),
      })),
    [activeServerMarket, market.marketHours]
  );

  const effectiveExpiry = useMemo(() => {
    if (selectedExpiry !== null && expiries.some((e) => e.epoch === selectedExpiry)) {
      return selectedExpiry;
    }
    return expiries[0]?.epoch ?? null;
  }, [expiries, selectedExpiry]);

  const boardStrikes = useMemo(
    () =>
      effectiveExpiry && spotPrice > 0
        ? strikesForExpiry(spotPrice, effectiveExpiry, {
            currency: market.id,
            strikeIncrement: market.strikeIncrement,
            uiMultiplier: multiplier,
          })
        : [],
    [effectiveExpiry, market.id, market.strikeIncrement, multiplier, spotPrice]
  );

  // Heterogeneous batch (multicall): [forward, rate, vol per strike].
  const feedContracts = useMemo<ContractFunctionParameters[]>(() => {
    if (effectiveExpiry === null || boardStrikes.length === 0 || !market.contracts) return [];
    const contracts = market.contracts;
    return [
      {
        abi: lyraForwardFeedAbi,
        address: contracts.forwardFeed,
        chainId,
        functionName: "getForwardPrice",
        args: [BigInt(effectiveExpiry)],
      },
      {
        abi: lyraRateFeedAbi,
        address: contracts.rateFeed,
        chainId,
        functionName: "getInterestRate",
        args: [BigInt(effectiveExpiry)],
      },
      ...boardStrikes.map((s) => ({
        abi: lyraVolFeedAbi,
        address: contracts.volFeed,
        chainId,
        functionName: "getVol",
        args: [s.strike18, BigInt(s.expiry)],
      })),
    ];
  }, [effectiveExpiry, boardStrikes, market.contracts, chainId]);

  const feedReads = useReadContracts({
    contracts: feedContracts,
    query: {
      enabled: feedContracts.length > 0,
      refetchInterval: 30_000,
    },
  });

  const strikes = useMemo<StrikeOption[]>(() => {
    if (!effectiveExpiry || boardStrikes.length === 0 || spotPrice <= 0) return [];
    const dte = daysToExpiry(effectiveExpiry);
    if (dte <= 0) return [];

    const results = feedReads.data;
    const forwardRes = results?.[0];
    const rateRes = results?.[1];

    const rawForward =
      forwardRes?.status === "success"
        ? unitToNumber((forwardRes.result as readonly [bigint, bigint])[0])
        : spotPrice;
    const scale = multiplier == null ? 1 : Number(multiplier) / 1e18;
    const forward = rawForward / scale;
    const rate =
      rateRes?.status === "success"
        ? unitToNumber((rateRes.result as readonly [bigint, bigint])[0])
        : DEFAULT_RATE;

    const T = yearsToExpiry(effectiveExpiry);

    return boardStrikes.map((s, i) => {
      const volRes = results?.[2 + i];
      const volOk = volRes?.status === "success";
      const vol = volOk
        ? unitToNumber((volRes.result as readonly [bigint, bigint])[0])
        : DEFAULT_IV;

      const premium = black76Price({
        forward,
        strike: s.strike,
        timeToExpiryYears: T,
        vol: vol > 0 ? vol : DEFAULT_IV,
        rate,
        isCall: s.isCall,
      });

      return {
        ...s,
        premium,
        apr: calculateAPR(premium, s.isCall ? spotPrice : s.strike, dte),
        vol,
        forwardPrice: forward,
        usedFallback:
          !volOk ||
          forwardRes?.status !== "success" ||
          rateRes?.status !== "success" ||
          spotUsedFallback,
      };
    });
  }, [boardStrikes, effectiveExpiry, feedReads.data, multiplier, spotPrice, spotUsedFallback]);

  return {
    expiries,
    selectedExpiry: effectiveExpiry,
    strikes,
    spotPrice,
    forwardPrice: strikes[0]?.forwardPrice ?? spotPrice,
    market,
    multiplier,
    isUnavailable: marketUnavailable,
    unavailableReason,
    // The board can price immediately with the documented feed fallbacks.
    // Keep those rows mounted while the multicall refreshes so periodic
    // repricing never swaps the board back to its initial skeleton.
    isLoading: strikes.length === 0 && (spotLoading || feedReads.isLoading),
  };
}
