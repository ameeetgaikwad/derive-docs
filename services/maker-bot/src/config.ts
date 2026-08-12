import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Hex } from "viem";
import { DEFAULT_RPC_URL, MARKET_IDS, getChainId, getRpcUrl } from "@hedge/shared";

export interface MakerBotConfig {
  chainId: number;
  rpcUrl: string;
  /** rfq-engine maker WS endpoint. */
  wsUrl: string;
  /** Bid = bidRatio * theo when the maker BUYS (trade amount > 0). Default 0.95. */
  bidRatio: number;
  /** Ask = askRatio * theo when the maker SELLS (trade amount < 0). Default 1.05. */
  askRatio: number;
  /** Max matching fee the maker signs for, 18dp decimal string. Default "0". */
  maxFee: string;
  /** USDT (token-native units, decimal string) to deposit during --setup. */
  depositUsdt: string;
  /** Explicit subaccount id (overrides the state file). */
  subaccountId: bigint | null;
  /** Where setup persists / run reads the maker subaccount id. */
  stateFile: string;
  /** Pricing overrides — when set, on-chain feeds are not queried. */
  forwardOverride: number | null;
  spotOverride: number | null;
  ivOverride: number | null;
  rate: number;
  /** Signed quote validity in seconds. Default 300. */
  quoteTtlSec: number;
  /** Price vol off the live Deribit surface (DERIBIT_VOL=true), falling back to on-chain. */
  deribitVol: boolean;
  /** Per-market spread overrides, e.g. MAKER_BID_RATIO_NVDA. */
  marketBidRatios: Record<string, number>;
  marketAskRatios: Record<string, number>;
  /** Per-market static pricing overrides; global overrides remain BTC-only for compatibility. */
  marketForwardOverrides: Record<string, number | null>;
  marketSpotOverrides: Record<string, number | null>;
  marketIvOverrides: Record<string, number | null>;
  marketRates: Record<string, number>;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`env ${name} is not a number: ${v}`);
  return n;
}

function optNum(name: string): number | null {
  const v = process.env[name];
  if (v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`env ${name} is not a number: ${v}`);
  return n;
}

export function loadConfig(): MakerBotConfig {
  const chainId = getChainId();
  const defaultBid = num("MAKER_BID_RATIO", 0.95);
  const defaultAsk = num("MAKER_ASK_RATIO", 1.05);
  const defaultRate = num("RATE", 0);
  return {
    chainId,
    rpcUrl: getRpcUrl() ?? DEFAULT_RPC_URL,
    wsUrl: process.env.RFQ_ENGINE_WS ?? "ws://127.0.0.1:3030/maker",
    bidRatio: defaultBid,
    askRatio: defaultAsk,
    maxFee: process.env.MAKER_MAX_FEE ?? "0",
    depositUsdt: process.env.DEPOSIT_USDT ?? "100000",
    subaccountId: process.env.MAKER_SUBACCOUNT_ID
      ? BigInt(process.env.MAKER_SUBACCOUNT_ID)
      : null,
    stateFile: process.env.MAKER_STATE_FILE ?? `maker-state.${chainId}.json`,
    forwardOverride: optNum("FORWARD_PRICE"),
    spotOverride: optNum("SPOT_PRICE"),
    ivOverride: optNum("IV"),
    rate: defaultRate,
    quoteTtlSec: num("QUOTE_TTL_SEC", 300),
    deribitVol: (process.env.DERIBIT_VOL ?? "").toLowerCase() === "true",
    marketBidRatios: Object.fromEntries(MARKET_IDS.map((id) => [id, num(`MAKER_BID_RATIO_${id}`, defaultBid)])),
    marketAskRatios: Object.fromEntries(MARKET_IDS.map((id) => [id, num(`MAKER_ASK_RATIO_${id}`, defaultAsk)])),
    marketForwardOverrides: Object.fromEntries(MARKET_IDS.map((id) => [id, optNum(`FORWARD_PRICE_${id}`)])),
    marketSpotOverrides: Object.fromEntries(MARKET_IDS.map((id) => [id, optNum(`SPOT_PRICE_${id}`)])),
    marketIvOverrides: Object.fromEntries(MARKET_IDS.map((id) => [id, optNum(`IV_${id}`)])),
    marketRates: Object.fromEntries(MARKET_IDS.map((id) => [id, num(`RATE_${id}`, defaultRate)])),
  };
}

/** PRIVATE_KEY env -> viem account. Required for signing/setup. */
export function loadAccount(): PrivateKeyAccount {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY env var is required");
  const hex = (pk.startsWith("0x") ? pk : `0x${pk}`) as Hex;
  return privateKeyToAccount(hex);
}
