import type { Address, Hex } from "viem";
import {
  getChainId,
  getRpcUrl,
  requireDeployments,
  getDeployedAddress,
} from "@sats-options/shared";

/** anvil account #0 — the registered trade executor in deployments/31337.json */
export const ANVIL_EXECUTOR_KEY: Hex =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export interface EngineConfig {
  chainId: number;
  rpcUrl: string;
  port: number;
  /** auction window in ms (default 3000) */
  auctionWindowMs: number;
  /** Matching contract (EIP-712 verifying contract) */
  matching: Address;
  rfqModule: Address;
  subAccounts: Address;
  cashAsset: Address;
  /** currency symbol -> OptionAsset address, e.g. { BTC: 0x... } */
  optionAssets: Record<string, Address>;
  /** trade-executor private key; defaults to anvil #0 on chain 31337 */
  executorPrivateKey: Hex;
}

/**
 * Load config from env, with anvil defaults. Contract addresses come from
 * protocol/deployments/<chainId>.json (override dir: SATS_DEPLOYMENTS_DIR).
 *
 * Env:
 *   RPC_URL             default http://127.0.0.1:8545
 *   CHAIN_ID            default 31337
 *   RFQ_PORT / PORT     default 3030
 *   AUCTION_WINDOW_MS   default 3000
 *   EXECUTOR_PRIVATE_KEY  default anvil key #0 (only on 31337)
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): EngineConfig {
  const chainId = getChainId();
  const deployments = requireDeployments(chainId);

  const executorPrivateKey = (env.EXECUTOR_PRIVATE_KEY ??
    (chainId === 31337 ? ANVIL_EXECUTOR_KEY : undefined)) as Hex | undefined;
  if (!executorPrivateKey) {
    throw new Error(`EXECUTOR_PRIVATE_KEY is required on chain ${chainId}`);
  }

  return {
    chainId,
    rpcUrl: getRpcUrl(),
    port: Number(env.RFQ_PORT ?? env.PORT ?? 3030),
    auctionWindowMs: Number(env.AUCTION_WINDOW_MS ?? 3000),
    matching: getDeployedAddress(deployments, "matching"),
    rfqModule: getDeployedAddress(deployments, "rfqModule"),
    subAccounts: getDeployedAddress(deployments, "subAccounts"),
    cashAsset: getDeployedAddress(deployments, "cashAsset"),
    optionAssets: {
      BTC: getDeployedAddress(deployments, "btcOptionAsset"),
    },
    executorPrivateKey,
  };
}
