import type { Address, Hex, PublicClient, WalletClient } from "viem";
import type { LocalAccount } from "viem";
import { getDeployedAddress, requireDeployments, readMarketManifest, enabledMarkets } from "@hedge/shared";
import {
  immediateTransactionQueue,
  type TransactionQueue,
} from "./transactionQueue.js";

/** Hermes endpoint matching the currently deployed Pyth Core contract. Override during a reviewed upgrade. */
export const DEFAULT_HERMES_URL = "https://hermes.pyth.network";

const PRICE_ID_RE = /^0x[0-9a-fA-F]{64}$/;

/** Minimal IPyth ABI — fee quote + price update. */
export const pythAbi = [
  {
    type: "function",
    name: "getUpdateFee",
    stateMutability: "view",
    inputs: [{ name: "updateData", type: "bytes[]" }],
    outputs: [{ name: "feeAmount", type: "uint256" }],
  },
  {
    type: "function",
    name: "updatePriceFeeds",
    stateMutability: "payable",
    inputs: [{ name: "updateData", type: "bytes[]" }],
    outputs: [],
  },
] as const;

/** ISpotFeed.getSpot() — used to read back through the PythSpotFeed adapter. */
export const spotFeedAbi = [
  {
    type: "function",
    name: "getSpot",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "spotPrice", type: "uint256" },
      { name: "confidence", type: "uint256" },
    ],
  },
] as const;

export interface PythAddresses {
  /** the official Pyth contract on this chain */
  pyth: Address;
  /** Pyth price feed id (bytes32) */
  priceId: Hex;
  /** our PythSpotFeed adapter (optional — read back getSpot() after pushing) */
  adapter?: Address;
}

export interface PythMarketAddress {
  marketId: string;
  priceId: Hex;
  adapter?: Address;
}

export interface PythBatchAddresses {
  pyth: Address;
  markets: PythMarketAddress[];
}

export function pythMarketsFromManifest(chainId: number): PythBatchAddresses {
  const deployments = requireDeployments(chainId);
  const markets = enabledMarkets(readMarketManifest(chainId))
    .filter((market) => market.pythPriceId !== null && market.contracts !== null)
    .map((market) => ({
      marketId: market.id,
      priceId: market.pythPriceId!,
      adapter: market.contracts!.spotFeed,
    }));
  if (markets.length === 0) throw new Error(`no enabled Pyth markets on chain ${chainId}`);
  return { pyth: getDeployedAddress(deployments, "pyth"), markets };
}

/**
 * Resolve Pyth addresses from protocol/deployments/<chainId>.json
 * (keys: pyth, btcPythPriceId, btcPythSpotFeed).
 */
export function pythAddressesFromDeployments(chainId: number): PythAddresses {
  const d = requireDeployments(chainId);
  const priceId = d["btcPythPriceId"];
  if (typeof priceId !== "string" || !PRICE_ID_RE.test(priceId)) {
    throw new Error(`"btcPythPriceId" missing/invalid in deployments file for chain ${chainId}`);
  }
  let adapter: Address | undefined;
  try {
    adapter = getDeployedAddress(d, "btcPythSpotFeed");
  } catch {
    adapter = undefined;
  }
  return { pyth: getDeployedAddress(d, "pyth"), priceId: priceId as Hex, adapter };
}

export interface HermesUpdate {
  /** hex-encoded updateData blob for IPyth.updatePriceFeeds */
  data: Hex;
  /** parsed price (Pyth scaling: price * 10^expo) for logging */
  price?: { price: string; conf: string; expo: number; publishTime: number };
}

/** Fetch the latest signed price update for `priceId` from Hermes. */
export async function fetchHermesUpdate(
  priceId: Hex,
  hermesUrl: string = process.env.HERMES_URL ?? DEFAULT_HERMES_URL,
): Promise<HermesUpdate> {
  const batch = await fetchHermesUpdates([priceId], hermesUrl);
  return { data: batch.data[0]!, price: batch.prices.get(priceId.toLowerCase()) };
}

export interface HermesBatchUpdate {
  data: Hex[];
  prices: Map<string, NonNullable<HermesUpdate["price"]>>;
}

export interface PythFreshnessSelection {
  fresh: PythMarketAddress[];
  skipped: { marketId: string; age: bigint | null; reason: string }[];
}

