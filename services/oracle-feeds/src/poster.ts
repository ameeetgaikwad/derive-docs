import type { Address, Hex, PublicClient, WalletClient } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import {
  encodeForwardData,
  encodeRateData,
  encodeSpotData,
  encodeVolData,
  getDeployedAddress,
  lyraForwardFeedAbi,
  lyraRateFeedAbi,
  lyraSpotFeedAbi,
  lyraVolFeedAbi,
  requireDeployments,
  signFeedData,
  toUnit,
  type FeedKind,
} from "@sats-options/shared";
import { annualise, flatIvSviParams, type SviParams } from "./svi.js";

const ONE = 10n ** 18n;

/** 30 minutes — LyraForwardFeed.SETTLEMENT_TWAP_DURATION. */
export const SETTLEMENT_TWAP_DURATION = 1800n;

export interface FeedAddresses {
  spotFeed: Address;
  forwardFeed: Address;
  volFeed: Address;
  rateFeed: Address;
}

/** Resolve the BTC market's feed addresses from protocol/deployments/<chainId>.json. */
export function feedAddressesFromDeployments(chainId: number): FeedAddresses {
  const d = requireDeployments(chainId);
  return {
    spotFeed: getDeployedAddress(d, "btcSpotFeed"),
    forwardFeed: getDeployedAddress(d, "btcForwardFeed"),
    volFeed: getDeployedAddress(d, "btcVolFeed"),
    rateFeed: getDeployedAddress(d, "btcRateFeed"),
  };
}

const FEED_ABIS = {
  spot: lyraSpotFeedAbi,
  forward: lyraForwardFeedAbi,
  vol: lyraVolFeedAbi,
  rate: lyraRateFeedAbi,
} as const;

export interface SnapshotExpiryParams {
  expiry: bigint; // unix seconds
  /** 18dp forward price; defaults to spot */
  forwardPrice?: bigint;
  /** 18dp flat IV for the SVI surface; default 0.6 (60%) */
  iv?: bigint;
  /** 18dp annualized rate; default 0.05 */
  rate?: bigint;
}

export interface SnapshotParams {
  spot: bigint; // 18dp
  confidence?: bigint; // 18dp, default 1e18
  expiries?: SnapshotExpiryParams[];
}

/**
 * Signs FeedData payloads (EIP-712, per BaseLyraFeed) and posts them on-chain
 * via each feed's acceptData(bytes). The signer must be whitelisted on every
 * feed (deploy script calls addSigner(feedSigner, true)).
 */
export class FeedPoster {
  constructor(
    private readonly publicClient: PublicClient,
    private readonly walletClient: WalletClient,
    private readonly signer: PrivateKeyAccount,
    private readonly chainId: number,
    private readonly addresses: FeedAddresses,
    private readonly deadlineSec: bigint = 3600n,
  ) {}

  /** Latest block timestamp — chain time, NOT wall clock (anvil warps). */
  async chainNow(): Promise<bigint> {
    const block = await this.publicClient.getBlock();
    return block.timestamp;
  }

  private async acceptData(kind: FeedKind, data: Hex, timestamp: bigint): Promise<Hex> {
    const now = await this.chainNow();
    const encoded = await signFeedData({
      kind,
      payload: { data, deadline: now + this.deadlineSec, timestamp },
      signers: [this.signer],
      chainId: this.chainId,
      feedAddress: this.addressFor(kind),
    });
    // acceptData is permissionless (BaseLyraFeed only verifies the embedded
    // signer signatures), so the tx is sent from the wallet client's account
    // (the funded poster, e.g. the deployer on testnet) — the feed signer key
    // only signs the FeedData payload and needs no gas.
    const hash = await this.walletClient.writeContract({
      address: this.addressFor(kind),
      abi: FEED_ABIS[kind],
      functionName: "acceptData",
      args: [encoded],
      account: this.walletClient.account ?? this.signer,
      chain: this.walletClient.chain ?? null,
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`${kind} feed acceptData reverted (tx ${hash})`);
    }
    return hash;
  }

  private addressFor(kind: FeedKind): Address {
    switch (kind) {
      case "spot":
        return this.addresses.spotFeed;
      case "forward":
        return this.addresses.forwardFeed;
      case "vol":
        return this.addresses.volFeed;
      case "rate":
        return this.addresses.rateFeed;
    }
  }

  /** Post spot price (18dp; must fit uint96). */
  async postSpot(price: bigint, confidence: bigint = ONE): Promise<Hex> {
    const timestamp = await this.chainNow();
    return this.acceptData("spot", encodeSpotData({ price, confidence }), timestamp);
  }

  /**
   * Post a forward price for an expiry (pre-settlement path: aggregates 0).
   * fwdSpotDifference = forward - currentSpot, vs the spot stored in the feed.
   */
  async postForward(
    expiry: bigint,
    forwardPrice: bigint,
    confidence: bigint = ONE,
  ): Promise<Hex> {
    const timestamp = await this.chainNow();
    if (timestamp >= expiry - SETTLEMENT_TWAP_DURATION) {
      throw new Error(
        `postForward: within ${SETTLEMENT_TWAP_DURATION}s of expiry ${expiry} — ` +
          `the feed requires settlement aggregates now; use postSettlement instead`,
      );
    }
    const spot = await this.readSpot();
    const data = encodeForwardData({
      expiry,
      settlementStartAggregate: 0n,
      currentSpotAggregate: 0n,
      fwdSpotDifference: forwardPrice - spot, // int96
      confidence,
    });
    return this.acceptData("forward", data, timestamp);
  }

