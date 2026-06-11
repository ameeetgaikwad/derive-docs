import type { Address, PublicClient } from "viem";
import {
  fromUnit,
  getDeployedAddress,
  lyraForwardFeedAbi,
  lyraRateFeedAbi,
  lyraSpotFeedAbi,
  lyraVolFeedAbi,
  type DeploymentsFile,
} from "@hedge/shared";
import type { MakerBotConfig } from "./config.js";

/** Market inputs for a single option (per expiry/strike). */
export interface MarketInputs {
  /** Forward price F, quote units (USDT). */
  forward: number;
  /** Annualized vol, e.g. 0.6. */
  vol: number;
  /** Continuously-compounded rate. */
  rate: number;
}

export interface PriceSource {
  getInputs(option: { expiry: bigint; strike: bigint }): Promise<MarketInputs>;
}

/**
 * Env-driven inputs: FORWARD_PRICE (or SPOT_PRICE as a proxy), IV, RATE.
 * Usable when feeds are not posted yet (e.g. unit tests, dry runs).
 */
export class EnvPriceSource implements PriceSource {
  constructor(private readonly cfg: MakerBotConfig) {
    if (cfg.forwardOverride === null && cfg.spotOverride === null) {
      throw new Error("EnvPriceSource requires FORWARD_PRICE or SPOT_PRICE");
    }
    if (cfg.ivOverride === null) throw new Error("EnvPriceSource requires IV");
  }

  async getInputs(): Promise<MarketInputs> {
    return {
      forward: (this.cfg.forwardOverride ?? this.cfg.spotOverride)!,
      vol: this.cfg.ivOverride!,
      rate: this.cfg.rate,
    };
  }
}

/**
 * On-chain inputs from the deployed Lyra-style feeds (verified against
 * protocol/lib/v2-core/src/feeds/*):
 *   forward: LyraForwardFeed.getForwardPrice(uint64 expiry) -> (uint price, uint conf)
 *   vol:     LyraVolFeed.getVol(uint128 strike, uint64 expiry) -> (uint vol, uint conf)
 *   rate:    LyraRateFeed.getInterestRate(uint64 expiry) -> (int rate, uint conf)
 * Falls back to LyraSpotFeed.getSpot() if the forward feed has no data for
 * the expiry, and to cfg.rate if the rate feed reverts. Env overrides
 * (FORWARD_PRICE/SPOT_PRICE/IV) win over feed reads per-field.
 */
export class ChainPriceSource implements PriceSource {
  private readonly spotFeed: Address;
  private readonly forwardFeed: Address;
  private readonly volFeed: Address;
  private readonly rateFeed: Address;

  constructor(
    private readonly client: PublicClient,
    deployments: DeploymentsFile,
    private readonly cfg: MakerBotConfig,
  ) {
    this.spotFeed = getDeployedAddress(deployments, "btcSpotFeed");
    this.forwardFeed = getDeployedAddress(deployments, "btcForwardFeed");
    this.volFeed = getDeployedAddress(deployments, "btcVolFeed");
    this.rateFeed = getDeployedAddress(deployments, "btcRateFeed");
  }

  async getInputs(option: { expiry: bigint; strike: bigint }): Promise<MarketInputs> {
    const [forward, vol, rate] = await Promise.all([
      this.getForward(option.expiry),
      this.getVol(option.strike, option.expiry),
      this.getRate(option.expiry),
    ]);
    return { forward, vol, rate };
  }

  private async getForward(expiry: bigint): Promise<number> {
    if (this.cfg.forwardOverride !== null) return this.cfg.forwardOverride;
    try {
      const [price] = await this.client.readContract({
        address: this.forwardFeed,
        abi: lyraForwardFeedAbi,
        functionName: "getForwardPrice",
        args: [expiry],
      });
      return Number(fromUnit(price));
    } catch (err) {
      if (this.cfg.spotOverride !== null) return this.cfg.spotOverride;
      const [spot] = await this.client.readContract({
        address: this.spotFeed,
        abi: lyraSpotFeedAbi,
        functionName: "getSpot",
      });
      console.warn(
        `[pricing] forward feed unavailable for expiry ${expiry} (${(err as Error).message?.split("\n")[0]}); using spot`,
      );
      return Number(fromUnit(spot));
    }
  }

  private async getVol(strike: bigint, expiry: bigint): Promise<number> {
    if (this.cfg.ivOverride !== null) return this.cfg.ivOverride;
    const [vol] = await this.client.readContract({
      address: this.volFeed,
      abi: lyraVolFeedAbi,
      functionName: "getVol",
      args: [strike, expiry],
    });
    return Number(fromUnit(vol));
  }

  private async getRate(expiry: bigint): Promise<number> {
    try {
      const [rate] = await this.client.readContract({
        address: this.rateFeed,
        abi: lyraRateFeedAbi,
        functionName: "getInterestRate",
        args: [expiry],
      });
      return Number(fromUnit(rate));
    } catch {
      return this.cfg.rate;
    }
  }
}

/** Env source when fully specified, else on-chain feeds. */
export function makePriceSource(
  cfg: MakerBotConfig,
  client: PublicClient | null,
  deployments: DeploymentsFile | null,
): PriceSource {
  const envComplete =
    (cfg.forwardOverride !== null || cfg.spotOverride !== null) && cfg.ivOverride !== null;
  if (envComplete) return new EnvPriceSource(cfg);
  if (!client || !deployments) {
    throw new Error(
      "Pricing needs either env overrides (FORWARD_PRICE/SPOT_PRICE + IV) or an RPC + deployments file",
    );
  }
  return new ChainPriceSource(client, deployments, cfg);
}
