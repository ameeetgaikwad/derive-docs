import {
  hexToBytes,
  bytesToHex,
  parseTransaction,
  recoverMessageAddress,
  recoverTransactionAddress,
  recoverTypedDataAddress,
  type Hex,
  type TransactionSerializableLegacy,
} from "viem";
import { privateKeyToAccount, sign } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { buildAction, signAction } from "../src/actions.js";
import { BSC_TESTNET_GAS_PRICE } from "../src/clients.js";
import { ACTION_TYPES, FEED_DATA_TYPES, matchingDomain } from "../src/constants.js";
import { signFeedData } from "../src/feeds.js";
import {
  createKmsAccount,
  normalizeS,
  parseDerSignature,
  resolveAccount,
  spkiToAddress,
  SECP256K1_HALF_N,
  SECP256K1_N,
  type KmsCryptoClient,
} from "../src/kms.js";

// anvil default key #0 — the "key inside KMS" for the fake client below
const PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const rawAccount = privateKeyToAccount(PK);

const CHAIN_ID = 97;
const MATCHING = "0x00000000000000000000000000000000000000aa" as const;
const MODULE = "0x00000000000000000000000000000000000000bb" as const;
const KEY_ID = "alias/hedge-test";

// ---------------------------------------------------------------------------
// Locally-computed KMS fake: real secp256k1 signatures (via viem's sign, which
// is deterministic RFC-6979 with lowS), re-encoded to DER exactly like
// kms:Sign responses. No AWS anywhere.
// ---------------------------------------------------------------------------

/** DER SPKI prefix for a secp256k1 public key (id-ecPublicKey + secp256k1 OIDs + BIT STRING header). */
const SPKI_PREFIX = "3056301006072a8648ce3d020106052b8104000a034200";

function spkiFor(uncompressedPubKey: Hex): Uint8Array {
  return hexToBytes(`0x${SPKI_PREFIX}${uncompressedPubKey.slice(2)}` as Hex);
}

function derInteger(x: bigint): number[] {
  let hex = x.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  let bytes = [...hexToBytes(`0x${hex}` as Hex)];
  // INTEGERs are signed: prepend 0x00 when the high bit is set (this is why
  // real KMS r/s values are sometimes 33 bytes long)
  if (bytes[0]! & 0x80) bytes = [0, ...bytes];
  return [0x02, bytes.length, ...bytes];
}

function derEcdsaSignature(r: bigint, s: bigint): Uint8Array {
  const body = [...derInteger(r), ...derInteger(s)];
  return Uint8Array.from([0x30, body.length, ...body]);
}

class FakeKms implements KmsCryptoClient {
  constructor(private readonly opts: { forceHighS?: boolean } = {}) {}

  async getDerPublicKey(keyId: string): Promise<Uint8Array> {
    expect(keyId).toBe(KEY_ID);
    return spkiFor(rawAccount.publicKey);
  }

  async signDigest(keyId: string, digest: Uint8Array): Promise<Uint8Array> {
    expect(keyId).toBe(KEY_ID);
    expect(digest.length).toBe(32);
    const sig = await sign({ hash: bytesToHex(digest), privateKey: PK });
    const r = BigInt(sig.r);
    let s = BigInt(sig.s);
    // KMS is not low-s-canonical: emulate the ~50% of responses with high s
    if (this.opts.forceHighS) s = SECP256K1_N - s;
    return derEcdsaSignature(r, s);
  }
}

const kmsAccount = await createKmsAccount({ keyId: KEY_ID, client: new FakeKms() });
const highSKmsAccount = await createKmsAccount({
  keyId: KEY_ID,
  client: new FakeKms({ forceHighS: true }),
});

describe("KmsAccount address derivation", () => {
  it("(a) DER SPKI -> keccak address matches viem privateKeyToAccount", () => {
    expect(kmsAccount.address).toBe(rawAccount.address);
    expect(spkiToAddress(spkiFor(rawAccount.publicKey))).toBe(rawAccount.address);
  });

  it("exposes the uncompressed public key and kms source", () => {
    expect(kmsAccount.publicKey).toBe(rawAccount.publicKey);
    expect(kmsAccount.source).toBe("kms");
    expect(kmsAccount.type).toBe("local");
  });
});