/** Select only feeds whose source observation can still satisfy the on-chain adapter heartbeat. */
export function selectFreshPythMarkets(
  markets: PythMarketAddress[],
  prices: ReadonlyMap<string, NonNullable<HermesUpdate["price"]>>,
  now: bigint,
  maxAge: bigint,
): PythFreshnessSelection {
  const fresh: PythMarketAddress[] = [];
  const skipped: PythFreshnessSelection["skipped"] = [];
  for (const market of markets) {
    const price = prices.get(market.priceId.toLowerCase());
    if (!price) {
      skipped.push({ marketId: market.marketId, age: null, reason: "missing parsed Hermes price" });
      continue;
    }
    if (BigInt(price.price) <= 0n) {
      skipped.push({ marketId: market.marketId, age: null, reason: "non-positive Hermes price" });
      continue;
    }
    const publishTime = BigInt(price.publishTime);
    const age = now > publishTime ? now - publishTime : 0n;
    if (publishTime === 0n || age > maxAge) {
      skipped.push({ marketId: market.marketId, age, reason: "stale Hermes source" });
      continue;
    }
    fresh.push(market);
  }
  return { fresh, skipped };
}

/** Fetch one aggregate Pyth update for all enabled market ids. */
export async function fetchHermesUpdates(
  priceIds: Hex[],
  hermesUrl: string = process.env.HERMES_URL ?? DEFAULT_HERMES_URL,
): Promise<HermesBatchUpdate> {
  if (priceIds.length === 0) throw new Error("at least one Pyth price id is required");
  const query = priceIds.map((id) => `ids[]=${encodeURIComponent(id)}`).join("&");
  const url = `${hermesUrl}/v2/updates/price/latest?${query}&encoding=hex`;
  const headers = process.env.PYTH_API_KEY
    ? { Authorization: `Bearer ${process.env.PYTH_API_KEY}` }
    : undefined;
  const res = headers ? await fetch(url, { headers }) : await fetch(url);
  if (!res.ok) {
    throw new Error(`Hermes ${res.status} ${res.statusText} for ${url}`);
  }
  const json = (await res.json()) as {
    binary?: { data?: string[] };
    parsed?: {
      price?: { price: string; conf: string; expo: number; publish_time: number };
    }[];
  };
  const raw = json.binary?.data;
  if (!Array.isArray(raw) || raw.length === 0 || raw.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error("Hermes response missing binary update data");
  }
  const prices = new Map<string, NonNullable<HermesUpdate["price"]>>();
  for (const entry of json.parsed ?? []) {
    const p = entry.price;
    const id = (entry as { id?: string }).id;
    if (p && id) prices.set(`0x${id.replace(/^0x/, "")}`.toLowerCase(), {
      price: p.price, conf: p.conf, expo: p.expo, publishTime: p.publish_time,
    });
  }
  // Older test/dev Hermes responses omit parsed[].id for a single requested feed.
  const first = json.parsed?.[0]?.price;
  if (priceIds.length === 1 && first && prices.size === 0) {
    prices.set(priceIds[0]!.toLowerCase(), {
      price: first.price, conf: first.conf, expo: first.expo, publishTime: first.publish_time,
    });
  }
  return { data: raw.map((item) => (item.startsWith("0x") ? item : `0x${item}`) as Hex), prices };
}

