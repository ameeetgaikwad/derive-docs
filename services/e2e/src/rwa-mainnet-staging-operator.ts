import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDeployedAddress, makePublicClient, type DeploymentsFile } from "@hedge/shared";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, PublicClient } from "viem";
import type { MarketDefinition } from "@hedge/shared";
import {
  parseAddMarketSidecar,
  parseManifestFile,
  sameAddress,
  type AddMarketSidecar,
  type ManifestFile,
  type RwaMarketId,
} from "./rwa-testnet.js";
import {
  privateKeyEnv,
  readChainlinkHealth,
  readOracleBinding,
  readPythBinding,
  readPythHealth,
  verifyMarket,
} from "./rwa-testnet-operator.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "..", "..", "..");
export const PROTOCOL_DIR = join(ROOT, "protocol");
export const STAGING_DEPLOYMENTS_DIR = join(PROTOCOL_DIR, "deployments", "staging");
export const STAGING_DEPLOYMENTS_PATH = join(STAGING_DEPLOYMENTS_DIR, "56.json");
export const STAGING_MANIFEST_PATH = join(STAGING_DEPLOYMENTS_DIR, "markets", "56.json");
export const STAGING_REPORT_PATH = join(STAGING_DEPLOYMENTS_DIR, "56-rwa-report.json");
export const STAGING_CHAIN_ID = 56;
export const SUPPORTED_STAGING_RWA_MARKETS = ["XAU", "SPY", "NVDA"] as const;
export const STAGING_HERMES_URL = "https://pyth.dourolabs.app/hermes";
export const CHAINLINK_MAX_STALENESS_SECONDS = 24n * 60n * 60n;

const ownerAbi = [{
  type: "function",
  name: "owner",
  stateMutability: "view",
  inputs: [],
  outputs: [{ type: "address" }],
}] as const;

