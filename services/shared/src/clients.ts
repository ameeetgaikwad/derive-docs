import {
  createPublicClient,
  createWalletClient,
  http,
  type Account,
  type Chain,
  type PublicClient,
  type WalletClient,
} from "viem";
import { bsc, bscTestnet, foundry } from "viem/chains";

export const CHAINS: Record<number, Chain> = {
  31337: foundry, // anvil — acceptance target
  97: bscTestnet,
  56: bsc,
};

export const DEFAULT_CHAIN_ID = 31337;
export const DEFAULT_RPC_URL = "http://127.0.0.1:8545";

export function getChain(chainId: number): Chain {
  const chain = CHAINS[chainId];
  if (!chain) throw new Error(`Unsupported chainId ${chainId} (expected 31337, 97 or 56)`);
  return chain;
}

/** RPC url from env (RPC_URL), falling back to local anvil. */
export function getRpcUrl(): string {
  return process.env.RPC_URL ?? DEFAULT_RPC_URL;
}

/** Chain id from env (CHAIN_ID), falling back to anvil 31337. */
export function getChainId(): number {
  return process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : DEFAULT_CHAIN_ID;
}

export function makePublicClient(opts?: { chainId?: number; rpcUrl?: string }): PublicClient {
  const chainId = opts?.chainId ?? getChainId();
  return createPublicClient({
    chain: getChain(chainId),
    transport: http(opts?.rpcUrl ?? getRpcUrl()),
  });
}

export function makeWalletClient(
  account: Account,
  opts?: { chainId?: number; rpcUrl?: string },
): WalletClient {
  const chainId = opts?.chainId ?? getChainId();
  return createWalletClient({
    account,
    chain: getChain(chainId),
    transport: http(opts?.rpcUrl ?? getRpcUrl()),
  });
}
