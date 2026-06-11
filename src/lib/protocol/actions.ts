import type { Address, Hex } from "viem";
import { ACTION_TYPES, MATCHING_DOMAIN_NAME, MATCHING_DOMAIN_VERSION } from "./constants";
import { ADDRESSES, CHAIN_ID } from "./deployments";

/**
 * Mirrors IActionVerifier.Action (protocol/lib/v2-matching), field-for-field
 * identical to services/shared/src/actions.ts:
 *
 *   struct Action {
 *     uint subaccountId; uint nonce; IMatchingModule module;
 *     bytes data; uint expiry; address owner; address signer;
 *   }
 */
export interface Action {
  subaccountId: bigint;
  nonce: bigint;
  module: Address;
  data: Hex;
  expiry: bigint;
  owner: Address;
  signer: Address;
}

/** Millisecond-timestamp-based nonce, unique enough for off-chain order flow. */
export function generateNonce(): bigint {
  return BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
}

/** Unix-seconds expiry, `durationSeconds` from now (default 10 minutes). */
export function getActionExpiry(durationSeconds = 600): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + durationSeconds);
}

/**
 * Build an Action with sensible defaults (fresh nonce, 10-minute expiry,
 * signer == owner — v1 has EOAs signing directly, no session keys).
 */
export function buildAction(params: {
  subaccountId: bigint;
  module: Address;
  data: Hex;
  owner: Address;
  signer?: Address;
  nonce?: bigint;
  expiry?: bigint;
}): Action {
  return {
    subaccountId: params.subaccountId,
    nonce: params.nonce ?? generateNonce(),
    module: params.module,
    data: params.data,
    expiry: params.expiry ?? getActionExpiry(),
    owner: params.owner,
    signer: params.signer ?? params.owner,
  };
}

/**
 * The exact wagmi/viem `signTypedData` parameters for an Action against our
 * Matching deployment (standard eth_signTypedData_v4 — the signature is
 * verified by ActionVerifier via SignatureChecker, no EIP-191 prefix).
 */
export function actionTypedData(action: Action) {
  return {
    domain: {
      name: MATCHING_DOMAIN_NAME,
      version: MATCHING_DOMAIN_VERSION,
      chainId: CHAIN_ID,
      verifyingContract: ADDRESSES.matching,
    },
    types: ACTION_TYPES,
    primaryType: "Action" as const,
    message: action,
  };
}

/** JSON-safe wire form the rfq-engine expects (bigints as decimal strings). */
export interface SerializedAction {
  subaccountId: string;
  nonce: string;
  module: string;
  data: string;
  expiry: string;
  owner: string;
  signer: string;
}

export function serializeAction(action: Action): SerializedAction {
  return {
    subaccountId: action.subaccountId.toString(),
    nonce: action.nonce.toString(),
    module: action.module,
    data: action.data,
    expiry: action.expiry.toString(),
    owner: action.owner,
    signer: action.signer,
  };
}
