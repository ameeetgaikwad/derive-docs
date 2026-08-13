import { renameSync, writeFileSync } from "node:fs";
import { getAddress, type Address, type Hex } from "viem";
import {
  validateMarketManifest,
  type MarketDefinition,
  type MarketId,
  type MarketManifest,
} from "@hedge/shared";

export const RWA_MARKET_IDS = ["XAU", "SPY", "NVDA", "SPCX"] as const;
export type RwaMarketId = (typeof RWA_MARKET_IDS)[number];
export const SUPPORTED_RWA_MARKET_IDS = ["XAU", "SPY", "NVDA"] as const satisfies readonly RwaMarketId[];

export const TOKEN_ENV_BY_MARKET: Record<RwaMarketId, string> = {
  XAU: "XAUT_ADDRESS",
  SPY: "SPYB_ADDRESS",
  NVDA: "NVDAB_ADDRESS",
  SPCX: "SPCXB_ADDRESS",
};

export const MOCK_KEY_BY_MARKET: Record<RwaMarketId, keyof RwaMocksFile> = {
  XAU: "xaut",
  SPY: "spyb",
  NVDA: "nvdab",
  SPCX: "spcxb",
};

export interface RwaMocksFile {
  chainId: number;
  xaut: Address;
  spyb: Address;
  nvdab: Address;
  spcxb: Address;
}

export interface AddMarketSidecar {
  chainId: number;
  name: string;
  marketId: number;
  underlying: Address;
  spotFeed: Address;
  forwardFeed: Address;
  volFeed: Address;
  rateFeed: Address;
  settlementFeed: Address;
  liveSettlementFeed: Address;
  pythSpotFeed: Address;
  scaledSpotFeed: Address;
  multiplierRegistry: Address;
  benchmarkSettlementFeed: Address;
  liveSpotFeed: Address;
  optionAsset: Address;
  pythPriceId: Hex;
  baseAsset: Address;
  underlyingDecimals: number;
  scaledUi: boolean;
}

export interface ManifestFile extends MarketManifest {
  marketCount: number;
}

export function isRwaMarketId(value: string): value is RwaMarketId {
  return RWA_MARKET_IDS.includes(value.toUpperCase() as RwaMarketId);
}

export function parseDeployMarkets(values: string[]): RwaMarketId[] {
  if (values.length === 0) return [...SUPPORTED_RWA_MARKET_IDS];
  const parsed = values.flatMap((value) => value.split(","))
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  const result: RwaMarketId[] = [];
  for (const value of parsed) {
    if (!isRwaMarketId(value)) {
      throw new Error(`unsupported RWA market ${value}; expected ${RWA_MARKET_IDS.join(", ")}`);
    }
    if (!result.includes(value)) result.push(value);
  }
  return result;
}

export function requireRwaMarket(value: string | undefined): RwaMarketId {
  const normalized = value?.trim().toUpperCase();
  if (!normalized || !isRwaMarketId(normalized)) {
    throw new Error(`--market must be one of ${RWA_MARKET_IDS.join(", ")}`);
  }
  return normalized;
}

function address(value: unknown, label: string): Address {
  if (typeof value !== "string") throw new Error(`${label} must be an address`);
  try {
    return getAddress(value);
  } catch {
    throw new Error(`${label} must be an address`);
  }
}

function nonZeroAddress(value: unknown, label: string): Address {
  const parsed = address(value, label);
  if (/^0x0{40}$/i.test(parsed)) throw new Error(`${label} must not be zero`);
  return parsed;
}

function bytes32(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0{64}$/i.test(value)) {
    throw new Error(`${label} must be a non-zero bytes32`);
  }
  return value as Hex;
}

export function parseMocksFile(input: unknown): RwaMocksFile {
  if (!input || typeof input !== "object") throw new Error("RWA mocks file must be an object");
  const raw = input as Record<string, unknown>;
  if (Number(raw.chainId) !== 97) throw new Error("RWA mocks file must target chain 97");
  return {
    chainId: 97,
    xaut: nonZeroAddress(raw.xaut, "rwaMocks.xaut"),
    spyb: nonZeroAddress(raw.spyb, "rwaMocks.spyb"),
    nvdab: nonZeroAddress(raw.nvdab, "rwaMocks.nvdab"),
    spcxb: nonZeroAddress(raw.spcxb, "rwaMocks.spcxb"),
  };
}

