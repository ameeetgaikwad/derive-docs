import type { Address, Hex } from "viem";
import {
  getChainId,
  getRpcUrl,
  requireDeployments,
  getDeployedAddress,
  readMarketManifest,
  enabledMarkets,
  type MarketDefinition,
} from "@hedge/shared";

/** anvil account #0 — the registered trade executor in deployments/31337.json */
export const ANVIL_EXECUTOR_KEY: Hex =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export interface EngineConfig {
  chainId: number;
  rpcUrl: string;
  /** listen address (default 127.0.0.1 — front with a TLS proxy in prod) */
  host: string;
  port: number;
  /** auction window in ms (default 3000) */
  auctionWindowMs: number;
  /** ms the taker has to accept a won auction (default 120000) */
  takerAcceptDeadlineMs: number;
  /** WS ping interval in ms; 0 disables (default 30000) */
  heartbeatMs: number;
  /** maker EOA allowlist; empty = open/dev mode */
  makerAllowlist: string[];
  /** allow RFQ creation (default true) */
  takerOpen: boolean;
  /** RFQ creations per IP per minute (default 30; 0 disables) */
  rfqRateLimitPerMin: number;
  /** JSONL persistence path; null = in-memory store */
  storePath: string | null;
  /** Matching contract (EIP-712 verifying contract) */
  matching: Address;
  rfqModule: Address;
  subAccounts: Address;
  cashAsset: Address;
  /** SRMPortfolioViewer — live OIFeeRateBPS reads for the collateral pre-check */
  srmViewer: Address;
  standardManager: Address;
  /** currency symbol -> OptionAsset address, e.g. { BTC: 0x... } */
  optionAssets: Record<string, Address>;
  /** currency symbol -> forward feed (OI fee estimation) */
  forwardFeeds: Record<string, Address>;
  /** canonical per-chain market definitions, including staged disabled markets */
  markets: MarketDefinition[];
  /**
   * trade-executor private key; defaults to anvil #0 on chain 31337.
   * Null when the executor key lives in AWS KMS (EXECUTOR_KMS_KEY_ID).
   */
  executorPrivateKey: Hex | null;
  /**
   * AWS KMS key id/ARN/alias for the executor (EXECUTOR_KMS_KEY_ID).
   * Takes precedence over EXECUTOR_PRIVATE_KEY — see @hedge/shared resolveAccount.
   */
  executorKmsKeyId: string | null;
}

/**
 * Load config from env, with anvil defaults. Contract addresses come from
 * protocol/deployments/<chainId>.json (override dir: SATS_DEPLOYMENTS_DIR).
 *
 * Env:
 *   RPC_URL                  default http://127.0.0.1:8545
 *   CHAIN_ID                 default 31337
 *   HOST                     default 127.0.0.1 (dev) — set 0.0.0.0 behind a TLS proxy
 *   RFQ_PORT / PORT          default 3030
 *   AUCTION_WINDOW_MS        default 3000
 *   TAKER_ACCEPT_DEADLINE_MS default 120000
 *   WS_HEARTBEAT_MS          default 30000 (0 disables)
 *   MAKER_ALLOWLIST          comma-separated maker addresses; empty = open/dev
 *   TAKER_OPEN               default true; "false" rejects all RFQ creation
 *   RFQ_RATE_LIMIT_PER_MIN   default 30 RFQ creations per IP per minute (0 disables)
 *   STORE_PATH               JSONL persistence file; unset = in-memory
 *   EXECUTOR_PRIVATE_KEY     default anvil key #0 (only on 31337)
 *   EXECUTOR_KMS_KEY_ID      AWS KMS key id/ARN/alias — used instead of the
 *                            raw key when set (region: EXECUTOR_KMS_REGION or
 *                            the standard AWS chain)
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): EngineConfig {
  const chainId = getChainId();
  const deployments = requireDeployments(chainId);
  const manifest = readMarketManifest(chainId);
  const activeMarkets = enabledMarkets(manifest);

  const executorKmsKeyId = env.EXECUTOR_KMS_KEY_ID?.trim() || null;
  const executorPrivateKey = ((env.EXECUTOR_PRIVATE_KEY ??
    (chainId === 31337 ? ANVIL_EXECUTOR_KEY : undefined)) ?? null) as Hex | null;
  if (!executorKmsKeyId && !executorPrivateKey) {
    throw new Error(
      `EXECUTOR_PRIVATE_KEY or EXECUTOR_KMS_KEY_ID is required on chain ${chainId}`,
    );
  }

  const makerAllowlist = (env.MAKER_ALLOWLIST ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
  for (const addr of makerAllowlist) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      throw new Error(`MAKER_ALLOWLIST entry is not an address: ${addr}`);
    }
  }

  return {
    chainId,
    rpcUrl: getRpcUrl(),
    host: env.HOST ?? "127.0.0.1",
    port: Number(env.RFQ_PORT ?? env.PORT ?? 3030),
    auctionWindowMs: Number(env.AUCTION_WINDOW_MS ?? 3000),
    takerAcceptDeadlineMs: Number(env.TAKER_ACCEPT_DEADLINE_MS ?? 120_000),
    heartbeatMs: Number(env.WS_HEARTBEAT_MS ?? 30_000),
    makerAllowlist,
    takerOpen: env.TAKER_OPEN !== "false",
    rfqRateLimitPerMin: Number(env.RFQ_RATE_LIMIT_PER_MIN ?? 30),
    storePath: env.STORE_PATH ?? null,
    matching: getDeployedAddress(deployments, "matching"),
    rfqModule: getDeployedAddress(deployments, "rfqModule"),
    subAccounts: getDeployedAddress(deployments, "subAccounts"),
    cashAsset: getDeployedAddress(deployments, "cashAsset"),
    srmViewer: getDeployedAddress(deployments, "srmViewer"),
    standardManager: getDeployedAddress(deployments, "standardManager"),
    optionAssets: Object.fromEntries(activeMarkets.map((market) => [market.id, market.contracts!.optionAsset])),
    forwardFeeds: Object.fromEntries(activeMarkets.map((market) => [market.id, market.contracts!.forwardFeed])),
    markets: manifest.markets,
    executorPrivateKey,
    executorKmsKeyId,
  };
}
