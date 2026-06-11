import {
  decodeAbiParameters,
  encodeAbiParameters,
  encodePacked,
  hashDomain,
  keccak256,
  recoverAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { FEED_DATA_TYPEHASH } from "../src/constants.js";
import {
  encodeForwardData,
  encodeRateData,
  encodeSpotData,
  encodeVolData,
  hashFeedData,
  signFeedData,
} from "../src/feeds.js";
import { toUnit } from "../src/units.js";

const signer = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d7838d2bb7f51347dba71d4462a13a86df0bf032",
);
const CHAIN_ID = 31337;
const FEED = "0x0000000000000000000000000000000000000123" as const;

describe("Lyra feed data signing (BaseLyraFeed FeedData)", () => {
  const payload = {
    data: encodeSpotData({ price: toUnit("100000"), confidence: toUnit("1") }),
    deadline: 1900000000n,
    timestamp: 1781712000n,
  };

  it("digest matches the manual BaseLyraFeed.hashFeedData + _hashTypedDataV4 path", () => {
    // structHash = keccak256(abi.encode(FEED_DATA_TYPEHASH, keccak256(data), deadline, timestamp))
    const structHash = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }],
        [FEED_DATA_TYPEHASH, keccak256(payload.data), payload.deadline, payload.timestamp],
      ),
    );
    const domainSeparator = hashDomain({
      domain: {
        name: "LyraSpotFeed",
        version: "1",
        chainId: CHAIN_ID,
        verifyingContract: FEED,
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
    const manualDigest = keccak256(
      encodePacked(["bytes2", "bytes32", "bytes32"], ["0x1901", domainSeparator, structHash]),
    );

    expect(hashFeedData("spot", payload, CHAIN_ID, FEED)).toBe(manualDigest);
  });

  it("signs + encodes FeedData and the signature recovers", async () => {
    const encoded = await signFeedData({
      kind: "spot",
      payload,
      signers: [signer],
      chainId: CHAIN_ID,
      feedAddress: FEED,
    });

    const [decoded] = decodeAbiParameters(
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
      encoded,
    );
    expect(decoded.data).toBe(payload.data);
    expect(decoded.timestamp).toBe(payload.timestamp);
    expect(decoded.signers).toEqual([signer.address]);

    const recovered = await recoverAddress({
      hash: hashFeedData("spot", payload, CHAIN_ID, FEED),
      signature: decoded.signatures[0]!,
    });
    expect(recovered.toLowerCase()).toBe(signer.address.toLowerCase());
  });

  it("inner data encoders decode with the exact acceptData tuple types", () => {
    const spot = decodeAbiParameters(
      [{ type: "uint96" }, { type: "uint64" }],
      encodeSpotData({ price: 123n, confidence: 456n }),
    );
    expect(spot).toEqual([123n, 456n]);

    const fwd = decodeAbiParameters(
      [
        { type: "uint64" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "int96" },
        { type: "uint64" },
      ],
      encodeForwardData({
        expiry: 1781712000n,
        settlementStartAggregate: 0n,
        currentSpotAggregate: 0n,
        fwdSpotDifference: -5n,
        confidence: toUnit("1"),
      }),
    );
    expect(fwd[3]).toBe(-5n);

    const vol = decodeAbiParameters(
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
      encodeVolData({
        expiry: 1781712000n,
        SVI_a: toUnit("0.04"),
        SVI_b: toUnit("0.1"),
        SVI_rho: -toUnit("0.3"),
        SVI_m: 0n,
        SVI_sigma: toUnit("0.2"),
        SVI_fwd: toUnit("100000"),
        SVI_refTau: toUnit("0.019178"), // ~7 days in years, 18dp
        confidence: toUnit("1"),
      }),
    );
    expect(vol[0]).toBe(1781712000n);

    const rate = decodeAbiParameters(
      [{ type: "uint64" }, { type: "int96" }, { type: "uint64" }],
      encodeRateData({ expiry: 1781712000n, rate: toUnit("0.05"), confidence: toUnit("1") }),
    );
    expect(rate[1]).toBe(toUnit("0.05"));
  });
});
