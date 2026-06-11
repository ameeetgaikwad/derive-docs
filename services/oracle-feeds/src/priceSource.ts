import type { Address, PublicClient } from "viem";
import { toUnit } from "@sats-options/shared";

/** Spot price source. Prices are 18dp (the protocol's internal unit). */
export interface PriceSource {
  /** Current spot price, 18 decimals. */
  getSpotPrice(): Promise<bigint>;
  readonly name: string;
}

/** Fixed price — used on anvil / in e2e (env SPOT_PRICE or CLI --spot). */
export class StaticPriceSource implements PriceSource {
  readonly name = "static";
  constructor(private readonly price18: bigint) {
    if (price18 <= 0n) throw new Error("StaticPriceSource: price must be > 0");
  }
  async getSpotPrice(): Promise<bigint> {
    return this.price18;
  }
}

/** Minimal Chainlink AggregatorV3Interface ABI (BSC deploys standard aggregators). */
const aggregatorV3Abi = [
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "latestRoundData",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
    stateMutability: "view",
  },
] as const;

/**
 * Chainlink-on-BSC source (stub for BSC testnet/mainnet — NOT used on anvil).
 * Reads latestRoundData from an AggregatorV3 (e.g. BTC/USD on BSC) and scales
 * the answer to 18dp. Wire it up via PRICE_SOURCE=chainlink +
 * CHAINLINK_AGGREGATOR=<address>.
 */
export class ChainlinkBscPriceSource implements PriceSource {
  readonly name = "chainlink-bsc";
  private decimalsCache: number | null = null;

  constructor(
    private readonly client: PublicClient,
    private readonly aggregator: Address,
    private readonly maxStaleSec = 3600n,
  ) {}

  async getSpotPrice(): Promise<bigint> {
    const [decimals, round] = await Promise.all([
      this.getDecimals(),
      this.client.readContract({
        address: this.aggregator,
        abi: aggregatorV3Abi,
        functionName: "latestRoundData",
      }),
    ]);
    const [, answer, , updatedAt] = round;
    if (answer <= 0n) throw new Error(`Chainlink answer not positive: ${answer}`);
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (updatedAt + this.maxStaleSec < now) {
      throw new Error(`Chainlink round stale: updatedAt=${updatedAt}, now=${now}`);
    }
    return decimals <= 18
      ? answer * 10n ** BigInt(18 - decimals)
      : answer / 10n ** BigInt(decimals - 18);
  }

  private async getDecimals(): Promise<number> {
    if (this.decimalsCache === null) {
      this.decimalsCache = await this.client.readContract({
        address: this.aggregator,
        abi: aggregatorV3Abi,
        functionName: "decimals",
      });
    }
    return this.decimalsCache;
  }
}

/**
 * PRICE_SOURCE=static (default) uses SPOT_PRICE (decimal string, e.g. "100000").
 * PRICE_SOURCE=chainlink uses CHAINLINK_AGGREGATOR on the connected chain.
 */
export function priceSourceFromEnv(client: PublicClient): PriceSource {
  const kind = process.env.PRICE_SOURCE ?? "static";
  if (kind === "chainlink") {
    const aggregator = process.env.CHAINLINK_AGGREGATOR;
    if (!aggregator) throw new Error("PRICE_SOURCE=chainlink requires CHAINLINK_AGGREGATOR");
    return new ChainlinkBscPriceSource(client, aggregator as Address);
  }
  if (kind === "static") {
    const spot = process.env.SPOT_PRICE;
    if (!spot) {
      throw new Error("PRICE_SOURCE=static requires SPOT_PRICE (or pass --spot on the CLI)");
    }
    return new StaticPriceSource(toUnit(spot));
  }
  throw new Error(`Unknown PRICE_SOURCE "${kind}" (expected static | chainlink)`);
}
