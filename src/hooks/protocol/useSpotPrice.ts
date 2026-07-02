"use client";

import { useReadContract } from "wagmi";
import { lyraSpotFeedAbi } from "@/lib/protocol/abis";
import { unitToNumber } from "@/lib/protocol/units";
import { useNetwork } from "./useNetwork";

/**
 * BTC spot price read on-chain from our LyraSpotFeed (posted by
 * services/oracle-feeds). Returns USD as a float for display/pricing.
 */
export function useSpotPrice() {
  const { addresses, chainId } = useNetwork();
  const query = useReadContract({
    abi: lyraSpotFeedAbi,
    address: addresses.btcSpotFeed,
    functionName: "getSpot",
    chainId,
    query: { refetchInterval: 15_000 },
  });

  const spotPrice = query.data ? unitToNumber(query.data[0]) : 0;

  return {
    spotPrice,
    isLoading: query.isLoading,
    /** getSpot reverts when the feed is stale (heartbeat exceeded) or unposted */
    isStale: query.isError,
    error: query.error,
  };
}