  /**
   * Fix the settlement price for an expiry. Mirrors the vendored
   * IntegrationTestBase._setSettlementPrice:
   *   feedData.timestamp == expiry (required by getSettlementPrice),
   *   currentSpotAggregate - settlementStartAggregate == price * TWAP_DURATION,
   * so getSettlementPrice(expiry) returns exactly `price`.
   * Requires chain time >= expiry (acceptData rejects future timestamps).
   */
  async postSettlement(expiry: bigint, price: bigint, confidence: bigint = ONE): Promise<Hex> {
    const now = await this.chainNow();
    if (now < expiry) {
      throw new Error(
        `postSettlement: chain time ${now} is before expiry ${expiry}; warp/wait first`,
      );
    }
    // Once timestamp == expiry the settlement price comes purely from the
    // aggregates; the spot diff is irrelevant. The cached spot may be stale
    // after a time warp, so fall back to the settlement price (diff = 0).
    const spot = await this.readSpot().catch(() => price);
    const data = encodeForwardData({
      expiry,
      settlementStartAggregate: price * (expiry - SETTLEMENT_TWAP_DURATION),
      currentSpotAggregate: price * expiry,
      fwdSpotDifference: price - spot,
      confidence,
    });
    return this.acceptData("forward", data, expiry);
  }

  /** Post annualized interest rate (18dp, int96) for an expiry. */
  async postRate(expiry: bigint, rate: bigint, confidence: bigint = ONE): Promise<Hex> {
    const timestamp = await this.chainNow();
    return this.acceptData("rate", encodeRateData({ expiry, rate, confidence }), timestamp);
  }

  /** Post raw SVI params for an expiry. */
  async postVolSvi(expiry: bigint, svi: SviParams, confidence: bigint = ONE): Promise<Hex> {
    const timestamp = await this.chainNow();
    if (timestamp > expiry) {
      throw new Error(`postVol: chain time ${timestamp} past expiry ${expiry}`);
    }
    const data = encodeVolData({ expiry, ...svi, confidence });
    return this.acceptData("vol", data, timestamp);
  }

  /** Post a flat-IV SVI surface (default 60%) for an expiry. */
  async postFlatVol(
    expiry: bigint,
    iv: bigint = toUnit("0.6"),
    forwardPrice?: bigint,
    confidence: bigint = ONE,
  ): Promise<Hex> {
    const now = await this.chainNow();
    const fwd = forwardPrice ?? (await this.readForward(expiry));
    const tau = annualise(expiry - now);
    return this.postVolSvi(expiry, flatIvSviParams(iv, fwd, tau), confidence);
  }

  /**
   * One-shot snapshot: spot, then per expiry forward -> rate -> vol.
   * This is the e2e entrypoint.
   */
  async postSnapshot(params: SnapshotParams): Promise<void> {
    const conf = params.confidence ?? ONE;
    const spotTx = await this.postSpot(params.spot, conf);
    log(`spot   ${fmt(params.spot)}  tx=${spotTx}`);

    for (const e of params.expiries ?? []) {
      const fwd = e.forwardPrice ?? params.spot;
      const fwdTx = await this.postForward(e.expiry, fwd, conf);
      log(`fwd    expiry=${e.expiry} ${fmt(fwd)}  tx=${fwdTx}`);

      const rate = e.rate ?? toUnit("0.05");
      const rateTx = await this.postRate(e.expiry, rate, conf);
      log(`rate   expiry=${e.expiry} ${fmt(rate)}  tx=${rateTx}`);

      const iv = e.iv ?? toUnit("0.6");
      const volTx = await this.postFlatVol(e.expiry, iv, fwd, conf);
      log(`vol    expiry=${e.expiry} flatIV=${fmt(iv)}  tx=${volTx}`);
    }
  }

  async readSpot(): Promise<bigint> {
    const [price] = await this.publicClient.readContract({
      address: this.addresses.spotFeed,
      abi: lyraSpotFeedAbi,
      functionName: "getSpot",
    });
    return price;
  }

  async readForward(expiry: bigint): Promise<bigint> {
    const [price] = await this.publicClient.readContract({
      address: this.addresses.forwardFeed,
      abi: lyraForwardFeedAbi,
      functionName: "getForwardPrice",
      args: [expiry],
    });
    return price;
  }

  async readSettlementPrice(expiry: bigint): Promise<{ settled: boolean; price: bigint }> {
    const [settled, price] = await this.publicClient.readContract({
      address: this.addresses.forwardFeed,
      abi: lyraForwardFeedAbi,
      functionName: "getSettlementPrice",
      args: [expiry],
    });
    return { settled, price };
  }
}

function fmt(v: bigint): string {
  const whole = v / ONE;
  const frac = v % ONE;
  return frac === 0n ? whole.toString() : `${whole}.${frac.toString().padStart(18, "0").replace(/0+$/, "")}`;
}

function log(msg: string): void {
  console.log(`[oracle-feeds] ${msg}`);
}
