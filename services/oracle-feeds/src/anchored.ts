import type { Address, Hex, PublicClient, WalletClient } from "viem";
import type { LocalAccount } from "viem";
import { getDeployedAddress, type DeploymentsFile } from "@hedge/shared";

/**
 * Minimal ABI for protocol/src/AnchoredSettlementFeed.sol — the Chainlink/Pyth-anchored
 * ISettlementFeed the OptionAsset settles against. fixSettlementPrice is PERMISSIONLESS.
 */
export const anchoredSettlementFeedAbi = [
  {
    type: "function",
    name: "fixSettlementPrice",
    stateMutability: "nonpayable",
    inputs: [{ name: "expiry", type: "uint64" }],
    outputs: [{ name: "price", type: "uint256" }],
  },
  {
    type: "function",
    name: "getSettlementPrice",
    stateMutability: "view",
    inputs: [{ name: "expiry", type: "uint64" }],
    outputs: [
      { name: "settled", type: "bool" },
      { name: "price", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "findAnchorRound",
    stateMutability: "view",
    inputs: [{ name: "expiry", type: "uint64" }],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "price", type: "uint256" },
    ],
  },
] as const;

/**
 * Resolve the anchored settlement feed from a deployments file ("btcSettlementFeed").
 * Returns undefined when absent or zero — e.g. plain-anvil deployments, where settlement
 * stays on the signed forward feed.
 */
export function anchoredFeedFromDeployments(d: DeploymentsFile): Address | undefined {
  try {
    const addr = getDeployedAddress(d, "btcSettlementFeed");
    return BigInt(addr) === 0n ? undefined : addr;
  } catch {
    return undefined;
  }
}

export interface AnchoredFixResult {
  price: bigint;
  /** tx hash when this call had to fix the price; undefined if it was already fixed */
  txHash?: Hex;
}

/**
 * Ensure the anchored feed has a settlement price fixed for `expiry`: read it, and if not
 * yet settled call the permissionless fixSettlementPrice (binary search over Chainlink
 * round history on-chain, Pyth cross-check near expiry).
 */
export async function ensureAnchoredSettlementPrice(opts: {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: LocalAccount;
  feed: Address;
  expiry: bigint;
}): Promise<AnchoredFixResult> {
  const { publicClient, walletClient, account, feed, expiry } = opts;

  const [settled, existing] = await publicClient.readContract({
    address: feed,
    abi: anchoredSettlementFeedAbi,
    functionName: "getSettlementPrice",
    args: [expiry],
  });
  if (settled) return { price: existing };

  const txHash = await walletClient.writeContract({
    address: feed,
    abi: anchoredSettlementFeedAbi,
    functionName: "fixSettlementPrice",
    args: [expiry],
    account,
    chain: walletClient.chain ?? null,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`fixSettlementPrice(${expiry}) reverted (tx ${txHash})`);
  }

  const [nowSettled, price] = await publicClient.readContract({
    address: feed,
    abi: anchoredSettlementFeedAbi,
    functionName: "getSettlementPrice",
    args: [expiry],
  });
  if (!nowSettled) {
    throw new Error(`Anchored feed did not register a settlement price for expiry ${expiry}`);
  }
  return { price, txHash };
}
