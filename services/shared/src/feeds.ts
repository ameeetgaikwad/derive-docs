import {
  encodeAbiParameters,
  hashTypedData,
  type Address,
  type Hex,
} from "viem";
import { FEED_DATA_TYPES, FEED_DOMAINS, type FeedKind } from "./constants.js";

/**
 * Feed data signing per protocol/lib/v2-core/src/feeds/BaseLyraFeed.sol.
 *
 * acceptData(bytes) decodes IBaseLyraFeed.FeedData:
 *   { bytes data; uint deadline; uint64 timestamp; address[] signers; bytes[] signatures; }
 * and each signature must be EIP-712 over
 *   FeedData(bytes data,uint256 deadline,uint64 timestamp)
 * in the feed's own domain (name per feed, version "1", chainId, feed address).
 */

export interface FeedDataPayload {
  data: Hex;
  deadline: bigint;
  timestamp: bigint; // uint64
}

export interface FeedSigner {
  address: Address;
  signTypedData(parameters: {
    domain: { name: string; version: string; chainId: number; verifyingContract: Address };
    types: typeof FEED_DATA_TYPES;
    primaryType: "FeedData";
    message: { data: Hex; deadline: bigint; timestamp: bigint };
  }): Promise<Hex>;
}

/** EIP-712 digest a feed signer must sign (handy for tests / recovery). */
export function hashFeedData(
  kind: FeedKind,
  payload: FeedDataPayload,
  chainId: number,
  feedAddress: Address,
): Hex {
  const { name, version } = FEED_DOMAINS[kind];
  return hashTypedData({
    domain: { name, version, chainId, verifyingContract: feedAddress },
    types: FEED_DATA_TYPES,
    primaryType: "FeedData",
    message: payload,
  });
}

/**
 * Sign a feed payload with one or more signers and ABI-encode the full
 * FeedData struct, ready to pass to `feed.acceptData(bytes)` (directly or via
 * managerData -> IDataReceiver.acceptData).
 */
export async function signFeedData(params: {
  kind: FeedKind;
  payload: FeedDataPayload;
  signers: FeedSigner[];
  chainId: number;
  feedAddress: Address;
}): Promise<Hex> {
  const { name, version } = FEED_DOMAINS[params.kind];
  const domain = {
    name,
    version,
    chainId: params.chainId,
    verifyingContract: params.feedAddress,
  };

  const signatures: Hex[] = [];
  for (const signer of params.signers) {
    signatures.push(
      await signer.signTypedData({
        domain,
        types: FEED_DATA_TYPES,
        primaryType: "FeedData",
        message: params.payload,
      }),
    );
  }

  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "data", type: "bytes" },
          { name: "deadline", type: "uint256" },
          { name: "timestamp", type: "uint64" },
          { name: "signers", type: "address[]" },
          { name: "signatures", type: "bytes[]" },
        ],
      },
    ],
    [
      {
        data: params.payload.data,
        deadline: params.payload.deadline,
        timestamp: params.payload.timestamp,
        signers: params.signers.map((s) => s.address),
        signatures,
      },
    ],
  );
}

// ---------------------------------------------------------------------------
// Inner `data` encodings per feed — verified against each acceptData().
// ---------------------------------------------------------------------------

/** LyraSpotFeed: abi.decode(data, (uint96 price, uint64 confidence)) — 18dp price. */
export function encodeSpotData(params: { price: bigint; confidence: bigint }): Hex {
  return encodeAbiParameters(
    [{ type: "uint96" }, { type: "uint64" }],
    [params.price, params.confidence],
  );
}

/**
 * LyraForwardFeed: abi.decode(data,
 *   (uint64 expiry, uint settlementStartAggregate, uint currentSpotAggregate,
 *    int96 fwdSpotDifference, uint64 confidence))
 * Aggregates are sum(spot * time); only required once
 * timestamp >= expiry - 30 minutes (settlement window).
 */
export function encodeForwardData(params: {
  expiry: bigint;
  settlementStartAggregate: bigint;
  currentSpotAggregate: bigint;
  fwdSpotDifference: bigint; // int96: forward - spot
  confidence: bigint;
}): Hex {
  return encodeAbiParameters(
    [
      { type: "uint64" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "int96" },
      { type: "uint64" },
    ],
    [
      params.expiry,
      params.settlementStartAggregate,
      params.currentSpotAggregate,
      params.fwdSpotDifference,
      params.confidence,
    ],
  );
}

/**
 * LyraVolFeed: abi.decode(data,
 *   (uint64 expiry, int SVI_a, uint SVI_b, int SVI_rho, int SVI_m,
 *    uint SVI_sigma, uint SVI_fwd, uint64 SVI_refTau, uint64 confidence))
 * All SVI params 18dp. SVI_refTau is time-to-expiry in years, 18dp, packed
 * into uint64 (per SVI.getVol's `uint64 tau` divideDecimal usage — max ~18.4y).
 */
export function encodeVolData(params: {
  expiry: bigint;
  SVI_a: bigint;
  SVI_b: bigint;
  SVI_rho: bigint;
  SVI_m: bigint;
  SVI_sigma: bigint;
  SVI_fwd: bigint;
  SVI_refTau: bigint;
  confidence: bigint;
}): Hex {
  return encodeAbiParameters(
    [
      { type: "uint64" },
      { type: "int256" },
      { type: "uint256" },
      { type: "int256" },
      { type: "int256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint64" },
      { type: "uint64" },
    ],
    [
      params.expiry,
      params.SVI_a,
      params.SVI_b,
      params.SVI_rho,
      params.SVI_m,
      params.SVI_sigma,
      params.SVI_fwd,
      params.SVI_refTau,
      params.confidence,
    ],
  );
}

/** LyraRateFeed: abi.decode(data, (uint64 expiry, int96 rate, uint64 confidence)). */
export function encodeRateData(params: {
  expiry: bigint;
  rate: bigint; // int96, 18dp annualized
  confidence: bigint;
}): Hex {
  return encodeAbiParameters(
    [{ type: "uint64" }, { type: "int96" }, { type: "uint64" }],
    [params.expiry, params.rate, params.confidence],
  );
}
