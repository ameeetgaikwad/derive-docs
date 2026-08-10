import type { Address, Hex } from "viem";
import markets56 from "../../../../../protocol/deployments/markets/56.json";
import markets97 from "../../../../../protocol/deployments/markets/97.json";
import type { AppChainId } from "@/stores/network";

export type MarketId = "BTC" | "XAU" | "SPY" | "NVDA" | "SPCX";

export interface AppMarket {
  id: MarketId;
  displayName: string;
  kind: "crypto" | "equity" | "metal";
  enabled: boolean;
  collateral: {
    symbol: string;
    address: Address | null;
    decimals: number;
    scaledUi: boolean;
  };
  contracts: {
    marketId: number;
    optionAsset: Address;
    baseAsset: Address;
    spotFeed: Address;
    forwardFeed: Address;
    volFeed: Address;
    rateFeed: Address;
    settlementFeed: Address;
    multiplierRegistry?: Address;
  } | null;
  pythPriceId: Hex | null;
  marketHours: "24/7" | "24/5";
  strikeIncrement: number;
  riskVolFloor: number;
  maxSize: string;
}

const RAW = { 56: markets56, 97: markets97 } as const;
const HIDDEN_MARKET_IDS = new Set<MarketId>(["SPCX"]);

function normalize(raw: (typeof RAW)[AppChainId]): AppMarket[] {
  return raw.markets as unknown as AppMarket[];
}

export function getMarkets(chainId: AppChainId): AppMarket[] {
  return normalize(RAW[chainId]);
}

/** Markets intentionally exposed in the contract browser. */
export function getSelectableMarkets(chainId: AppChainId): AppMarket[] {
  return getMarkets(chainId).filter((market) => !HIDDEN_MARKET_IDS.has(market.id));
}

export function getMarket(chainId: AppChainId, marketId: MarketId): AppMarket {
  const market = getMarkets(chainId).find((candidate) => candidate.id === marketId);
  if (!market) throw new Error(`Unknown market ${marketId} on chain ${chainId}`);
  return market;
}

/** UI amount = raw token amount × multiplier / 1e18. */
export function rawToUiAmount(rawAmount: number, multiplier: bigint | null): number {
  return multiplier === null ? rawAmount : rawAmount * Number(multiplier) / 1e18;
}

export function uiToRawAmount(uiAmount: number, multiplier: bigint | null): number {
  if (multiplier === null) return uiAmount;
  const value = Number(multiplier) / 1e18;
  if (!(value > 0)) throw new Error("Invalid bStock UI multiplier");
  return uiAmount / value;
}

export function uiAmount18ToRaw18(uiAmount18: bigint, multiplier: bigint | null): bigint {
  return multiplier === null ? uiAmount18 : (uiAmount18 * 10n ** 18n + multiplier - 1n) / multiplier;
}

export function rawAmount18ToUi18(rawAmount18: bigint, multiplier: bigint | null): bigint {
  return multiplier === null ? rawAmount18 : rawAmount18 * multiplier / 10n ** 18n;
}

export function rawPrice18ToUi18(rawPrice18: bigint, multiplier: bigint | null): bigint {
  return multiplier === null ? rawPrice18 : rawPrice18 * 10n ** 18n / multiplier;
}

export function tokenAmountTo18(amount: bigint, decimals: number): bigint {
  return decimals === 18
    ? amount
    : decimals < 18
      ? amount * 10n ** BigInt(18 - decimals)
      : amount / 10n ** BigInt(decimals - 18);
}

export function amount18ToToken(amount: bigint, decimals: number): bigint {
  if (decimals === 18) return amount;
  if (decimals > 18) return amount * 10n ** BigInt(decimals - 18);
  const divisor = 10n ** BigInt(18 - decimals);
  return (amount + divisor - 1n) / divisor;
}