export function parseAddMarketSidecar(
  input: unknown,
  expected: RwaMarketId,
  expectedChainId = 97,
): AddMarketSidecar {
  if (!input || typeof input !== "object") throw new Error(`${expected} sidecar must be an object`);
  const raw = input as Record<string, unknown>;
  if (Number(raw.chainId) !== expectedChainId) {
    throw new Error(`${expected} sidecar must target chain ${expectedChainId}`);
  }
  if (raw.name !== expected) throw new Error(`${expected} sidecar name mismatch`);
  const marketId = Number(raw.marketId);
  if (!Number.isSafeInteger(marketId) || marketId <= 0) {
    throw new Error(`${expected} sidecar marketId is invalid`);
  }
  return {
    chainId: expectedChainId,
    name: expected,
    marketId,
    underlying: nonZeroAddress(raw.underlying, `${expected}.underlying`),
    spotFeed: nonZeroAddress(raw.spotFeed, `${expected}.spotFeed`),
    forwardFeed: nonZeroAddress(raw.forwardFeed, `${expected}.forwardFeed`),
    volFeed: nonZeroAddress(raw.volFeed, `${expected}.volFeed`),
    rateFeed: nonZeroAddress(raw.rateFeed, `${expected}.rateFeed`),
    settlementFeed: address(raw.settlementFeed, `${expected}.settlementFeed`),
    liveSettlementFeed: nonZeroAddress(raw.liveSettlementFeed, `${expected}.liveSettlementFeed`),
    pythSpotFeed: nonZeroAddress(raw.pythSpotFeed, `${expected}.pythSpotFeed`),
    scaledSpotFeed: address(raw.scaledSpotFeed, `${expected}.scaledSpotFeed`),
    multiplierRegistry: address(raw.multiplierRegistry, `${expected}.multiplierRegistry`),
    benchmarkSettlementFeed: nonZeroAddress(
      raw.benchmarkSettlementFeed,
      `${expected}.benchmarkSettlementFeed`,
    ),
    liveSpotFeed: nonZeroAddress(raw.liveSpotFeed, `${expected}.liveSpotFeed`),
    optionAsset: nonZeroAddress(raw.optionAsset, `${expected}.optionAsset`),
    pythPriceId: bytes32(raw.pythPriceId, `${expected}.pythPriceId`),
    baseAsset: nonZeroAddress(raw.baseAsset, `${expected}.baseAsset`),
    underlyingDecimals: Number(raw.underlyingDecimals),
    scaledUi: Boolean(raw.scaledUi),
  };
}

export function parseManifestFile(input: unknown, expectedChainId = 97): ManifestFile {
  const manifest = validateMarketManifest(input, expectedChainId);
  return { ...manifest, marketCount: manifest.markets.length };
}

export function mergeSidecarIntoManifest(
  manifest: ManifestFile,
  marketId: RwaMarketId,
  sidecar: AddMarketSidecar,
): ManifestFile {
  const market = manifest.markets.find((candidate) => candidate.id === marketId);
  if (!market) throw new Error(`${marketId} is missing from the chain-97 manifest`);
  if (market.collateral.decimals !== sidecar.underlyingDecimals) {
    throw new Error(`${marketId} sidecar collateral decimals mismatch`);
  }
  if (market.collateral.scaledUi !== sidecar.scaledUi) {
    throw new Error(`${marketId} sidecar scaledUi mismatch`);
  }
  if (market.collateral.scaledUi && /^0x0{40}$/i.test(sidecar.multiplierRegistry)) {
    throw new Error(`${marketId} sidecar is missing a multiplier registry`);
  }

  const replacement: MarketDefinition = {
    ...market,
    enabled: false,
    collateral: { ...market.collateral, address: sidecar.underlying },
    contracts: {
      marketId: sidecar.marketId,
      optionAsset: sidecar.optionAsset,
      baseAsset: sidecar.baseAsset,
      spotFeed: sidecar.liveSpotFeed,
      signedSpotFeed: sidecar.spotFeed,
      forwardFeed: sidecar.forwardFeed,
      volFeed: sidecar.volFeed,
      rateFeed: sidecar.rateFeed,
      settlementFeed: sidecar.liveSettlementFeed,
      ...(market.collateral.scaledUi
        ? { multiplierRegistry: sidecar.multiplierRegistry }
        : {}),
    },
    pythPriceId: sidecar.pythPriceId,
  };

  const next: ManifestFile = {
    chainId: manifest.chainId,
    marketCount: manifest.markets.length,
    markets: manifest.markets.map((candidate) => candidate.id === marketId ? replacement : candidate),
  };
  validateMarketManifest(next, manifest.chainId);
  return next;
}

export function setManifestMarketEnabled(
  manifest: ManifestFile,
  marketId: RwaMarketId,
  enabled: boolean,
): ManifestFile {
  const market = manifest.markets.find((candidate) => candidate.id === marketId);
  if (!market) throw new Error(`${marketId} is missing from the chain-97 manifest`);
  if (enabled && (!market.contracts || !market.collateral.address || !market.pythPriceId)) {
    throw new Error(`${marketId} has not been fully deployed and cannot be enabled`);
  }
  const next: ManifestFile = {
    chainId: manifest.chainId,
    marketCount: manifest.markets.length,
    markets: manifest.markets.map((candidate) =>
      candidate.id === marketId ? { ...candidate, enabled } : candidate
    ),
  };
  validateMarketManifest(next, manifest.chainId);
  return next;
}

export function writeJsonAtomic(path: string, value: unknown): void {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644 });
  renameSync(temporary, path);
}

export function marketFromManifest(
  manifest: ManifestFile,
  marketId: RwaMarketId,
): MarketDefinition {
  const market = manifest.markets.find((candidate) => candidate.id === marketId);
  if (!market) throw new Error(`${marketId} is missing from the chain-97 manifest`);
  return market;
}

export function priceIdForMarket(
  manifest: ManifestFile,
  marketId: RwaMarketId,
  env: NodeJS.ProcessEnv = process.env,
): Hex {
  const configured = env[`${marketId}_PYTH_PRICE_ID`] ?? marketFromManifest(manifest, marketId).pythPriceId;
  return bytes32(configured, `${marketId}_PYTH_PRICE_ID`);
}

export function sameAddress(a: Address, b: Address): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function asMarketId(value: RwaMarketId): MarketId {
  return value;
}
