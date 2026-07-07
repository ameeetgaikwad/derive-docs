"use client";

import { useReadContract } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { lyraSpotFeedAbi } from "@/lib/protocol/abis";
import { unitToNumber } from "@/lib/protocol/units";
import { useNetwork } from "./useNetwork";

/** Hermes (Pyth) public price endpoint — display-only fallback. */
const HERMES_URL = "https://hermes.pyth.network/v2/updates/price/latest";

async function fetchHermesSpot(priceId: string): Promise<number> {
  const id = priceId.startsWith("0x") ? priceId.slice(2) : priceId;
  const res = await fetch(`${HERMES_URL}?ids[]=${id}`);
  if (!res.ok) throw new Error(`hermes ${res.status}`);
  const body = (await res.json()) as {
    parsed?: { price: { price: string; expo: number } }[];
  };
  const p = body.parsed?.[0]?.price;
  if (!p) throw new Error("hermes: no price");
  return Number(p.price) * 10 ** p.expo;
}

/**
 * BTC spot for display + indicative pricing. Resilient by design so the board
 * always shows a price:
 *   1. on-chain Pyth adapter (`btcPythSpotFeed`) — the feed the protocol uses,
 *      refreshed continuously by oracle-feeds; falls back to the signed
 *      LyraSpotFeed (`btcSpotFeed`) if the adapter isn't deployed on a chain.
 *   2. if the on-chain read reverts (feed momentarily stale), the Pyth Hermes
 *      REST price — the same source, fetched off-chain — labelled `indicative`.
 * Executable pricing always comes from the RFQ auction, never this value.
 */
export function useSpotPrice() {
  const { addresses, chainId } = useNetwork();
  const onchainFeed = addresses.btcPythSpotFeed ?? addresses.btcSpotFeed;

  const onchain = useReadContract({
    abi: lyraSpotFeedAbi,
    address: onchainFeed,
    functionName: "getSpot",
    chainId,
    query: { refetchInterval: 15_000, retry: false },
  });

  const onchainOk = !!onchain.data && onchain.data[0] > 0n;
  const onchainSpot = onchainOk ? unitToNumber(onchain.data![0]) : 0;

  // Off-chain display fallback: only when the on-chain read failed and a price id exists.
  const priceId = addresses.btcPythPriceId;
  const hermes = useQuery({
    queryKey: ["hermes-spot", priceId, chainId],
    queryFn: () => fetchHermesSpot(priceId as string),
    enabled: !onchainOk && onchain.isError && !!priceId,
    refetchInterval: 20_000,
    retry: 1,
    staleTime: 15_000,
  });

  const usingFallback = !onchainOk && !!hermes.data;
  const spotPrice = onchainOk ? onchainSpot : usingFallback ? hermes.data! : 0;

  return {
    spotPrice,
    /** true when the on-chain feed was stale and we're showing the Hermes price */
    indicative: usingFallback,
    isLoading: onchain.isLoading || (onchain.isError && hermes.isLoading),
    isStale: onchain.isError && !usingFallback,
    error: onchain.error,
  };
}
