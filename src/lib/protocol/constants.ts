import {
  hashDomain,
  keccak256,
  toHex,
  type Address,
  type Hex,
  type TypedDataDomain,
} from "viem";
import {
  ADDRESSES,
  CHAIN_ID,
  EXPECTED_ACTION_TYPEHASH,
  EXPECTED_DOMAIN_SEPARATOR,
} from "./deployments";

/**
 * EIP-712 Action type, verified against
 * protocol/lib/v2-matching/src/ActionVerifier.sol:
 *
 *   bytes32 public constant ACTION_TYPEHASH = keccak256(
 *     "Action(uint256 subaccountId,uint256 nonce,address module,bytes data,uint256 expiry,address owner,address signer)"
 *   );
 *
 * Same definition as services/shared/src/constants.ts.
 */
export const ACTION_TYPE_STRING =
  "Action(uint256 subaccountId,uint256 nonce,address module,bytes data,uint256 expiry,address owner,address signer)";

export const ACTION_TYPEHASH: Hex = keccak256(toHex(ACTION_TYPE_STRING));

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
 * EIP-712 domain of the Matching contract:
 * ActionVerifier constructor is `EIP712("Matching", "1.0")` and OpenZeppelin
 * EIP712 includes (name, version, chainId, verifyingContract).
 */
export const MATCHING_DOMAIN_NAME = "Matching";
export const MATCHING_DOMAIN_VERSION = "1.0";

export function matchingDomain(
  chainId: number = CHAIN_ID,
  matchingAddress: Address = ADDRESSES.matching
): TypedDataDomain {
  return {
    name: MATCHING_DOMAIN_NAME,
    version: MATCHING_DOMAIN_VERSION,
    chainId,
    verifyingContract: matchingAddress,
  };
}

/** EIP-712 domain separator, computed locally (matches Matching.domainSeparator()). */
export function computeDomainSeparator(
  chainId: number = CHAIN_ID,
  matchingAddress: Address = ADDRESSES.matching
): Hex {
  return hashDomain({
    domain: {
      name: MATCHING_DOMAIN_NAME,
      version: MATCHING_DOMAIN_VERSION,
      chainId: BigInt(chainId),
      verifyingContract: matchingAddress,
    },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
    },
  });
}

/**
 * Dev-time sanity check, run at module init: our locally computed EIP-712
 * domain separator and Action typehash must match the on-chain-verified
 * values recorded in protocol/deployments/97.json. Catches any drift between
 * the frontend signing code and the deployed Matching contract immediately.
 */
function assertDomainIntegrity(): void {
  const computed = computeDomainSeparator();
  if (computed !== EXPECTED_DOMAIN_SEPARATOR) {
    throw new Error(
      `sats-options: computed Matching domain separator ${computed} does not match ` +
        `deployments/97.json ${EXPECTED_DOMAIN_SEPARATOR} — signing would produce invalid signatures`
    );
  }
  if (ACTION_TYPEHASH !== EXPECTED_ACTION_TYPEHASH) {
    throw new Error(
      `sats-options: computed ACTION_TYPEHASH ${ACTION_TYPEHASH} does not match ` +
        `deployments/97.json ${EXPECTED_ACTION_TYPEHASH}`
    );
  }
}

if (process.env.NODE_ENV !== "production") {
  assertDomainIntegrity();
}
