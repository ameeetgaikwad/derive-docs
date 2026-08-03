import {
  hashMessage,
  hashTypedData,
  hexToBytes,
  keccak256,
  numberToHex,
  recoverAddress,
  serializeSignature,
  serializeTransaction,
  toHex,
  getAddress,
  type Address,
  type Hex,
  type LocalAccount,
  type SignableMessage,
} from "viem";
import { privateKeyToAccount, toAccount } from "viem/accounts";
import { KMSClient, GetPublicKeyCommand, SignCommand } from "@aws-sdk/client-kms";

/**
 * AWS KMS-backed viem account.
 *
 * The private key lives in an AWS KMS asymmetric key (KeySpec ECC_SECG_P256K1,
 * KeyUsage SIGN_VERIFY) and never leaves KMS. We call:
 *
 *   - kms:GetPublicKey  once, to derive the Ethereum address (DER SPKI ->
 *     uncompressed secp256k1 point -> keccak256 -> last 20 bytes), and
 *   - kms:Sign          per signature, with SigningAlgorithm ECDSA_SHA_256 and
 *     MessageType DIGEST (we always pass a precomputed 32-byte keccak digest;
 *     KMS's own hashing is SHA-256 and must NOT be applied on top).
 *
 * KMS returns a DER-encoded ECDSA-Sig-Value { r, s } with two quirks Ethereum
 * cares about:
 *
 *   1. `s` is NOT canonicalized: ~half the signatures come back high-s.
 *      Ethereum (EIP-2) rejects s > n/2, so we normalize s -> n - s.
 *   2. There is no recovery id. We derive `v` by ecrecover-ing both
 *      candidates (yParity 0 and 1) and matching against the known address.
 *
 * The resulting account is a standard viem LocalAccount (source "kms") that
 * supports sign / signMessage / signTypedData / signTransaction, so it drops
 * into makeWalletClient (including the chain-97 forced-legacy/0.2-gwei path in
 * clients.ts), EIP-712 FeedData signing (feeds.ts) and Action signing
 * (actions.ts) unchanged.
 */

/** secp256k1 group order n. */
export const SECP256K1_N =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/** floor(n / 2) — signatures with s above this are malleable (EIP-2). */
export const SECP256K1_HALF_N = SECP256K1_N >> 1n;

/**
 * Minimal KMS surface the account needs. Production uses AwsKmsCryptoClient
 * (@aws-sdk/client-kms, standard credential chain); tests inject a fake that
 * signs locally with a known private key.
 */
export interface KmsCryptoClient {
  /** kms:GetPublicKey — DER-encoded SubjectPublicKeyInfo bytes. */
  getDerPublicKey(keyId: string): Promise<Uint8Array>;
  /**
   * kms:Sign with ECDSA_SHA_256 + MessageType DIGEST over a 32-byte digest.
   * Returns the DER-encoded ECDSA signature.
   */
  signDigest(keyId: string, digest: Uint8Array): Promise<Uint8Array>;
}

/** Real client. Region/credentials resolve via the standard AWS chain. */
export class AwsKmsCryptoClient implements KmsCryptoClient {
  private readonly client: KMSClient;

  constructor(options?: { region?: string; client?: KMSClient }) {
    this.client =
      options?.client ?? new KMSClient(options?.region ? { region: options.region } : {});
  }

  async getDerPublicKey(keyId: string): Promise<Uint8Array> {
    const res = await this.client.send(new GetPublicKeyCommand({ KeyId: keyId }));
    if (!res.PublicKey) throw new Error(`KMS GetPublicKey(${keyId}) returned no PublicKey`);
    if (res.KeySpec && res.KeySpec !== "ECC_SECG_P256K1") {
      throw new Error(
        `KMS key ${keyId} has KeySpec ${res.KeySpec}; need ECC_SECG_P256K1 (secp256k1)`,
      );
    }
    return res.PublicKey;
  }

  async signDigest(keyId: string, digest: Uint8Array): Promise<Uint8Array> {
    if (digest.length !== 32) {
      throw new Error(`KMS signDigest expects a 32-byte digest, got ${digest.length}`);
    }
    const res = await this.client.send(
      new SignCommand({
        KeyId: keyId,
        Message: digest,
        MessageType: "DIGEST",
        SigningAlgorithm: "ECDSA_SHA_256",
      }),
    );
    if (!res.Signature) throw new Error(`KMS Sign(${keyId}) returned no Signature`);
    return res.Signature;
  }
}

// ---------------------------------------------------------------------------
// DER parsing (SPKI public key + ECDSA-Sig-Value) — no ASN.1 dependency.
// ---------------------------------------------------------------------------

