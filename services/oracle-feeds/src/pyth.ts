import type { Address, Hex, PublicClient, WalletClient } from "viem";
import type { LocalAccount } from "viem";
import { getDeployedAddress, requireDeployments } from "@hedge/shared";

/** Hermes price-service endpoint (override with HERMES_URL). */
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
  const url = `${hermesUrl}/v2/updates/price/latest?ids[]=${priceId}&encoding=hex`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Hermes ${res.status} ${res.statusText} for ${url}`);
  }
  const json = (await res.json()) as {
    binary?: { data?: string[] };
    parsed?: {
      price?: { price: string; conf: string; expo: number; publish_time: number };
    }[];
  };
  const raw = json.binary?.data?.[0];
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error("Hermes response missing binary update data");
  }
  const p = json.parsed?.[0]?.price;
  return {
    data: (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex,
    price: p
      ? { price: p.price, conf: p.conf, expo: p.expo, publishTime: p.publish_time }
      : undefined,
  };
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

  const txHash = await walletClient.writeContract({
    address: addresses.pyth,
    abi: pythAbi,
    functionName: "updatePriceFeeds",
    args: [[update.data]],
    value: fee,
    account,
    chain: walletClient.chain,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`updatePriceFeeds reverted: ${txHash}`);
  }
  console.log(`[oracle-feeds] updatePriceFeeds mined: ${txHash} (block ${receipt.blockNumber})`);

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