/** Render a parsed Hermes price (price * 10^expo) as a decimal string. */
export function formatPythPrice(price: string, expo: number): string {
  const neg = price.startsWith("-");
  const digits = neg ? price.slice(1) : price;
  if (expo >= 0) return `${neg ? "-" : ""}${digits}${"0".repeat(expo)}`;
  const pad = digits.padStart(-expo + 1, "0");
  const whole = pad.slice(0, pad.length + expo);
  const frac = pad.slice(pad.length + expo).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/**
 * Submit a Hermes update to the on-chain Pyth contract (paying the update fee),
 * then (if an adapter address is known) read getSpot() back through PythSpotFeed.
 */
export async function pushPythUpdate(opts: {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: LocalAccount;
  addresses: PythAddresses;
  hermesUrl?: string;
  transactionQueue?: TransactionQueue;
}): Promise<{ txHash: Hex; spot?: { spotPrice: bigint; confidence: bigint } }> {
  const { publicClient, walletClient, account, addresses } = opts;

  const update = await fetchHermesUpdate(addresses.priceId, opts.hermesUrl);
  if (update.price) {
    console.log(
      `[oracle-feeds] hermes ${addresses.priceId.slice(0, 10)}… price=` +
        `${formatPythPrice(update.price.price, update.price.expo)} ` +
        `conf=${formatPythPrice(update.price.conf, update.price.expo)} ` +
        `publishTime=${update.price.publishTime}`,
    );
  }

  const fee = await publicClient.readContract({
    address: addresses.pyth,
    abi: pythAbi,
    functionName: "getUpdateFee",
    args: [[update.data]],
  });
  console.log(`[oracle-feeds] updatePriceFeeds fee=${fee} wei`);

  const queue = opts.transactionQueue ?? immediateTransactionQueue;
  const submitted = await queue.run(async () => {
    const hash = await walletClient.writeContract({
      address: addresses.pyth,
      abi: pythAbi,
      functionName: "updatePriceFeeds",
      args: [[update.data]],
      value: fee,
      account,
      chain: walletClient.chain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`updatePriceFeeds reverted: ${hash}`);
    }
    return { hash, blockNumber: receipt.blockNumber };
  });
  const txHash = submitted.hash;
  console.log(`[oracle-feeds] updatePriceFeeds mined: ${txHash} (block ${submitted.blockNumber})`);

  let spot: { spotPrice: bigint; confidence: bigint } | undefined;
  if (addresses.adapter) {
    const [spotPrice, confidence] = await publicClient.readContract({
      address: addresses.adapter,
      abi: spotFeedAbi,
      functionName: "getSpot",
    });
    spot = { spotPrice, confidence };
    console.log(
      `[oracle-feeds] PythSpotFeed(${addresses.adapter}).getSpot() = ` +
        `${spotPrice} (conf ${confidence})`,
    );
  }
  return { txHash, spot };
}

export async function pushPythUpdates(opts: {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: LocalAccount;
  addresses: PythBatchAddresses;
  hermesUrl?: string;
  transactionQueue?: TransactionQueue;
}): Promise<{ txHash: Hex; spots: Map<string, { spotPrice: bigint; confidence: bigint }> }> {
  const { publicClient, walletClient, account, addresses } = opts;
  const update = await fetchHermesUpdates(addresses.markets.map((market) => market.priceId), opts.hermesUrl);
  const fee = await publicClient.readContract({
    address: addresses.pyth,
    abi: pythAbi,
    functionName: "getUpdateFee",
    args: [update.data],
  });
  const marketIds = addresses.markets.map((market) => market.marketId).join(",");
  console.log(`[oracle-feeds] Pyth batch submitting markets=[${marketIds}] fee=${fee} wei`);
  const queue = opts.transactionQueue ?? immediateTransactionQueue;
  const txHash = await queue.run(async () => {
    const hash = await walletClient.writeContract({
      address: addresses.pyth,
      abi: pythAbi,
      functionName: "updatePriceFeeds",
      args: [update.data],
      value: fee,
      account,
      chain: walletClient.chain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`updatePriceFeeds reverted: ${hash}`);
    return hash;
  });

  const spots = new Map<string, { spotPrice: bigint; confidence: bigint }>();
  await Promise.all(addresses.markets.map(async (market) => {
    if (!market.adapter) return;
    const [spotPrice, confidence] = await publicClient.readContract({
      address: market.adapter,
      abi: spotFeedAbi,
      functionName: "getSpot",
    });
    spots.set(market.marketId, { spotPrice, confidence });
  }));
  console.log(
    `[oracle-feeds] Pyth batch mined tx=${txHash} markets=[${marketIds}] spots=[${
      [...spots.entries()].map(([marketId, spot]) => `${marketId}:${spot.spotPrice}`).join(",")
    }]`,
  );
  return { txHash, spots };
}

export async function oracleSignerReadiness(
  publicClient: PublicClient,
  address: Address,
  minimumBalance: bigint,
): Promise<{ ready: boolean; balance: bigint; minimumBalance: bigint }> {
  const balance = await publicClient.getBalance({ address });
  return { ready: balance >= minimumBalance, balance, minimumBalance };
}
