import type { Address, Hex } from "viem";
import { ACTION_TYPES, MATCHING_DOMAIN_NAME, MATCHING_DOMAIN_VERSION } from "./constants";

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

/** Cryptographically random uint256 nonce for replay-protected actions. */
export function generateNonce(): bigint {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Secure randomness is unavailable; cannot create an action nonce");
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  let nonce = 0n;
  for (const byte of bytes) nonce = (nonce << 8n) | BigInt(byte);
  return nonce;
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
 *
 * chainId + matching address are passed explicitly so signing always targets
 * the active network's deployment.
 */
export function actionTypedData(
  action: Action,
  chainId: number,
  matchingAddress: Address
) {
  return {
    domain: {
      name: MATCHING_DOMAIN_NAME,
      version: MATCHING_DOMAIN_VERSION,
      chainId,
      verifyingContract: matchingAddress,
    },
    types: ACTION_TYPES,
    primaryType: "Action" as const,
    // Send uint fields as decimal strings at the wallet boundary. They hash to
    // the same EIP-712 values as bigint inputs, while avoiding providers that
    // serialize JavaScript bigint values as invalid strings such as `"5n"`.
    message: {
      ...action,
      subaccountId: action.subaccountId.toString(),
      nonce: action.nonce.toString(),
      expiry: action.expiry.toString(),
    } as unknown as Action,
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
