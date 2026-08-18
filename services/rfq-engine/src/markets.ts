import {
  lyraForwardFeedAbi,
  lyraRateFeedAbi,
  lyraSpotFeedAbi,
  lyraVolFeedAbi,
  isRwaMarketOpen,
  rwaExpiries,
  toUnit,
  type MarketDefinition,
} from "@hedge/shared";
export { isUsEarlyCloseSession, isUsExchangeHoliday, rwaExpiries } from "@hedge/shared";
import type { PublicClient } from "viem";

export interface PublicMarketStatus {
  id: string;
  displayName: string;
  collateralSymbol: string;
  collateralDecimals: number;
  scaledUi: boolean;
  enabled: boolean;
  status: "open" | "closed" | "disabled";
  disableReason: string | null;
  feedUpdatedAt: number | null;
  supportedExpiries: number[];
}

/** 24/5 means open for the full Monday-Friday New York calendar days. */
export function isMarketOpen(market: MarketDefinition, nowMs = Date.now()): boolean {
  if (!market.enabled || !market.contracts) return false;
  if (market.marketHours === "24/7") return true;
  return isRwaMarketOpen(nowMs);
}

export function marketStatus(market: MarketDefinition, nowMs = Date.now()): PublicMarketStatus {
  const enabled = market.enabled && market.contracts !== null;
  const open = isMarketOpen(market, nowMs);
  return {
    id: market.id,
    displayName: market.displayName,
    collateralSymbol: market.collateral.symbol,
    collateralDecimals: market.collateral.decimals,
    scaledUi: market.collateral.scaledUi,
    enabled,
    status: !enabled ? "disabled" : open ? "open" : "closed",
    disableReason: !enabled ? "Market deployment is staged but not enabled" : open ? null : "Market is closed for the weekend",
    feedUpdatedAt: null,
    supportedExpiries: market.marketHours === "24/7" ? [] : rwaExpiries(4, nowMs),
  };
}

export function assertMarketTradeable(
  market: MarketDefinition,
  amount: bigint,
  expiry: bigint,
  nowMs = Date.now(),
): void {
  if (!market.enabled || !market.contracts) throw new Error(`${market.id} market is disabled`);
  if (!isMarketOpen(market, nowMs)) throw new Error(`${market.id} market is closed`);
  // Unscaled option amounts and UI amounts are identical. Scaled bStock RFQs
  // carry the canonical raw amount, so their UI cap is checked against the
  // live/checkpointed multiplier in assertMarketFeedsReady below.
  if (!market.collateral.scaledUi && amount > toUnit(market.maxSize)) {
    throw new Error(`amount exceeds ${market.id} maximum size ${market.maxSize}`);
  }
  if (market.marketHours === "24/5") {
    const supported = rwaExpiries(8, nowMs);
    if (!supported.includes(Number(expiry))) throw new Error(`${market.id} expiry is not supported`);
  }
}

const multiplierRegistryAbi = [{
  type: "function",
  name: "multiplierAt",
  stateMutability: "view",
  inputs: [{ type: "uint64" }],
  outputs: [{ type: "uint256" }],
}] as const;