describe("KmsAccount signTypedData", () => {
  const action = buildAction({
    subaccountId: 7n,
    module: MODULE,
    data: "0x1234",
    owner: rawAccount.address,
    nonce: 42n,
    expiry: 1900000000n,
  });

  it("(b) Action signature recovers and byte-equals the raw-key signature", async () => {
    const kmsSig = await signAction({
      action,
      signer: kmsAccount,
      chainId: CHAIN_ID,
      matchingAddress: MATCHING,
    });
    const rawSig = await signAction({
      action,
      signer: rawAccount,
      chainId: CHAIN_ID,
      matchingAddress: MATCHING,
    });
    expect(kmsSig).toBe(rawSig);

    const recovered = await recoverTypedDataAddress({
      domain: matchingDomain(CHAIN_ID, MATCHING) as never,
      types: ACTION_TYPES,
      primaryType: "Action",
      message: action,
      signature: kmsSig,
    });
    expect(recovered).toBe(kmsAccount.address);
  });

  it("(b) FeedData (BaseLyraFeed) encoding byte-equals the raw-key path", async () => {
    const params = {
      kind: "spot",
      payload: { data: "0xdeadbeef", deadline: 2000000000n, timestamp: 1750000000n },
      chainId: CHAIN_ID,
      feedAddress: "0x00000000000000000000000000000000000000fe",
    } as const;
    const viaKms = await signFeedData({ ...params, signers: [kmsAccount] });
    const viaRaw = await signFeedData({ ...params, signers: [rawAccount] });
    expect(viaKms).toBe(viaRaw);
  });

  it("signMessage recovers to the KMS address", async () => {
    const signature = await kmsAccount.signMessage({ message: "hedge kms" });
    expect(signature).toBe(await rawAccount.signMessage({ message: "hedge kms" }));
    expect(
      await recoverMessageAddress({ message: "hedge kms", signature }),
    ).toBe(kmsAccount.address);
  });
});

describe("KmsAccount signTransaction (chain-97 legacy quirk)", () => {
  const tx: TransactionSerializableLegacy = {
    type: "legacy",
    chainId: 97,
    nonce: 3,
    gasPrice: BSC_TESTNET_GAS_PRICE,
    gas: 300_000n,
    to: "0x00000000000000000000000000000000000000cc",
    value: 0n,
    data: "0xabcdef",
  };

  it("(c) signed legacy tx parses with right from/gasPrice and equals raw-key output", async () => {
    const serialized = await kmsAccount.signTransaction(tx);
    expect(serialized).toBe(await rawAccount.signTransaction(tx));

    const parsed = parseTransaction(serialized);
    expect(parsed.type).toBe("legacy");
    expect(parsed.chainId).toBe(97);
    expect(parsed.gasPrice).toBe(BSC_TESTNET_GAS_PRICE);
    expect(parsed.to).toBe(tx.to);

    const from = await recoverTransactionAddress({ serializedTransaction: serialized });
    expect(from).toBe(kmsAccount.address);
  });
});

describe("high-s normalization", () => {
  it("(d) high-s DER responses are normalized to the canonical low-s signature", async () => {
    const digest = `0x${"11".repeat(32)}` as Hex;
    const fromHighS = await highSKmsAccount.sign({ hash: digest });
    const fromLowS = await kmsAccount.sign({ hash: digest });
    expect(fromHighS).toBe(fromLowS);

    const s = BigInt(`0x${fromHighS.slice(66, 130)}`);
    expect(s <= SECP256K1_HALF_N).toBe(true);
  });

  it("(d) high-s typed-data signatures byte-equal the raw account's low-s output", async () => {
    const action = buildAction({
      subaccountId: 1n,
      module: MODULE,
      data: "0x",
      owner: rawAccount.address,
      nonce: 1n,
      expiry: 1900000000n,
    });
    const highS = await signAction({
      action,
      signer: highSKmsAccount,
      chainId: CHAIN_ID,
      matchingAddress: MATCHING,
    });
    const raw = await signAction({
      action,
      signer: rawAccount,
      chainId: CHAIN_ID,
      matchingAddress: MATCHING,
    });
    expect(highS).toBe(raw);
  });

  it("normalizeS flips only above-half-n values; DER parse round-trips", async () => {
    const lowS = 5n;
    expect(normalizeS(lowS)).toBe(lowS);
    expect(normalizeS(SECP256K1_N - 5n)).toBe(5n);

    const der = derEcdsaSignature(SECP256K1_N - 1n, SECP256K1_HALF_N);
    const parsed = parseDerSignature(der);
    expect(parsed.r).toBe(SECP256K1_N - 1n);
    expect(parsed.s).toBe(SECP256K1_HALF_N);
  });
});

describe("resolveAccount factory", () => {
  it("returns a KMS account when <ROLE>_KMS_KEY_ID is set", async () => {
    const account = await resolveAccount({
      role: "EXECUTOR",
      env: { EXECUTOR_KMS_KEY_ID: KEY_ID } as NodeJS.ProcessEnv,
      kmsClient: new FakeKms(),
    });
    expect(account.address).toBe(rawAccount.address);
    expect(account.source).toBe("kms");
  });

  it("falls back to the provided raw key when no KMS env var is set", async () => {
    const account = await resolveAccount({
      role: "EXECUTOR",
      env: {} as NodeJS.ProcessEnv,
      privateKey: PK,
    });
    expect(account.address).toBe(rawAccount.address);
    expect(account.source).toBe("privateKey");
  });

  it("falls back to <ROLE>_PRIVATE_KEY (with or without 0x)", async () => {
    const account = await resolveAccount({
      role: "FEED_SIGNER",
      env: { FEED_SIGNER_PRIVATE_KEY: PK.slice(2) } as NodeJS.ProcessEnv,
    });
    expect(account.address).toBe(rawAccount.address);
  });

  it("throws when neither KMS nor raw key is available", async () => {
    await expect(
      resolveAccount({ role: "EXECUTOR", env: {} as NodeJS.ProcessEnv }),
    ).rejects.toThrow(/EXECUTOR_KMS_KEY_ID/);
  });
});