/** Read a DER length at `offset` (short form or long form up to 4 bytes). */
function readDerLength(bytes: Uint8Array, offset: number): { length: number; next: number } {
  const first = bytes[offset];
  if (first === undefined) throw new Error("DER: truncated length");
  if ((first & 0x80) === 0) return { length: first, next: offset + 1 };
  const numBytes = first & 0x7f;
  if (numBytes === 0 || numBytes > 4) throw new Error(`DER: unsupported length form ${first}`);
  let length = 0;
  for (let i = 0; i < numBytes; i++) {
    const b = bytes[offset + 1 + i];
    if (b === undefined) throw new Error("DER: truncated length");
    length = (length << 8) | b;
  }
  return { length, next: offset + 1 + numBytes };
}

function expectTag(bytes: Uint8Array, offset: number, tag: number, what: string): number {
  if (bytes[offset] !== tag) {
    throw new Error(
      `DER: expected ${what} (tag 0x${tag.toString(16)}) at ${offset}, got 0x${bytes[offset]?.toString(16)}`,
    );
  }
  return offset + 1;
}

/**
 * Parse a DER SubjectPublicKeyInfo (kms:GetPublicKey output for an
 * ECC_SECG_P256K1 key) into the 65-byte uncompressed point 0x04 || X || Y.
 *
 *   SEQUENCE {
 *     SEQUENCE { OID id-ecPublicKey, OID secp256k1 }
 *     BIT STRING { 0x00, 0x04 || X || Y }
 *   }
 */
export function spkiToUncompressedPublicKey(spki: Uint8Array): Hex {
  let offset = expectTag(spki, 0, 0x30, "SPKI SEQUENCE");
  ({ next: offset } = readDerLength(spki, offset));
  // AlgorithmIdentifier SEQUENCE — skip whole element
  const algStart = expectTag(spki, offset, 0x30, "AlgorithmIdentifier");
  const alg = readDerLength(spki, algStart);
  offset = alg.next + alg.length;
  // BIT STRING
  offset = expectTag(spki, offset, 0x03, "BIT STRING");
  const bits = readDerLength(spki, offset);
  const content = spki.slice(bits.next, bits.next + bits.length);
  if (content[0] !== 0x00) throw new Error("DER: BIT STRING has unused bits");
  const point = content.slice(1);
  if (point.length !== 65 || point[0] !== 0x04) {
    throw new Error(
      `KMS public key is not an uncompressed secp256k1 point (${point.length} bytes, prefix 0x${point[0]?.toString(16)})`,
    );
  }
  return toHex(point);
}

/** Ethereum address for a KMS key: keccak256(X || Y) last 20 bytes. */
export function spkiToAddress(spki: Uint8Array): Address {
  const uncompressed = spkiToUncompressedPublicKey(spki);
  // drop 0x prefix + 0x04 point prefix -> 64-byte X||Y
  const xy = `0x${uncompressed.slice(4)}` as Hex;
  return getAddress(`0x${keccak256(xy).slice(-40)}`);
}

/** Parse DER ECDSA-Sig-Value: SEQUENCE { INTEGER r, INTEGER s }. */
export function parseDerSignature(der: Uint8Array): { r: bigint; s: bigint } {
  let offset = expectTag(der, 0, 0x30, "ECDSA-Sig-Value SEQUENCE");
  ({ next: offset } = readDerLength(der, offset));

  const readInt = (): bigint => {
    offset = expectTag(der, offset, 0x02, "INTEGER");
    const { length, next } = readDerLength(der, offset);
    const raw = der.slice(next, next + length);
    if (raw.length !== length) throw new Error("DER: truncated INTEGER");
    offset = next + length;
    let value = 0n;
    for (const byte of raw) value = (value << 8n) | BigInt(byte);
    return value;
  };

  const r = readInt();
  const s = readInt();
  if (r <= 0n || r >= SECP256K1_N || s <= 0n || s >= SECP256K1_N) {
    throw new Error("DER: r/s out of range for secp256k1");
  }
  return { r, s };
}

/** EIP-2 low-s normalization; KMS returns high-s roughly half the time. */
export function normalizeS(s: bigint): bigint {
  return s > SECP256K1_HALF_N ? SECP256K1_N - s : s;
}

/** Full viem Signature (r, s, v, yParity) for `hash`, signed via KMS. */
async function kmsSignHash(
  client: KmsCryptoClient,
  keyId: string,
  hash: Hex,
  address: Address,
): Promise<{ r: Hex; s: Hex; v: bigint; yParity: number }> {
  const der = await client.signDigest(keyId, hexToBytes(hash));
  const parsed = parseDerSignature(der);
  const r = numberToHex(parsed.r, { size: 32 });
  const s = numberToHex(normalizeS(parsed.s), { size: 32 });
  // KMS gives no recovery id: recover both candidates against the known address.
  for (const yParity of [0, 1] as const) {
    const recovered = await recoverAddress({ hash, signature: { r, s, yParity } });
    if (recovered.toLowerCase() === address.toLowerCase()) {
      return { r, s, v: yParity === 0 ? 27n : 28n, yParity };
    }
  }
  throw new Error(
    `KMS signature for key ${keyId} does not recover to ${address} — wrong key or corrupted response`,
  );
}