const standardManagerStateAbi = [
  {
    type: "function",
    name: "lastMarketId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "borrowingEnabled",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
] as const;

function loadIfPresent(path: string): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

function fallback(target: string, source: string): void {
  if (!process.env[target] && process.env[source]) process.env[target] = process.env[source];
}

/** Load only gitignored chain-56 staging operator env files; shell values win. */
export function loadMainnetStagingEnv(): void {
  loadIfPresent(join(ROOT, ".env.staging.mainnet"));
  loadIfPresent(join(PROTOCOL_DIR, ".env.staging.mainnet"));
  loadIfPresent(join(ROOT, "services", "oracle-feeds", ".env.staging.mainnet"));
  fallback("RPC_URL", "RPC_URL_56");
  fallback("PRIVATE_KEY", "MAINNET_STAGING_DEPLOYER_KEY");
}

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/**
 * The chain-56 staging deployment uses Pyth's upgraded EVM contract. Updates
 * for that contract must come from the matching upgraded Hermes endpoint;
 * legacy Hermes VAAs revert with InvalidWormholeVaa().
 */
export function requireStagingHermes(): string {
  requireEnv("PYTH_API_KEY");
  const configured = process.env.HERMES_URL?.trim();
  if (configured && configured.replace(/\/$/, "") !== STAGING_HERMES_URL) {
    throw new Error(
      `HERMES_URL must be ${STAGING_HERMES_URL} for the upgraded chain-56 Pyth contract`,
    );
  }
  return STAGING_HERMES_URL;
}

export function requireStagingRwaMarket(value: string | undefined): RwaMarketId {
  const normalized = value?.trim().toUpperCase();
  if (!normalized || !SUPPORTED_STAGING_RWA_MARKETS.includes(normalized as never)) {
    throw new Error(`--market must be one of ${SUPPORTED_STAGING_RWA_MARKETS.join(", ")}`);
  }
  return normalized as RwaMarketId;
}

export function readStagingManifest(): ManifestFile {
  return parseManifestFile(JSON.parse(readFileSync(STAGING_MANIFEST_PATH, "utf8")), STAGING_CHAIN_ID);
}

export function requireStagingDeployments(): DeploymentsFile {
  const deployments = JSON.parse(readFileSync(STAGING_DEPLOYMENTS_PATH, "utf8")) as DeploymentsFile;
  if (Number(deployments.chainId) !== STAGING_CHAIN_ID) {
    throw new Error("staging deployment file must target chain 56");
  }
  return deployments;
}

export function stagingSidecarPath(marketId: RwaMarketId): string {
  return join(STAGING_DEPLOYMENTS_DIR, `56-${marketId}.json`);
}

export function readStagingSidecar(marketId: RwaMarketId): AddMarketSidecar | null {
  const path = stagingSidecarPath(marketId);
  if (!existsSync(path)) return null;
  return parseAddMarketSidecar(JSON.parse(readFileSync(path, "utf8")), marketId, STAGING_CHAIN_ID);
}

export function makeStagingClient(): PublicClient {
  return makePublicClient({ chainId: STAGING_CHAIN_ID, rpcUrl: requireEnv("RPC_URL") });
}

export async function assertStagingChain(client: PublicClient): Promise<void> {
  const chainId = await client.getChainId();
  if (chainId !== STAGING_CHAIN_ID) {
    throw new Error(`refusing to operate on chain ${chainId}; expected BNB mainnet staging chain 56`);
  }
}

function minimumBalance(name: string, fallback: bigint): bigint {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer number of wei`);
  return BigInt(value);
}

export async function verifyStagingAuthority(
  client: PublicClient,
  deployments: DeploymentsFile,
): Promise<{ deployer: Address; feedSigner: Address; deployerBalance: bigint; feedSignerBalance: bigint }> {
  const deployer = privateKeyToAccount(privateKeyEnv()).address;
  const standardManager = getDeployedAddress(deployments, "standardManager");
  const viewer = getDeployedAddress(deployments, "srmViewer");
  const feedSigner = getDeployedAddress(deployments, "feedSigner");
  const [managerOwner, viewerOwner, deployerBalance, feedSignerBalance] = await Promise.all([
    client.readContract({ address: standardManager, abi: ownerAbi, functionName: "owner" }),
    client.readContract({ address: viewer, abi: ownerAbi, functionName: "owner" }),
    client.getBalance({ address: deployer }),
    client.getBalance({ address: feedSigner }),
  ]);
  if (!sameAddress(deployer, managerOwner) || !sameAddress(deployer, viewerOwner)) {
    throw new Error(`deployer ${deployer} does not own the staging SRM and viewer`);
  }
  const deployerMinimum = minimumBalance("RWA_DEPLOYER_MIN_BALANCE_WEI", 5_000_000_000_000_000n);
  const signerMinimum = minimumBalance("ORACLE_MIN_SIGNER_BALANCE_WEI", 5_000_000_000_000_000n);
  if (deployerBalance < deployerMinimum) {
    throw new Error(`deployer ${deployer} has ${deployerBalance} wei; need ${deployerMinimum}`);
  }
  if (feedSignerBalance < signerMinimum) {
    throw new Error(`feed signer ${feedSigner} has ${feedSignerBalance} wei; need ${signerMinimum}`);
  }
  return { deployer, feedSigner, deployerBalance, feedSignerBalance };
}

export async function verifyStagingSequence(
  client: PublicClient,
  deployments: DeploymentsFile,
  marketId: RwaMarketId,
): Promise<void> {
  const standardManager = getDeployedAddress(deployments, "standardManager");
  const [lastMarketId, borrowingEnabled] = await Promise.all([
    client.readContract({ address: standardManager, abi: standardManagerStateAbi, functionName: "lastMarketId" }),
    client.readContract({ address: standardManager, abi: standardManagerStateAbi, functionName: "borrowingEnabled" }),
  ]);
  if (borrowingEnabled) throw new Error("staging SRM borrowing is enabled; refusing RWA deployment");
  if (lastMarketId >= 4n) {
    throw new Error(`no remaining RWA market slot; staging SRM lastMarketId is ${lastMarketId}`);
  }
  if (marketId === "XAU") {
    if (lastMarketId !== 1n) {
      throw new Error(`XAU must be the first RWA market; staging SRM lastMarketId is ${lastMarketId}`);
    }
  } else if (lastMarketId < 2n) {
    throw new Error(`${marketId} requires XAU to be deployed first`);
  }
}

export async function verifyStagingMarket(
  client: PublicClient,
  deployments: DeploymentsFile,
  market: Parameters<typeof verifyMarket>[2],
): Promise<void> {
  await verifyMarket(client, deployments, market);
  const binding = await readOracleBinding(client, market);
  if (binding.provider === "pyth") {
    const expectedPyth = getDeployedAddress(deployments, "pyth");
    if (!sameAddress(binding.pyth, expectedPyth)) {
      throw new Error(
        `${market.id} adapter points to Pyth ${binding.pyth}; expected staging Pyth ${expectedPyth}`,
      );
    }
  }
}

const chainlinkSourceAbi = [
  { type: "function", name: "description", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  {
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
  },
] as const;

export interface ChainlinkSourceHealth {
  aggregator: Address;
  description: string;
  decimals: number;
  answer: bigint;
  updatedAt: bigint;
  age: bigint;
}

/** Identifies a valid Chainlink source whose last complete round is too old for normal activation. */
export class StaleChainlinkSourceError extends Error {
  constructor(marketId: string, age: bigint) {
    super(`${marketId} Chainlink source is stale (${age}s)`);
    this.name = "StaleChainlinkSourceError";
  }
}

export async function verifyChainlinkSource(
  client: PublicClient,
  market: MarketDefinition,
): Promise<ChainlinkSourceHealth> {
  if (market.oracleProvider !== "chainlink" || !market.chainlinkAggregator) {
    throw new Error(`${market.id} does not have a Chainlink source configured`);
  }
  const aggregator = market.chainlinkAggregator;
  const code = await client.getCode({ address: aggregator });
  if (!code || code === "0x") throw new Error(`${market.id} Chainlink aggregator has no contract code`);
  const [description, decimals, round, block] = await Promise.all([
    client.readContract({ address: aggregator, abi: chainlinkSourceAbi, functionName: "description" }),
    client.readContract({ address: aggregator, abi: chainlinkSourceAbi, functionName: "decimals" }),
    client.readContract({ address: aggregator, abi: chainlinkSourceAbi, functionName: "latestRoundData" }),
    client.getBlock(),
  ]);
  const expectedDescription = `${market.id} / USD`;
  if (description !== expectedDescription) {
    throw new Error(
      `${market.id} Chainlink description ${description} does not match ${expectedDescription}`,
    );
  }
  if (decimals > 36) throw new Error(`${market.id} Chainlink decimals ${decimals} are unsupported`);
  const [roundId, answer, , updatedAt, answeredInRound] = round;
  if (roundId === 0n || answer <= 0n || updatedAt === 0n || updatedAt > block.timestamp || answeredInRound < roundId) {
    throw new Error(`${market.id} Chainlink latest round is invalid`);
  }
  const age = block.timestamp - updatedAt;
  if (age > CHAINLINK_MAX_STALENESS_SECONDS) {
    throw new StaleChainlinkSourceError(market.id, age);
  }
  return { aggregator, description, decimals, answer, updatedAt, age };
}

export { readChainlinkHealth, readOracleBinding, readPythBinding, readPythHealth };
