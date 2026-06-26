"use client";

import { useMemo } from "react";
import type { ContractFunctionParameters } from "viem";
import { useReadContracts } from "wagmi";
import {
  lyraForwardFeedAbi,
  lyraRateFeedAbi,
  lyraVolFeedAbi,
} from "@/lib/protocol/abis";
import { ADDRESSES } from "@/lib/protocol/deployments";
import {
  formatExpiryLabel,
  strikesForExpiry,
  weeklyExpiries,
  type BoardStrike,
  type TargetDirection,
} from "@/lib/protocol/board";
import { black76Price, yearsToExpiry } from "@/lib/protocol/black76";
import { calculateAPR, daysToExpiry } from "@/lib/protocol/apr";
import { unitToNumber } from "@/lib/protocol/units";
import { useSpotPrice } from "./useSpotPrice";

/** Fallbacks when an expiry has no posted feed data yet (testnet reality). */
const DEFAULT_IV = 0.6;
const DEFAULT_RATE = 0.05;
const DEFAULT_SPOT_PRICE = 60_000;

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
  /** true when feed reads failed and defaults were used */
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
  direction: TargetDirection = "sell_high"
) {
  const { spotPrice: oracleSpotPrice, isLoading: spotLoading, isStale } = useSpotPrice();
  const spotPrice = oracleSpotPrice > 0 ? oracleSpotPrice : DEFAULT_SPOT_PRICE;
  const usedSpotFallback = oracleSpotPrice <= 0;

  const expiries = useMemo<ExpiryInfo[]>(
    () =>
      weeklyExpiries(4).map((epoch) => ({
        epoch,
        label: formatExpiryLabel(epoch),
      })),
    []
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
        ? strikesForExpiry(spotPrice, effectiveExpiry, direction)
        : [],
    [direction, effectiveExpiry, spotPrice]
  );

  // Heterogeneous batch (multicall): [forward, rate, vol per strike].
  const feedContracts = useMemo<ContractFunctionParameters[]>(() => {
    if (effectiveExpiry === null || boardStrikes.length === 0) return [];
    return [
      {
        abi: lyraForwardFeedAbi,
        address: ADDRESSES.btcForwardFeed,
        functionName: "getForwardPrice",
        args: [BigInt(effectiveExpiry)],
      },
      {
        abi: lyraRateFeedAbi,
        address: ADDRESSES.btcRateFeed,
        functionName: "getInterestRate",
        args: [BigInt(effectiveExpiry)],
      },
      ...boardStrikes.map((s) => ({
        abi: lyraVolFeedAbi,
        address: ADDRESSES.btcVolFeed,
        functionName: "getVol",
        args: [s.strike18, BigInt(s.expiry)],
      })),
    ];
  }, [effectiveExpiry, boardStrikes]);

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

    const forward =
      forwardRes?.status === "success"
        ? unitToNumber((forwardRes.result as readonly [bigint, bigint])[0])
        : spotPrice;
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
        usedFallback: !volOk || forwardRes?.status !== "success",
      };
    });
  }, [boardStrikes, effectiveExpiry, feedReads.data, spotPrice]);

  return {
    expiries,
    selectedExpiry: effectiveExpiry,
    strikes,
    spotPrice,
    usedSpotFallback,
    spotError: isStale,
    isLoading:
      (spotLoading && !usedSpotFallback) ||
      (boardStrikes.length > 0 && feedReads.isLoading),
  };
}
