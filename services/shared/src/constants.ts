import { keccak256, toHex, type Address, type Hex, type TypedDataDomain } from "viem";

/**
 * EIP-712 Action type string, verified against
 * protocol/lib/v2-matching/src/ActionVerifier.sol:
 *
 *   bytes32 public constant ACTION_TYPEHASH = keccak256(
 *     "Action(uint256 subaccountId,uint256 nonce,address module,bytes data,uint256 expiry,address owner,address signer)"
 *   );
 */
export const ACTION_TYPE_STRING =
  "Action(uint256 subaccountId,uint256 nonce,address module,bytes data,uint256 expiry,address owner,address signer)";

export const ACTION_TYPEHASH: Hex = keccak256(toHex(ACTION_TYPE_STRING));

/** viem typed-data definition matching ACTION_TYPE_STRING exactly. */
export const ACTION_TYPES = {
  Action: [
    { name: "subaccountId", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "module", type: "address" },
    { name: "data", type: "bytes" },
    { name: "expiry", type: "uint256" },
    { name: "owner", type: "address" },
    { name: "signer", type: "address" },
  ],
} as const;

/**
 * EIP-712 domain of the Matching contract, verified against
 * ActionVerifier.sol constructor: `EIP712("Matching", "1.0")`.
 * OpenZeppelin EIP712 includes (name, version, chainId, verifyingContract).
 */
export const MATCHING_DOMAIN_NAME = "Matching";
export const MATCHING_DOMAIN_VERSION = "1.0";

export function matchingDomain(chainId: number, matchingAddress: Address): TypedDataDomain {
  return {
    name: MATCHING_DOMAIN_NAME,
    version: MATCHING_DOMAIN_VERSION,
    chainId,
    verifyingContract: matchingAddress,
  };
}

/**
 * Feed data type string, verified against
 * protocol/lib/v2-core/src/feeds/BaseLyraFeed.sol:
 *
 *   bytes32 public constant FEED_DATA_TYPEHASH =
 *     keccak256("FeedData(bytes data,uint256 deadline,uint64 timestamp)");
 */
export const FEED_DATA_TYPE_STRING = "FeedData(bytes data,uint256 deadline,uint64 timestamp)";

export const FEED_DATA_TYPEHASH: Hex = keccak256(toHex(FEED_DATA_TYPE_STRING));

export const FEED_DATA_TYPES = {
  FeedData: [
    { name: "data", type: "bytes" },
    { name: "deadline", type: "uint256" },
    { name: "timestamp", type: "uint64" },
  ],
} as const;

/**
 * EIP-712 domain names/versions of the Lyra feeds, verified against the
 * constructors in protocol/lib/v2-core/src/feeds/*.sol
 * (all `BaseLyraFeed("<Name>", "1")`).
 */
export const FEED_DOMAINS = {
  spot: { name: "LyraSpotFeed", version: "1" },
  forward: { name: "LyraForwardFeed", version: "1" },
  vol: { name: "LyraVolFeed", version: "1" },
  rate: { name: "LyraRateFeed", version: "1" },
} as const;

export type FeedKind = keyof typeof FEED_DOMAINS;

export function feedDomain(
  kind: FeedKind,
  chainId: number,
  feedAddress: Address,
): TypedDataDomain {
  const { name, version } = FEED_DOMAINS[kind];
  return { name, version, chainId, verifyingContract: feedAddress };
}
