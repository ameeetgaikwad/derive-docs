import {
  encodeAbiParameters,
  encodePacked,
  hashDomain,
  hashTypedData,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import {
  ACTION_TYPEHASH,
  ACTION_TYPES,
  MATCHING_DOMAIN_NAME,
  MATCHING_DOMAIN_VERSION,
  matchingDomain,
} from "./constants.js";

/**
 * Mirrors IActionVerifier.Action:
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

/** Minimal signer shape satisfied by viem LocalAccount and WalletClient-with-account. */
export interface TypedDataSigner {
  signTypedData(parameters: {
    domain: {
      name: string;
      version: string;
      chainId: number;
      verifyingContract: Address;
    };
    types: typeof ACTION_TYPES;
    primaryType: "Action";
    message: Action;
  }): Promise<Hex>;
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
 * signer defaults to owner — v1 has EOAs signing directly, no session keys).
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
 * Struct hash exactly as ActionVerifier._getActionHash:
 *   keccak256(abi.encode(ACTION_TYPEHASH, subaccountId, nonce, module,
 *                        keccak256(data), expiry, owner, signer))
 */
export function getActionStructHash(action: Action): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "address" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
      ],
      [
        ACTION_TYPEHASH,
        action.subaccountId,
        action.nonce,
        action.module,
        keccak256(action.data),
        action.expiry,
        action.owner,
        action.signer,
      ],
    ),
  );
}

/** EIP-712 domain separator for a Matching deployment. */
export function getDomainSeparator(chainId: number, matchingAddress: Address): Hex {
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

/** Final digest the contract verifies: keccak256(0x1901 || domainSeparator || structHash). */
export function getActionDigest(
  action: Action,
  chainId: number,
  matchingAddress: Address,
): Hex {
  return keccak256(
    encodePacked(
      ["bytes2", "bytes32", "bytes32"],
      ["0x1901", getDomainSeparator(chainId, matchingAddress), getActionStructHash(action)],
    ),
  );
}

/** Same digest via viem's typed-data path (used to cross-check encoding in tests). */
export function hashActionTypedData(
  action: Action,
  chainId: number,
  matchingAddress: Address,
): Hex {
  return hashTypedData({
    domain: matchingDomain(chainId, matchingAddress) as {
      name: string;
      version: string;
      chainId: number;
      verifyingContract: Address;
    },
    types: ACTION_TYPES,
    primaryType: "Action",
    message: action,
  });
}

/**
 * Sign an Action with a viem account (LocalAccount or any object exposing
 * signTypedData). Produces the signature Matching/ActionVerifier accepts via
 * SignatureChecker (standard EIP-712 / eth_signTypedData_v4 — no EIP-191 prefix).
 */
export async function signAction(params: {
  action: Action;
  signer: TypedDataSigner;
  chainId: number;
  matchingAddress: Address;
}): Promise<Hex> {
  const { action, signer, chainId, matchingAddress } = params;
  return signer.signTypedData({
    domain: {
      name: MATCHING_DOMAIN_NAME,
      version: MATCHING_DOMAIN_VERSION,
      chainId,
      verifyingContract: matchingAddress,
    },
    types: ACTION_TYPES,
    primaryType: "Action",
    message: action,
  });
}

// ---------------------------------------------------------------------------
// Module data encodings — each verified against the vendored interface struct
// the module abi.decode()s its action data into.
// ---------------------------------------------------------------------------

/**
 * IDepositModule.DepositData { uint amount; address asset; address managerForNewAccount; }
 * `amount` is in the wrapped token's native decimals (18 on BNB for BTCB/USDT).
 * Use subaccountId = 0 in the Action to open a new subaccount under
 * `managerForNewAccount`.
 */
export function encodeDepositData(params: {
  amount: bigint;
  asset: Address;
  managerForNewAccount: Address;
}): Hex {
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "amount", type: "uint256" },
          { name: "asset", type: "address" },
          { name: "managerForNewAccount", type: "address" },
        ],
      },
    ],
    [params],
  );
}

/**
 * IWithdrawalModule.WithdrawalData { address asset; uint assetAmount; }
 * NOTE: assetAmount is the *asset* (shares/18dp) amount passed to
 * IERC20BasedAsset.withdraw, not token-native units for CashAsset.
 */
export function encodeWithdrawData(params: { asset: Address; assetAmount: bigint }): Hex {
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "asset", type: "address" },
          { name: "assetAmount", type: "uint256" },
        ],
      },
    ],
    [params],
  );
}

export interface TransferItem {
  asset: Address;
  subId: bigint;
  amount: bigint; // int256, may be negative
}

/**
 * ITransferModule.TransferData {
 *   uint toAccountId; address managerForNewAccount; Transfers[] transfers;
 * }  with Transfers { address asset; uint subId; int amount; }
 * Only the `from` action encodes this; the `to` action data can be "0x"
 * (the recipient signs purely as proof of ownership).
 */
export function encodeTransferData(params: {
  toAccountId: bigint;
  managerForNewAccount: Address;
  transfers: TransferItem[];
}): Hex {
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "toAccountId", type: "uint256" },
          { name: "managerForNewAccount", type: "address" },
          {
            name: "transfers",
            type: "tuple[]",
            components: [
              { name: "asset", type: "address" },
              { name: "subId", type: "uint256" },
              { name: "amount", type: "int256" },
            ],
          },
        ],
      },
    ],
    [params],
  );
}

/**
 * ITradeModule.TradeData {
 *   address asset; uint subId; int limitPrice; int desiredAmount;
 *   uint worstFee; uint recipientId; bool isBid;
 * }
 * (TradeModule is deployed but dormant in v1; this matches the vendored
 * struct — note it differs from Derive-production docs.)
 */
export function encodeTradeData(params: {
  asset: Address;
  subId: bigint;
  limitPrice: bigint;
  desiredAmount: bigint;
  worstFee: bigint;
  recipientId: bigint;
  isBid: boolean;
}): Hex {
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "asset", type: "address" },
          { name: "subId", type: "uint256" },
          { name: "limitPrice", type: "int256" },
          { name: "desiredAmount", type: "int256" },
          { name: "worstFee", type: "uint256" },
          { name: "recipientId", type: "uint256" },
          { name: "isBid", type: "bool" },
        ],
      },
    ],
    [params],
  );
}

/**
 * ITradeModule.OrderData — the executor-supplied actionData for TradeModule
 * (not signed by users).
 */
export function encodeTradeOrderData(params: {
  takerAccount: bigint;
  takerFee: bigint;
  fillDetails: {
    filledAccount: bigint;
    amountFilled: bigint;
    price: bigint;
    fee: bigint;
  }[];
  managerData: Hex;
}): Hex {
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "takerAccount", type: "uint256" },
          { name: "takerFee", type: "uint256" },
          {
            name: "fillDetails",
            type: "tuple[]",
            components: [
              { name: "filledAccount", type: "uint256" },
              { name: "amountFilled", type: "uint256" },
              { name: "price", type: "int256" },
              { name: "fee", type: "uint256" },
            ],
          },
          { name: "managerData", type: "bytes" },
        ],
      },
    ],
    [params],
  );
}

/**
 * IBaseManager.ManagerData[] — feed updates piggybacked on a trade
 * (RfqModule._processManagerData / SubAccounts.submitTransfers managerData).
 */
export function encodeManagerData(items: { receiver: Address; data: Hex }[]): Hex {
  return encodeAbiParameters(
    [
      {
        type: "tuple[]",
        components: [
          { name: "receiver", type: "address" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
    [items],
  );
}
