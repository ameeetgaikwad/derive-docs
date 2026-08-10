import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import {
  erc20Abi,
  getDeployedAddress,
  makePublicClient,
  readDeployments,
  standardManagerAbi,
  type DeploymentsFile,
  type MarketDefinition,
} from "@hedge/shared";
import type { Address, Hex, PublicClient } from "viem";
import {
  marketFromManifest,
  parseAddMarketSidecar,
  parseManifestFile,
  parseMocksFile,
  sameAddress,
  type AddMarketSidecar,
  type ManifestFile,
  type RwaMarketId,
  type RwaMocksFile,
} from "./rwa-testnet.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "..", "..", "..");
export const PROTOCOL_DIR = join(ROOT, "protocol");
export const DEPLOYMENTS_DIR = join(PROTOCOL_DIR, "deployments");
export const TESTNET_MANIFEST_PATH = join(DEPLOYMENTS_DIR, "markets", "97.json");
export const RWA_MOCKS_PATH = join(DEPLOYMENTS_DIR, "97-rwa-mocks.json");
export const DEPLOYMENT_REPORT_PATH = join(DEPLOYMENTS_DIR, "97-rwa-report.json");

const ownerAbi = [{
  type: "function",
  name: "owner",
  stateMutability: "view",
  inputs: [],
  outputs: [{ type: "address" }],
}] as const;