const scaledTokenAbi = [
  { type: "function", name: "uiMultiplier", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "newUIMultiplier", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "effectiveAt", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const scaledSpotFeedAbi = [{
  type: "function", name: "uiSpotFeed", stateMutability: "view", inputs: [], outputs: [{ type: "address" }],
}] as const;

const pythSpotAdapterAbi = [
  { type: "function", name: "pyth", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "priceId", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
] as const;

const pythPriceAbi = [{
  type: "function", name: "getPriceUnsafe", stateMutability: "view",
  inputs: [{ type: "bytes32" }],
  outputs: [{
    type: "tuple",
    components: [
      { name: "price", type: "int64" },
      { name: "conf", type: "uint64" },
      { name: "expo", type: "int32" },
      { name: "publishTime", type: "uint256" },
    ],
  }],
}] as const;

const chainlinkSpotAdapterAbi = [{
  type: "function",
  name: "aggregator",
  stateMutability: "view",
  inputs: [],
  outputs: [{ type: "address" }],
}] as const;

const chainlinkAggregatorAbi = [{
  type: "function",
  name: "latestRoundData",
  stateMutability: "view",
  inputs: [],
  outputs: [
    { name: "roundId", type: "uint80" },
    { name: "answer", type: "int256" },
    { name: "startedAt", type: "uint256" },
    { name: "updatedAt", type: "uint256" },
    { name: "answeredInRound", type: "uint80" },
  ],
}] as const;

/** Latest publish timestamp from the market's selected external oracle. */
export async function marketFeedUpdatedAt(
  client: PublicClient,
  market: MarketDefinition,
): Promise<number> {
  if (!market.contracts) throw new Error(`${market.id} market has no deployed feeds`);
  const adapter = market.collateral.scaledUi
    ? await client.readContract({
        address: market.contracts.spotFeed,
        abi: scaledSpotFeedAbi,
        functionName: "uiSpotFeed",
    })
    : market.contracts.spotFeed;
  if (market.oracleProvider === "chainlink") {
    const aggregator = await client.readContract({
      address: adapter,
      abi: chainlinkSpotAdapterAbi,
      functionName: "aggregator",
    });
    const [, , , updatedAt] = await client.readContract({
      address: aggregator,
      abi: chainlinkAggregatorAbi,
      functionName: "latestRoundData",
    });
    return Number(updatedAt);
  }
  const [pyth, priceId] = await Promise.all([
    client.readContract({ address: adapter, abi: pythSpotAdapterAbi, functionName: "pyth" }),
    client.readContract({ address: adapter, abi: pythSpotAdapterAbi, functionName: "priceId" }),
  ]);
  const price = await client.readContract({
    address: pyth,
    abi: pythPriceAbi,
    functionName: "getPriceUnsafe",
    args: [priceId],
  });
  return Number(price.publishTime);
}

/**
 * Production RFQs fail closed before opening when any required market feed is
 * stale/missing or a BEP-8056 corporate action is not checkpointed on-chain.
 */
export async function assertMarketFeedsReady(
  client: PublicClient,
  market: MarketDefinition,
  expiry: bigint,
  strike: bigint,
  rawAmount?: bigint,
): Promise<void> {
  if (!market.enabled || !market.contracts) throw new Error(`${market.id} market is disabled`);
  try {
    await Promise.all([
      client.readContract({
        address: market.contracts.spotFeed,
        abi: lyraSpotFeedAbi,
        functionName: "getSpot",
      }),
      client.readContract({
        address: market.contracts.forwardFeed,
        abi: lyraForwardFeedAbi,
        functionName: "getForwardPrice",
        args: [expiry],
      }),
      client.readContract({
        address: market.contracts.volFeed,
        abi: lyraVolFeedAbi,
        functionName: "getVol",
        args: [strike, expiry],
      }),
      client.readContract({
        address: market.contracts.rateFeed,
        abi: lyraRateFeedAbi,
        functionName: "getInterestRate",
        args: [expiry],
      }),
    ]);

    if (market.collateral.scaledUi) {
      const registry = market.contracts.multiplierRegistry;
      const token = market.collateral.address;
      if (!registry || !token) throw new Error("scaled market configuration is incomplete");
      const block = await client.getBlock();
      const [current, checkpointed, pending, effectiveAt] = await Promise.all([
        client.readContract({ address: token, abi: scaledTokenAbi, functionName: "uiMultiplier" }),
        client.readContract({ address: registry, abi: multiplierRegistryAbi, functionName: "multiplierAt", args: [block.timestamp] }),
        client.readContract({ address: token, abi: scaledTokenAbi, functionName: "newUIMultiplier" }),
        client.readContract({ address: token, abi: scaledTokenAbi, functionName: "effectiveAt" }),
      ]);
      if (current !== checkpointed) throw new Error("current multiplier is not checkpointed");
      if (rawAmount !== undefined) {
        // ERC-8056: displayed amount = raw amount * multiplier / 1e18. Use
        // multiplication for the comparison so truncation can never admit an
        // order fractionally above the reviewed UI cap.
        const maximumUiAmount = toUnit(market.maxSize);
        if (rawAmount * current > maximumUiAmount * 10n ** 18n) {
          throw new Error(`amount exceeds ${market.id} maximum size ${market.maxSize}`);
        }
      }
      if (pending > 0n && effectiveAt > block.timestamp) {
        const scheduled = await client.readContract({
          address: registry,
          abi: multiplierRegistryAbi,
          functionName: "multiplierAt",
          args: [effectiveAt],
        });
        if (scheduled !== pending) throw new Error("scheduled multiplier is not checkpointed");
      }
    }
  } catch (error) {
    throw new Error(`${market.id} market is not ready: ${error instanceof Error ? error.message : String(error)}`);
  }
}
