import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Address, Hex } from "viem";

export const MARKET_IDS = ["BTC", "XAU", "SPY", "NVDA", "SPCX"] as const;
export type MarketId = (typeof MARKET_IDS)[number];
export type MarketKind = "crypto" | "equity" | "metal";
export type MarketHours = "24/7" | "24/5";
export const ORACLE_PROVIDERS = ["pyth", "chainlink"] as const;
export type OracleProvider = (typeof ORACLE_PROVIDERS)[number];

export interface MarketContracts {
  marketId: number;
  optionAsset: Address;
  baseAsset: Address;
  /** Live pricing adapter consumed by the SRM and RFQ readiness checks. */
  spotFeed: Address;
  /** Writable LyraSpotFeed paired with the signed forward feed. */
  signedSpotFeed: Address;
  forwardFeed: Address;
  volFeed: Address;
  rateFeed: Address;
  settlementFeed: Address;
  /** Provider-specific feed that permissionlessly fixes expiry settlement. */
  settlementFixingFeed?: Address;
  multiplierRegistry?: Address;
}

export interface MarketDefinition {
  id: MarketId;
  displayName: string;
  kind: MarketKind;
  enabled: boolean;
  collateral: {
    symbol: string;
    address: Address | null;
    decimals: number;
    scaledUi: boolean;
  };
  contracts: MarketContracts | null;
  oracleProvider: OracleProvider;
  pythPriceId: Hex | null;
  chainlinkAggregator: Address | null;
  marketHours: MarketHours;
  strikeIncrement: number;
  riskVolFloor: number;
  maxSize: string;
}

export interface MarketManifest {
  chainId: number;
  markets: MarketDefinition[];
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;

function marketManifestDirs(): string[] {
  const dirs: string[] = [];
  if (process.env.HEDGE_MARKETS_DIR) dirs.push(process.env.HEDGE_MARKETS_DIR);
  const starts = [dirname(fileURLToPath(import.meta.url)), process.cwd()];
  for (const start of starts) {
    let dir = resolve(start);
    for (let i = 0; i < 8; i++) {
      dirs.push(join(dir, "protocol", "deployments", "markets"));
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return dirs;
}

export function marketManifestPath(chainId: number): string | null {
  for (const dir of marketManifestDirs()) {
    const path = join(dir, `${chainId}.json`);
    if (existsSync(path)) return path;
  }
  return null;
}

function assertAddress(value: unknown, label: string): asserts value is Address {
  if (typeof value !== "string" || !ADDRESS_RE.test(value)) {
    throw new Error(`${label} must be a 0x address`);
  }
}

export function validateMarketManifest(input: unknown, expectedChainId?: number): MarketManifest {
  if (!input || typeof input !== "object") throw new Error("market manifest must be an object");
  const raw = input as { chainId?: unknown; markets?: unknown };
  if (!Number.isInteger(raw.chainId) || Number(raw.chainId) <= 0) {
    throw new Error("market manifest chainId must be a positive integer");
  }
  const chainId = Number(raw.chainId);
  if (expectedChainId !== undefined && chainId !== expectedChainId) {
    throw new Error(`market manifest chainId ${chainId} does not match ${expectedChainId}`);
  }
  if (!Array.isArray(raw.markets) || raw.markets.length === 0) {
    throw new Error("market manifest must contain markets");
  }

  const seen = new Set<string>();
  const markets = raw.markets.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`markets[${index}] must be an object`);
    const market = entry as MarketDefinition;
    if (!MARKET_IDS.includes(market.id)) throw new Error(`markets[${index}].id is unsupported`);
    if (seen.has(market.id)) throw new Error(`duplicate market id ${market.id}`);
    seen.add(market.id);
    if (!market.displayName?.trim()) throw new Error(`${market.id}.displayName is required`);
    if (!market.collateral || !market.collateral.symbol?.trim()) {
      throw new Error(`${market.id}.collateral is required`);
    }
    if (!Number.isInteger(market.collateral.decimals) || market.collateral.decimals < 0 || market.collateral.decimals > 36) {
      throw new Error(`${market.id}.collateral.decimals is invalid`);
    }
    if (market.collateral.address !== null) {
      assertAddress(market.collateral.address, `${market.id}.collateral.address`);
      if (/^0x0{40}$/i.test(market.collateral.address)) {
        throw new Error(`${market.id}.collateral.address is zero`);
      }
    }
    if (!(market.strikeIncrement > 0)) throw new Error(`${market.id}.strikeIncrement must be positive`);
    if (!(market.riskVolFloor > 0)) throw new Error(`${market.id}.riskVolFloor must be positive`);
    if (!/^\d+(\.\d+)?$/.test(market.maxSize) || Number(market.maxSize) <= 0) {
      throw new Error(`${market.id}.maxSize must be a positive decimal`);
    }
    if (market.pythPriceId !== null && !BYTES32_RE.test(market.pythPriceId)) {
      throw new Error(`${market.id}.pythPriceId must be bytes32`);
    }
    if (market.pythPriceId !== null && /^0x0{64}$/i.test(market.pythPriceId)) {
      throw new Error(`${market.id}.pythPriceId is zero`);
    }
    const oracleProvider = market.oracleProvider ?? "pyth";
    if (!ORACLE_PROVIDERS.includes(oracleProvider)) {
      throw new Error(`${market.id}.oracleProvider must be pyth or chainlink`);
    }
    const chainlinkAggregator = market.chainlinkAggregator ?? null;
    if (chainlinkAggregator !== null) {
      assertAddress(chainlinkAggregator, `${market.id}.chainlinkAggregator`);
      if (/^0x0{40}$/i.test(chainlinkAggregator)) {
        throw new Error(`${market.id}.chainlinkAggregator is zero`);
      }
    }
    if (market.enabled) {
      if (!market.contracts) throw new Error(`${market.id} is enabled without contracts`);
      if (!market.collateral.address) throw new Error(`${market.id} is enabled without collateral address`);
      for (const [key, value] of Object.entries(market.contracts)) {
        if (key === "marketId") {
          if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(`${market.id}.contracts.marketId is invalid`);
        } else {
          assertAddress(value, `${market.id}.contracts.${key}`);
          if (/^0x0{40}$/i.test(value)) throw new Error(`${market.id}.contracts.${key} is zero`);
        }
      }
      if (oracleProvider === "pyth" && !market.pythPriceId) {
        throw new Error(`${market.id} is enabled without a Pyth price id`);
      }
      if (oracleProvider === "chainlink" && !chainlinkAggregator) {
        throw new Error(`${market.id} is enabled without a Chainlink aggregator`);
      }
      if (oracleProvider === "chainlink" && !market.contracts.settlementFixingFeed) {
        throw new Error(`${market.id} is enabled without a Chainlink settlement fixing feed`);
      }
      if (market.collateral.scaledUi && !market.contracts.multiplierRegistry) {
        throw new Error(`${market.id} is scaled but has no multiplier registry`);
      }
    }
    return { ...market, oracleProvider, chainlinkAggregator };
  });
  return { chainId, markets };
}

export function readMarketManifest(chainId: number): MarketManifest {
  const path = marketManifestPath(chainId);
  if (!path) throw new Error(`No market manifest for chain ${chainId}`);
  return validateMarketManifest(JSON.parse(readFileSync(path, "utf8")), chainId);
}

export function enabledMarkets(manifest: MarketManifest): MarketDefinition[] {
  return manifest.markets.filter((market) => market.enabled && market.contracts !== null);
}

export function marketById(manifest: MarketManifest, id: string): MarketDefinition | undefined {
  return manifest.markets.find((market) => market.id === id.toUpperCase());
}
