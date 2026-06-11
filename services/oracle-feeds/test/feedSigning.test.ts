import {
  decodeAbiParameters,
  encodeAbiParameters,
  encodePacked,
  hashDomain,
  keccak256,
  recoverAddress,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  FEED_DATA_TYPEHASH,
  encodeVolData,
  hashFeedData,
  signFeedData,
  toUnit,
} from "@hedge/shared";
import { annualise, flatIvSviParams, flatSviVol, SECONDS_PER_YEAR } from "../src/svi.js";
import { SETTLEMENT_TWAP_DURATION } from "../src/poster.js";

// anvil key #0 — the default feed signer on 31337
// (must derive 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266, the `feedSigner`
// whitelisted by the deploy script)
const signer = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const CHAIN_ID = 31337;
const VOL_FEED = "0xa82fF9aFd8f496c3d6ac40E2a0F282E47488CFc9" as const;

const NOW = 1_786_000_000n;
const EXPIRY = NOW + 7n * 86400n;

describe("vendored FeedData typehash", () => {
  it("matches keccak256 of BaseLyraFeed's exact type string", () => {
    // protocol/lib/v2-core/src/feeds/BaseLyraFeed.sol:
    //   keccak256("FeedData(bytes data,uint256 deadline,uint64 timestamp)")
    expect(keccak256(toHex("FeedData(bytes data,uint256 deadline,uint64 timestamp)"))).toBe(
      "0xd2bfedead63489b480a7250e6942f2d2b6feeed023c25fddc0f5d1a0487c252f",
    );
    expect(FEED_DATA_TYPEHASH).toBe(
      "0xd2bfedead63489b480a7250e6942f2d2b6feeed023c25fddc0f5d1a0487c252f",
    );
  });
});

describe("vol-surface feed payload signing", () => {
  const svi = flatIvSviParams(toUnit("0.6"), toUnit("100000"), annualise(EXPIRY - NOW));
  const payload = {
    data: encodeVolData({ expiry: EXPIRY, ...svi, confidence: toUnit("1") }),
    deadline: NOW + 3600n,
    timestamp: NOW,
  };

  it("struct hash matches BaseLyraFeed.hashFeedData built from the vendored typehash", async () => {
    // structHash = keccak256(abi.encode(FEED_DATA_TYPEHASH, keccak256(data), deadline, timestamp))
    const structHash = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }],
        [FEED_DATA_TYPEHASH, keccak256(payload.data), payload.deadline, payload.timestamp],
      ),
    );
    const domainSeparator = hashDomain({
      domain: { name: "LyraVolFeed", version: "1", chainId: CHAIN_ID, verifyingContract: VOL_FEED },
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
      },
    });
    // _hashTypedDataV4(structHash)
    const manualDigest = keccak256(
      encodePacked(["bytes2", "bytes32", "bytes32"], ["0x1901", domainSeparator, structHash]),
    );

    expect(hashFeedData("vol", payload, CHAIN_ID, VOL_FEED)).toBe(manualDigest);
  });

  it("default signer key derives the deployment's whitelisted feedSigner", () => {
    expect(signer.address).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
  });

  it("signature recovers the whitelisted signer; encoded blob round-trips", async () => {
    const encoded = await signFeedData({
      kind: "vol",
      payload,
      signers: [signer],
      chainId: CHAIN_ID,
      feedAddress: VOL_FEED,
    });

    // decode the FeedData struct exactly as feed.acceptData would
    const [feedData] = decodeAbiParameters(
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
    expect(feedData.data).toBe(payload.data);
    expect(feedData.deadline).toBe(payload.deadline);
    expect(feedData.timestamp).toBe(payload.timestamp);
    expect(feedData.signers).toEqual([signer.address]);

    const digest = hashFeedData("vol", payload, CHAIN_ID, VOL_FEED);
    const recovered = await recoverAddress({
      hash: digest,
      signature: feedData.signatures[0]!,
    });
    expect(recovered).toBe(signer.address);
  });
});

describe("flat-IV SVI defaults", () => {
  it("annualise matches Black76 (365-day year, 18dp)", () => {
    expect(SECONDS_PER_YEAR).toBe(31_536_000n);
    expect(annualise(7n * 86400n)).toBe((7n * 86400n * 10n ** 18n) / 31_536_000n);
  });

  it("produces ~60% IV through the on-chain SVI math (b=0 -> strike-independent)", () => {
    const tau = annualise(EXPIRY - NOW);
    const svi = flatIvSviParams(toUnit("0.6"), toUnit("100000"), tau);
    expect(svi.SVI_b).toBe(0n);
    expect(svi.SVI_refTau).toBe(tau);
    expect(svi.SVI_refTau < 2n ** 64n).toBe(true); // packed into uint64 on-chain

    const vol = flatSviVol(svi); // replicates SVI.getVol with b = 0
    const target = toUnit("0.6");
    const errAbs = vol > target ? vol - target : target - vol;
    // integer rounding only — well under 1e-9 vol
    expect(errAbs < 10n ** 9n).toBe(true);
  });
});

describe("settlement aggregates", () => {
  it("(currentAggregate - startAggregate) / TWAP_DURATION reproduces the price exactly", () => {
    const price = toUnit("120000");
    const start = price * (EXPIRY - SETTLEMENT_TWAP_DURATION);
    const curr = price * EXPIRY;
    expect(start < curr).toBe(true); // LFF_InvalidSettlementData guard
    expect((curr - start) / SETTLEMENT_TWAP_DURATION).toBe(price);
  });
});
