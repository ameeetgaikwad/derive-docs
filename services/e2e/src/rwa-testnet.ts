import { renameSync, writeFileSync } from "node:fs";
import { getAddress, type Address, type Hex } from "viem";
import {
  validateMarketManifest,
  type MarketDefinition,
  type MarketId,
  type MarketManifest,
  type OracleProvider,
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
  oracleProvider: OracleProvider;
  pythSpotFeed: Address;
  chainlinkSpotFeed: Address;
  scaledSpotFeed: Address;
  scaledSettlementFeed: Address;
  multiplierRegistry: Address;
  benchmarkSettlementFeed: Address;
  liveSpotFeed: Address;
  optionAsset: Address;
  pythPriceId: Hex | null;
  chainlinkAggregator: Address | null;
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

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const ZERO_BYTES32 = `0x${"0".repeat(64)}` as Hex;

function nullableAddress(value: unknown, label: string): Address | null {
  if (value === null || value === undefined) return null;
  const parsed = address(value, label);
  return /^0x0{40}$/i.test(parsed) ? null : parsed;
}

function nullableBytes32(value: unknown, label: string): Hex | null {
  if (value === null || value === undefined || value === ZERO_BYTES32) return null;
  return bytes32(value, label);
}

function oracleProvider(value: unknown, label: string): OracleProvider {
  if (value === undefined) return "pyth";
  if (value !== "pyth" && value !== "chainlink") {
    throw new Error(`${label} must be pyth or chainlink`);
  }
  return value;
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
  const provider = oracleProvider(raw.oracleProvider, `${expected}.oracleProvider`);
  const pythSpotFeed = provider === "pyth"
    ? nonZeroAddress(raw.pythSpotFeed, `${expected}.pythSpotFeed`)
    : address(raw.pythSpotFeed ?? ZERO_ADDRESS, `${expected}.pythSpotFeed`);
  const chainlinkSpotFeed = provider === "chainlink"
    ? nonZeroAddress(raw.chainlinkSpotFeed, `${expected}.chainlinkSpotFeed`)
    : address(raw.chainlinkSpotFeed ?? ZERO_ADDRESS, `${expected}.chainlinkSpotFeed`);
  const settlementFeed = provider === "chainlink"
    ? nonZeroAddress(raw.settlementFeed, `${expected}.settlementFeed`)
    : address(raw.settlementFeed, `${expected}.settlementFeed`);
  const benchmarkSettlementFeed = provider === "pyth"
    ? nonZeroAddress(raw.benchmarkSettlementFeed, `${expected}.benchmarkSettlementFeed`)
    : address(raw.benchmarkSettlementFeed ?? ZERO_ADDRESS, `${expected}.benchmarkSettlementFeed`);
  const pythPriceId = nullableBytes32(raw.pythPriceId, `${expected}.pythPriceId`);
  const chainlinkAggregator = nullableAddress(
    raw.chainlinkAggregator ?? ZERO_ADDRESS,
    `${expected}.chainlinkAggregator`,
  );
  if (provider === "pyth" && !pythPriceId) throw new Error(`${expected}.pythPriceId is required`);
  if (provider === "chainlink" && !chainlinkAggregator) {
    throw new Error(`${expected}.chainlinkAggregator is required`);
  }
  const parsed: AddMarketSidecar = {
    chainId: expectedChainId,
    name: expected,
    marketId,
    underlying: nonZeroAddress(raw.underlying, `${expected}.underlying`),
    spotFeed: nonZeroAddress(raw.spotFeed, `${expected}.spotFeed`),
    forwardFeed: nonZeroAddress(raw.forwardFeed, `${expected}.forwardFeed`),
    volFeed: nonZeroAddress(raw.volFeed, `${expected}.volFeed`),
    rateFeed: nonZeroAddress(raw.rateFeed, `${expected}.rateFeed`),
    settlementFeed,
    liveSettlementFeed: nonZeroAddress(raw.liveSettlementFeed, `${expected}.liveSettlementFeed`),
    oracleProvider: provider,
    pythSpotFeed,
    chainlinkSpotFeed,
    scaledSpotFeed: address(raw.scaledSpotFeed, `${expected}.scaledSpotFeed`),
    scaledSettlementFeed: address(
      raw.scaledSettlementFeed ?? ZERO_ADDRESS,
      `${expected}.scaledSettlementFeed`,
    ),
    multiplierRegistry: address(raw.multiplierRegistry, `${expected}.multiplierRegistry`),
    benchmarkSettlementFeed,
    liveSpotFeed: nonZeroAddress(raw.liveSpotFeed, `${expected}.liveSpotFeed`),
    optionAsset: nonZeroAddress(raw.optionAsset, `${expected}.optionAsset`),
    pythPriceId,
    chainlinkAggregator,
    baseAsset: nonZeroAddress(raw.baseAsset, `${expected}.baseAsset`),
    underlyingDecimals: Number(raw.underlyingDecimals),
    scaledUi: Boolean(raw.scaledUi),
  };
  if (parsed.scaledUi) {
    if (/^0x0{40}$/i.test(parsed.scaledSpotFeed)) {
      throw new Error(`${expected} sidecar is missing a scaled spot feed`);
    }
    if (/^0x0{40}$/i.test(parsed.multiplierRegistry)) {
      throw new Error(`${expected} sidecar is missing a multiplier registry`);
    }
    if (!sameAddress(parsed.liveSpotFeed, parsed.scaledSpotFeed)) {
      throw new Error(`${expected} live spot feed is not the scaled spot feed`);
    }
    if (provider === "chainlink") {
      if (/^0x0{40}$/i.test(parsed.scaledSettlementFeed)) {
        throw new Error(`${expected} sidecar is missing a scaled settlement feed`);
      }
      if (!sameAddress(parsed.liveSettlementFeed, parsed.scaledSettlementFeed)) {
        throw new Error(`${expected} live settlement feed is not the scaled settlement feed`);
      }
    }
  } else if (
    provider === "chainlink"
      && !sameAddress(parsed.liveSettlementFeed, parsed.settlementFeed)
  ) {
    throw new Error(`${expected} live settlement feed is not the Chainlink fixing feed`);
  }
  return parsed;
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
  if (market.oracleProvider !== sidecar.oracleProvider) {
    throw new Error(`${marketId} sidecar oracle provider does not match the manifest`);
  }
  if (
    market.oracleProvider === "pyth"
      && market.pythPriceId
      && market.pythPriceId.toLowerCase() !== sidecar.pythPriceId?.toLowerCase()
  ) {
    throw new Error(`${marketId} sidecar Pyth id does not match the manifest`);
  }
  if (
    market.oracleProvider === "chainlink"
      && (!market.chainlinkAggregator || !sidecar.chainlinkAggregator
        || !sameAddress(market.chainlinkAggregator, sidecar.chainlinkAggregator))
  ) {
    throw new Error(`${marketId} sidecar Chainlink aggregator does not match the manifest`);
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
      ...(sidecar.oracleProvider === "chainlink"
        ? { settlementFixingFeed: sidecar.settlementFeed }
        : {}),
      ...(market.collateral.scaledUi
        ? { multiplierRegistry: sidecar.multiplierRegistry }
        : {}),
    },
    oracleProvider: sidecar.oracleProvider,
    pythPriceId: sidecar.pythPriceId,
    chainlinkAggregator: sidecar.chainlinkAggregator,
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
  const hasOracleSource = market.oracleProvider === "pyth"
    ? market.pythPriceId !== null
    : market.chainlinkAggregator !== null;
  if (enabled && (!market.contracts || !market.collateral.address || !hasOracleSource)) {
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
