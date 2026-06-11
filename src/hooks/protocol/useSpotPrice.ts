"use client";

import { useReadContract } from "wagmi";
import { lyraSpotFeedAbi } from "@/lib/protocol/abis";
import { ADDRESSES, CHAIN_ID } from "@/lib/protocol/deployments";
import { unitToNumber } from "@/lib/protocol/units";

/**
 * BTC spot price read on-chain from our LyraSpotFeed (posted by
 * services/oracle-feeds). Returns USD as a float for display/pricing.
 */
export function useSpotPrice() {
  const query = useReadContract({
    abi: lyraSpotFeedAbi,
    address: ADDRESSES.btcSpotFeed,
    functionName: "getSpot",
    chainId: CHAIN_ID,
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
