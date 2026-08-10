import type { Address, PublicClient, WalletClient } from "viem";
import type { LocalAccount } from "viem";
import type { MarketDefinition } from "@hedge/shared";
import { immediateTransactionQueue, type TransactionQueue } from "./transactionQueue.js";

const tokenAbi = [
  { type: "function", name: "uiMultiplier", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "newUIMultiplier", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "effectiveAt", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const registryAbi = [
  { type: "function", name: "checkpointCurrent", stateMutability: "nonpayable", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "checkpointPending", stateMutability: "nonpayable", inputs: [], outputs: [{ type: "uint256" }, { type: "uint64" }] },
  { type: "function", name: "checkpointCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "multiplierAt", stateMutability: "view", inputs: [{ type: "uint64" }], outputs: [{ type: "uint256" }] },
  {
    type: "function", name: "checkpointAt", stateMutability: "view", inputs: [{ type: "uint256" }],
    outputs: [{ type: "tuple", components: [{ name: "effectiveAt", type: "uint64" }, { name: "multiplier", type: "uint192" }] }],
  },
] as const;

export interface MultiplierCheckpointResult {
  marketId: string;
  current: bigint;
  currentCheckpointed: boolean;
  pendingCheckpointed: boolean;
}

/** Checkpoints live and scheduled BEP-8056 multipliers for every enabled scaled market. */
export async function checkpointScaledMarkets(opts: {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: LocalAccount;
  markets: MarketDefinition[];
  transactionQueue?: TransactionQueue;
}): Promise<MultiplierCheckpointResult[]> {
  const queue = opts.transactionQueue ?? immediateTransactionQueue;
  const scaled = opts.markets.filter(
    (market) => market.enabled && market.collateral.scaledUi && market.collateral.address && market.contracts?.multiplierRegistry,
  );
  const results: MultiplierCheckpointResult[] = [];
  for (const market of scaled) {
    const token = market.collateral.address as Address;
    const registry = market.contracts!.multiplierRegistry as Address;
    const current = await opts.publicClient.readContract({ address: token, abi: tokenAbi, functionName: "uiMultiplier" });
    const chainNow = (await opts.publicClient.getBlock()).timestamp;
    const checkpointedCurrent = await opts.publicClient.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "multiplierAt",
      args: [chainNow],
    });
    let currentCheckpointed = false;
    if (checkpointedCurrent !== current) {
      await queue.run(async () => {
        const hash = await opts.walletClient.writeContract({
          address: registry, abi: registryAbi, functionName: "checkpointCurrent", account: opts.account, chain: opts.walletClient.chain,
        });
        await opts.publicClient.waitForTransactionReceipt({ hash });
      });
      currentCheckpointed = true;
    }

    let pendingCheckpointed = false;
    const pending = await Promise.all([
      opts.publicClient.readContract({ address: token, abi: tokenAbi, functionName: "newUIMultiplier" }),
      opts.publicClient.readContract({ address: token, abi: tokenAbi, functionName: "effectiveAt" }),
    ]).catch(() => [0n, 0n] as const);
    const count = await opts.publicClient.readContract({ address: registry, abi: registryAbi, functionName: "checkpointCount" });
    let pendingAlreadyCheckpointed = false;
    for (let index = 0n; index < count; index++) {
      const checkpoint = await opts.publicClient.readContract({
        address: registry,
        abi: registryAbi,
        functionName: "checkpointAt",
        args: [index],
      });
      if (checkpoint.effectiveAt === pending[1] && checkpoint.multiplier === pending[0]) {
        pendingAlreadyCheckpointed = true;
        break;
      }
    }
    if (pending[0] > 0n && pending[1] > chainNow && !pendingAlreadyCheckpointed) {
      await queue.run(async () => {
        const hash = await opts.walletClient.writeContract({
          address: registry, abi: registryAbi, functionName: "checkpointPending", account: opts.account, chain: opts.walletClient.chain,
        });
        await opts.publicClient.waitForTransactionReceipt({ hash });
      });
      pendingCheckpointed = true;
    }
    results.push({ marketId: market.id, current, currentCheckpointed, pendingCheckpointed });
  }
  return results;
}
