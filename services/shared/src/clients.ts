import {
  createPublicClient,
  createWalletClient,
  http,
  type Account,
  type Chain,
  type PublicClient,
  type WalletClient,
} from "viem";
import { sendTransaction, writeContract } from "viem/actions";
import { bsc, bscTestnet, foundry } from "viem/chains";

/**
 * BSC testnet (97) quirk: public nodes mishandle EIP-1559 fee fields (the
 * chain reports a zero base fee), which makes 1559-typed transactions fail
 * with "insufficient funds: have 0". Every transaction on 97 must be a
 * LEGACY transaction with an explicit gasPrice of 0.2 gwei.
 */
export const BSC_TESTNET_GAS_PRICE = 200_000_000n; // 0.2 gwei

/**
 * BSC mainnet (56): validators enforce a minimum gas price (0.05 gwei floor
 * since the 2024 repricing) and the chain's EIP-1559 base fee is pinned at
 * zero, so fee estimation is unreliable. For consistency with the deploy
 * tooling (`--legacy --with-gas-price 100000000`) every transaction on 56 is
 * a LEGACY transaction at a fixed 0.1 gwei — comfortably above the floor for
 * reliable inclusion.
 */
export const BSC_MAINNET_GAS_PRICE = 100_000_000n; // 0.1 gwei

/** Chains whose writes are forced to legacy type with a fixed gasPrice. */
const LEGACY_GAS_PRICE: Record<number, bigint> = {
  97: BSC_TESTNET_GAS_PRICE,
  56: BSC_MAINNET_GAS_PRICE,
};

/** Per-chain tx field overrides to spread into write calls (see above). */
export function txOverrides(
  chainId: number,
): { type: "legacy"; gasPrice: bigint } | Record<string, never> {
  const gasPrice = LEGACY_GAS_PRICE[chainId];
  return gasPrice !== undefined ? { type: "legacy", gasPrice } : {};
}

/**
 * BSC testnet RPCs are load-balanced and a lagging node can return a stale
 * eth_getTransactionCount right after the previous tx mined, so the next
 * write fails with "nonce too low". That error is raised at submission (the
 * tx was NOT accepted), so retrying with a refetched nonce is safe and cannot
 * double-send. Only nonce-too-low is retried — anything else rethrows.
 */
async function retryNonceTooLow<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
      if (!/nonce too low|nonce provided for the transaction is lower/i.test(msg)) throw err;
      lastErr = err;
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
  throw lastErr;
}

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
  const client = createWalletClient({
    account,
    chain: getChain(chainId),
    transport: http(opts?.rpcUrl ?? getRpcUrl()),
  });
  if (LEGACY_GAS_PRICE[chainId] === undefined) return client;
  // BSC testnet + mainnet: force legacy txs with a fixed gasPrice on every
  // write, regardless of what the caller (or a simulateContract request)
  // passed. (Wrapped as casts: the wrappers are intentionally non-generic.)
  const overrides = txOverrides(chainId);
  return {
    ...client,
    writeContract: (args: unknown) =>
      retryNonceTooLow(() =>
        writeContract(client, { ...(args as object), ...overrides } as never),
      ),
    sendTransaction: (args: unknown) =>
      retryNonceTooLow(() =>
        sendTransaction(client, { ...(args as object), ...overrides } as never),
      ),
  } as unknown as WalletClient;
}