export type KmsAccount = LocalAccount<"kms">;

export interface CreateKmsAccountOptions {
  /** KMS key id, ARN, alias name ("alias/hedge-executor") or alias ARN. */
  keyId: string;
  /** Optional region override; default is the standard AWS resolution chain. */
  region?: string;
  /** Injectable KMS boundary (tests use a local-signing fake). */
  client?: KmsCryptoClient;
}

/**
 * Create a viem custom account backed by an AWS KMS secp256k1 key.
 * Async because the address must be derived via kms:GetPublicKey first.
 */
export async function createKmsAccount(options: CreateKmsAccountOptions): Promise<KmsAccount> {
  const client = options.client ?? new AwsKmsCryptoClient({ region: options.region });
  const keyId = options.keyId;
  const spki = await client.getDerPublicKey(keyId);
  const publicKey = spkiToUncompressedPublicKey(spki);
  const address = spkiToAddress(spki);

  const signHash = async (hash: Hex): Promise<Hex> =>
    serializeSignature(await kmsSignHash(client, keyId, hash, address));

  const account = toAccount({
    address,
    async sign({ hash }: { hash: Hex }) {
      return signHash(hash);
    },
    async signMessage({ message }: { message: SignableMessage }) {
      return signHash(hashMessage(message));
    },
    // Mirrors viem's own accounts/utils/signTransaction.ts: serialize the
    // unsigned tx, keccak it, sign, then re-serialize with the signature.
    // The serializer handles legacy v = chainId * 2 + 35 + yParity (EIP-155),
    // so the chain-97 forced-legacy/0.2-gwei path keeps working.
    async signTransaction(transaction, args) {
      const serializer = args?.serializer ?? serializeTransaction;
      const signature = await kmsSignHash(
        client,
        keyId,
        keccak256(await serializer(transaction)),
        address,
      );
      return serializer(transaction, signature);
    },
    async signTypedData(typedData) {
      return signHash(hashTypedData(typedData as Parameters<typeof hashTypedData>[0]));
    },
  });

  return { ...account, publicKey, source: "kms" } as KmsAccount;
}

// ---------------------------------------------------------------------------
// resolveAccount — the one factory every service goes through.
// ---------------------------------------------------------------------------

export interface ResolveAccountOptions {
  /**
   * Env-var prefix for the role, e.g. "EXECUTOR" -> EXECUTOR_KMS_KEY_ID /
   * EXECUTOR_KMS_REGION / EXECUTOR_PRIVATE_KEY, "FEED_SIGNER" ->
   * FEED_SIGNER_KMS_KEY_ID / ...
   */
  role: string;
  /** Env source (default process.env). */
  env?: NodeJS.ProcessEnv;
  /**
   * Raw-key fallback the caller already resolved through its existing env
   * path (e.g. rfq-engine's EXECUTOR_PRIVATE_KEY-with-anvil-default,
   * oracle-feeds' FEED_SIGNER_KEY). Ignored when the KMS env var is set.
   */
  privateKey?: Hex | string | null;
  /** Injectable KMS boundary (tests). */
  kmsClient?: KmsCryptoClient;
}

/**
 * Resolve the signing account for a service role.
 *
 * Priority:
 *   1. `<ROLE>_KMS_KEY_ID` set -> AWS KMS account (region from
 *      `<ROLE>_KMS_REGION`, else the standard AWS chain). Adopting KMS is an
 *      env-var-only change per service.
 *   2. `privateKey` param (the service's existing raw-key path), else
 *      `<ROLE>_PRIVATE_KEY` env var.
 *   3. Otherwise throws.
 */
export async function resolveAccount(options: ResolveAccountOptions): Promise<LocalAccount> {
  const env = options.env ?? process.env;
  const prefix = options.role.toUpperCase();

  const kmsKeyId = env[`${prefix}_KMS_KEY_ID`]?.trim();
  if (kmsKeyId) {
    const region = env[`${prefix}_KMS_REGION`]?.trim();
    return createKmsAccount({
      keyId: kmsKeyId,
      ...(region ? { region } : {}),
      ...(options.kmsClient ? { client: options.kmsClient } : {}),
    });
  }

  const raw = options.privateKey ?? env[`${prefix}_PRIVATE_KEY`];
  if (raw) {
    const hex = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
    return privateKeyToAccount(hex);
  }

  throw new Error(
    `No signing key for role ${prefix}: set ${prefix}_KMS_KEY_ID (AWS KMS) ` +
      `or provide a raw private key (${prefix}_PRIVATE_KEY / service-specific env)`,
  );
}