const scaledTokenAbi = [
  {
    type: "function",
    name: "supportsInterface",
    stateMutability: "view",
    inputs: [{ type: "bytes4" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "uiMultiplier",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

const scaledSpotAbi = [{
  type: "function",
  name: "uiSpotFeed",
  stateMutability: "view",
  inputs: [],
  outputs: [{ type: "address" }],
}] as const;

const pythSpotAbi = [
  {
    type: "function",
    name: "pyth",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "priceId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
] as const;

const pythPriceAbi = [{
  type: "function",
  name: "getPriceUnsafe",
  stateMutability: "view",
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

const SCALED_UI_CORE = "0xa60bf13d" as Hex;
const SCALED_UI_PENDING = "0x4bd27648" as Hex;

function setFallback(target: string, source: string): void {
  if (!process.env[target] && process.env[source]) process.env[target] = process.env[source];
}

/** Load the repository's gitignored testnet env without overriding shell values. */
export function loadTestnetEnv(): void {
  const path = join(PROTOCOL_DIR, ".env");
  if (existsSync(path)) process.loadEnvFile(path);
  setFallback("RPC_URL", "TESTNET_RPC_URL");
  setFallback("PRIVATE_KEY", "TESTNET_DEPLOYER_KEY");
  setFallback("FEED_SIGNER_KEY", "TESTNET_FEED_SIGNER_KEY");
}

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function privateKeyEnv(name = "PRIVATE_KEY"): Hex {
  const raw = requireEnv(name);
  const value = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} must be a 32-byte private key`);
  return value;
}

export function readTestnetManifest(): ManifestFile {
  return parseManifestFile(JSON.parse(readFileSync(TESTNET_MANIFEST_PATH, "utf8")));
}

export function readRwaMocks(): RwaMocksFile | null {
  if (!existsSync(RWA_MOCKS_PATH)) return null;
  return parseMocksFile(JSON.parse(readFileSync(RWA_MOCKS_PATH, "utf8")));
}

export function sidecarPath(marketId: RwaMarketId): string {
  return join(DEPLOYMENTS_DIR, `97-${marketId}.json`);
}

export function readSidecar(marketId: RwaMarketId): AddMarketSidecar | null {
  const path = sidecarPath(marketId);
  if (!existsSync(path)) return null;
  return parseAddMarketSidecar(JSON.parse(readFileSync(path, "utf8")), marketId);
}

export function requireTestnetDeployments(): DeploymentsFile {
  const deployments = readDeployments(97);
  if (!deployments) throw new Error("protocol/deployments/97.json is missing");
  if (Number(deployments.chainId) !== 97) throw new Error("testnet deployment file has the wrong chain id");
  return deployments;
}

export function makeTestnetClient(): PublicClient {
  return makePublicClient({ chainId: 97, rpcUrl: requireEnv("RPC_URL") });
}

export async function assertTestnetChain(client: PublicClient): Promise<void> {
  const chainId = await client.getChainId();
  if (chainId !== 97) throw new Error(`refusing to operate on chain ${chainId}; expected BSC testnet 97`);
}

async function assertContract(client: PublicClient, target: Address, label: string): Promise<void> {
  const code = await client.getCode({ address: target });
  if (!code || code === "0x") throw new Error(`${label} has no contract code at ${target}`);
}

export async function assertToken(
  client: PublicClient,
  market: MarketDefinition,
  token: Address,
): Promise<void> {
  await assertContract(client, token, `${market.id} collateral`);
  const [symbol, decimals] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
  ]);
  if (symbol !== market.collateral.symbol) {
    throw new Error(`${market.id} collateral symbol ${symbol} != ${market.collateral.symbol}`);
  }
  if (Number(decimals) !== market.collateral.decimals) {
    throw new Error(`${market.id} collateral decimals ${decimals} != ${market.collateral.decimals}`);
  }
  if (market.collateral.scaledUi) {
    const [core, pending, multiplier] = await Promise.all([
      client.readContract({
        address: token,
        abi: scaledTokenAbi,
        functionName: "supportsInterface",
        args: [SCALED_UI_CORE],
      }),
      client.readContract({
        address: token,
        abi: scaledTokenAbi,
        functionName: "supportsInterface",
        args: [SCALED_UI_PENDING],
      }),
      client.readContract({ address: token, abi: scaledTokenAbi, functionName: "uiMultiplier" }),
    ]);
    if (!core || !pending) throw new Error(`${market.id} collateral is missing ERC-8056 interfaces`);
    if (multiplier <= 0n) throw new Error(`${market.id} collateral has an invalid UI multiplier`);
  }
}

export async function verifyMocks(
  client: PublicClient,
  manifest: ManifestFile,
  mocks: RwaMocksFile,
): Promise<void> {
  const addresses: Record<RwaMarketId, Address> = {
    XAU: mocks.xaut,
    SPY: mocks.spyb,
    NVDA: mocks.nvdab,
    SPCX: mocks.spcxb,
  };
  for (const [marketId, token] of Object.entries(addresses) as [RwaMarketId, Address][]) {
    await assertToken(client, marketFromManifest(manifest, marketId), token);
  }
}

export async function verifyMarket(
  client: PublicClient,
  deployments: DeploymentsFile,
  market: MarketDefinition,
): Promise<void> {
  if (!market.contracts || !market.collateral.address || !market.pythPriceId) {
    throw new Error(`${market.id} is not fully staged in the manifest`);
  }
  await assertToken(client, market, market.collateral.address);
  const contracts = market.contracts;
  const contractAddresses: [string, Address][] = [
    ["option asset", contracts.optionAsset],
    ["base asset", contracts.baseAsset],
    ["spot feed", contracts.spotFeed],
    ["forward feed", contracts.forwardFeed],
    ["vol feed", contracts.volFeed],
    ["rate feed", contracts.rateFeed],
    ["settlement feed", contracts.settlementFeed],
  ];
  if (contracts.multiplierRegistry) {
    contractAddresses.push(["multiplier registry", contracts.multiplierRegistry]);
  }
  await Promise.all(contractAddresses.map(([label, target]) => assertContract(client, target, `${market.id} ${label}`)));

  const standardManager = getDeployedAddress(deployments, "standardManager");
  const feeds = await client.readContract({
    address: standardManager,
    abi: standardManagerAbi,
    functionName: "getMarketFeeds",
    args: [BigInt(contracts.marketId)],
  });
  const [spot, forward, vol] = feeds as readonly [Address, Address, Address];
  if (!sameAddress(spot, contracts.spotFeed)) throw new Error(`${market.id} SRM spot feed mismatch`);
  if (!sameAddress(forward, contracts.forwardFeed)) throw new Error(`${market.id} SRM forward feed mismatch`);
  if (!sameAddress(vol, contracts.volFeed)) throw new Error(`${market.id} SRM vol feed mismatch`);
}

export interface OwnershipPreflight {
  deployer: Address;
  feedSigner: Address;
  deployerBalance: bigint;
  feedSignerBalance: bigint;
  minimumFeedSignerBalance: bigint;
  feedSignerReady: boolean;
}

function balanceThreshold(name: string, fallback: bigint): bigint {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer number of wei`);
  return BigInt(raw);
}

export async function verifyDeploymentAuthority(
  client: PublicClient,
  deployments: DeploymentsFile,
): Promise<OwnershipPreflight> {
  const deployer = privateKeyToAccount(privateKeyEnv()).address;
  const standardManager = getDeployedAddress(deployments, "standardManager");
  const srmViewer = getDeployedAddress(deployments, "srmViewer");
  const feedSigner = getDeployedAddress(deployments, "feedSigner");
  const [managerOwner, viewerOwner, deployerBalance, feedSignerBalance] = await Promise.all([
    client.readContract({ address: standardManager, abi: ownerAbi, functionName: "owner" }),
    client.readContract({ address: srmViewer, abi: ownerAbi, functionName: "owner" }),
    client.getBalance({ address: deployer }),
    client.getBalance({ address: feedSigner }),
  ]);
  if (!sameAddress(deployer, managerOwner)) {
    throw new Error(`deployer ${deployer} does not own StandardManager (owner ${managerOwner})`);
  }
  if (!sameAddress(deployer, viewerOwner)) {
    throw new Error(`deployer ${deployer} does not own SRMPortfolioViewer (owner ${viewerOwner})`);
  }
  const minimumDeployer = balanceThreshold("RWA_DEPLOYER_MIN_BALANCE_WEI", 30_000_000_000_000_000n);
  const minimumFeedSigner = balanceThreshold("ORACLE_MIN_SIGNER_BALANCE_WEI", 5_000_000_000_000_000n);
  if (deployerBalance < minimumDeployer) {
    throw new Error(`deployer ${deployer} has insufficient tBNB (${deployerBalance} wei; need ${minimumDeployer})`);
  }
  return {
    deployer,
    feedSigner,
    deployerBalance,
    feedSignerBalance,
    minimumFeedSignerBalance: minimumFeedSigner,
    feedSignerReady: feedSignerBalance >= minimumFeedSigner,
  };
}

export interface PythHealth {
  adapter: Address;
  pyth: Address;
  priceId: Hex;
  price: bigint;
  publishTime: bigint;
}

export async function readPythHealth(
  client: PublicClient,
  market: MarketDefinition,
): Promise<PythHealth> {
  if (!market.contracts || !market.pythPriceId) throw new Error(`${market.id} is not fully staged`);
  const adapter = market.collateral.scaledUi
    ? await client.readContract({
        address: market.contracts.spotFeed,
        abi: scaledSpotAbi,
        functionName: "uiSpotFeed",
      })
    : market.contracts.spotFeed;
  const [pyth, priceId] = await Promise.all([
    client.readContract({ address: adapter, abi: pythSpotAbi, functionName: "pyth" }),
    client.readContract({ address: adapter, abi: pythSpotAbi, functionName: "priceId" }),
  ]);
  if (priceId.toLowerCase() !== market.pythPriceId.toLowerCase()) {
    throw new Error(`${market.id} Pyth price id does not match the manifest`);
  }
  const price = await client.readContract({
    address: pyth,
    abi: pythPriceAbi,
    functionName: "getPriceUnsafe",
    args: [priceId],
  });
  return {
    adapter,
    pyth,
    priceId,
    price: price.price,
    publishTime: price.publishTime,
  };
}
