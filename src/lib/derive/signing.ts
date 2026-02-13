import {
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  encodePacked,
  signatureToHex,
  type Hex,
} from "viem";
import { privateKeyToAccount, sign } from "viem/accounts";
import { getConfig, ACTION_TYPEHASH, type DeriveEnv } from "./constants";

/**
 * Get the pre-computed domain separator for the given environment.
 * These are derived from Matching.sol using EIP-712:
 *   keccak256(abi.encode(DOMAIN_TYPEHASH, name, version, chainId, verifyingContract))
 * where verifyingContract is the Matching.sol address on each chain.
 */
export function getDomainSeparator(env?: DeriveEnv): Hex {
  return getConfig(env).domainSeparator;
}

/**
 * Encode trade data for the trade module.
 * ABI encode per Derive docs: (address asset, uint subId, int limitPrice, int amount, uint maxFee, uint subaccountId, bool isBid)
 * Note: limitPrice comes BEFORE amount, and the boolean is isBid (direction), not isReduceOnly.
 */
export function encodeTradeData(params: {
  assetAddress: Hex;
  subId: bigint;
  limitPrice: bigint; // 18 decimals
  amount: bigint; // Positive value, 18 decimals
  maxFee: bigint; // 18 decimals
  subaccountId: bigint;
  isBid: boolean; // true for buy, false for sell
}): Hex {
  return encodeAbiParameters(
    parseAbiParameters("address, uint256, int256, int256, uint256, uint256, bool"),
    [
      params.assetAddress,
      params.subId,
      params.limitPrice,
      params.amount,
      params.maxFee,
      params.subaccountId,
      params.isBid,
    ]
  );
}

/**
 * Scale a human-readable amount to token decimals.
 * e.g., toTokenAmount("100", 6) → 100000000n (USDC has 6 decimals)
 */
export function toTokenAmount(value: string, decimals: number): bigint {
  const [intPart, decPart = ""] = value.split(".");
  const paddedDec = decPart.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(intPart) * BigInt(10 ** decimals) + BigInt(paddedDec);
}

/**
 * Encode deposit data for the deposit module.
 * ABI encode: (uint256 amount, address asset, address managerForNewAccount)
 * Amount must be scaled to the token's native decimals (6 for USDC).
 */
export function encodeDepositData(params: {
  amount: bigint; // Token-native decimals (6 for USDC)
  asset: Hex; // USDC contract address on Derive chain
  managerForNewAccount: Hex; // StandardManager address (for new accounts)
}): Hex {
  return encodeAbiParameters(
    parseAbiParameters("uint256, address, address"),
    [params.amount, params.asset, params.managerForNewAccount]
  );
}

/**
 * Encode withdraw data for the withdrawal module.
 * ABI encode: (address asset, uint256 amount) — address FIRST per Derive SDK.
 * Amount must be scaled to the token's native decimals (6 for USDC).
 */
export function encodeWithdrawData(params: {
  amount: bigint; // Token-native decimals (6 for USDC)
  asset: Hex; // USDC contract address on Derive chain
}): Hex {
  return encodeAbiParameters(
    parseAbiParameters("address, uint256"),
    [params.asset, params.amount]
  );
}

/**
 * Compute the EIP-712 action hash.
 */
export function getActionHash(params: {
  subaccountId: bigint;
  nonce: bigint;
  module: Hex;
  data: Hex;
  expiry: bigint;
  owner: Hex;
  signer: Hex;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "bytes32, uint256, uint256, address, bytes32, uint256, address, address"
      ),
      [
        ACTION_TYPEHASH,
        params.subaccountId,
        params.nonce,
        params.module,
        keccak256(params.data),
        params.expiry,
        params.owner,
        params.signer,
      ]
    )
  );
}

/**
 * Compute the final EIP-712 typed data hash: keccak256(0x1901 || domainSeparator || actionHash)
 */
export function toTypedDataHash(domainSeparator: Hex, actionHash: Hex): Hex {
  return keccak256(
    encodePacked(["bytes2", "bytes32", "bytes32"], ["0x1901", domainSeparator, actionHash])
  );
}

/**
 * Sign an action using a session key (private key).
 * Returns the signature.
 */
export async function signAction(params: {
  subaccountId: bigint;
  nonce: bigint;
  module: Hex;
  data: Hex;
  expiry: bigint;
  owner: Hex;
  sessionPrivateKey: Hex;
  env?: DeriveEnv;
}): Promise<Hex> {
  const account = privateKeyToAccount(params.sessionPrivateKey);
  const domainSeparator = getDomainSeparator(params.env);

  const actionHash = getActionHash({
    subaccountId: params.subaccountId,
    nonce: params.nonce,
    module: params.module,
    data: params.data,
    expiry: params.expiry,
    owner: params.owner,
    signer: account.address,
  });

  const typedDataHash = toTypedDataHash(domainSeparator, actionHash);

  // Raw ECDSA sign — NO EIP-191 prefix. Matches Python SDK's unsafe_sign_hash().
  // signMessage() would add "\x19Ethereum Signed Message:\n32" which Derive doesn't expect.
  const sig = await sign({
    hash: typedDataHash,
    privateKey: params.sessionPrivateKey,
  });

  return signatureToHex(sig);
}

/**
 * Get the EIP-712 domain for the Matching contract.
 * Domain: name="Matching", version="1.0", chainId, verifyingContract=matching address.
 */
export function getEip712Domain(env?: DeriveEnv) {
  const config = getConfig(env);
  return {
    name: "Matching" as const,
    version: "1.0" as const,
    chainId: config.chainId,
    verifyingContract: config.matching,
  };
}

/** EIP-712 type definition for the Action struct. */
const ACTION_TYPES = {
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
 * Sign an action using an external wallet signer (e.g. MetaMask via walletClient).
 * Uses EIP-712 signTypedData (eth_signTypedData_v4) — NOT signMessage which adds EIP-191 prefix.
 * Used for deposits/withdrawals where the EOA signs directly.
 */
export async function signActionWithWallet(params: {
  subaccountId: bigint;
  nonce: bigint;
  module: Hex;
  data: Hex;
  expiry: bigint;
  owner: Hex;
  signer: Hex;
  signTypedData: (args: {
    domain: {
      name: string;
      version: string;
      chainId: number;
      verifyingContract: Hex;
    };
    types: typeof ACTION_TYPES;
    primaryType: "Action";
    message: {
      subaccountId: bigint;
      nonce: bigint;
      module: Hex;
      data: Hex;
      expiry: bigint;
      owner: Hex;
      signer: Hex;
    };
  }) => Promise<Hex>;
  env?: DeriveEnv;
}): Promise<Hex> {
  const domain = getEip712Domain(params.env);

  return params.signTypedData({
    domain,
    types: ACTION_TYPES,
    primaryType: "Action",
    message: {
      subaccountId: params.subaccountId,
      nonce: params.nonce,
      module: params.module,
      data: params.data,
      expiry: params.expiry,
      owner: params.owner,
      signer: params.signer,
    },
  });
}

/**
 * Generate a unique nonce for an order.
 */
export function generateNonce(): number {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

/**
 * Compute signature expiry (current time + duration in seconds).
 */
export function getSignatureExpiry(durationSeconds = 600): number {
  return Math.floor(Date.now() / 1000) + durationSeconds;
}
