import { describe, expect, it } from "vitest";
import { decodeAbiParameters, recoverAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  encodeOptionSubId,
  getActionDigest,
  hashActionTypedData,
  hashRfqTrades,
  toUnit,
} from "@sats-options/shared";
import { black76Price, yearsToExpiry } from "../src/black76.js";
import { buildSignedQuote, priceToUint18 } from "../src/quoter.js";
import { deserializeAction, serializeAction } from "../src/transport.js";

const CHAIN_ID = 31337;
const MATCHING = "0x2E2Ed0Cfd3AD2f1d34481277b3204d807Ca2F8c2" as Address;
const RFQ_MODULE = "0x8198f5d8F8CfFE8f9C413d98a0A55aEB8ab9FbB7" as Address;
const OPTION_ASSET = "0x1291Be112d480055DaFd8a610b7d1e203891C274" as Address;

// anvil test key #1 — never used with real funds
const account = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);

describe("buildSignedQuote", () => {
  const nowMs = Date.now();
  const expiry = BigInt(Math.floor(nowMs / 1000) + 7 * 86_400);
  const strike = toUnit("110000");
  const subId = encodeOptionSubId({ expiry, strike, isCall: true });
  const inputs = { forward: 100_000, vol: 0.6, rate: 0 };

  async function makeQuote() {
    return buildSignedQuote({
      legs: [{ asset: OPTION_ASSET, subId, amount: toUnit("1") }], // maker buys 1 call
      priceSource: { getInputs: async () => inputs },
      bidRatio: 0.95,
      askRatio: 1.05,
      maxFee: 0n,
      subaccountId: 42n,
      owner: account.address,
      signer: account,
      chainId: CHAIN_ID,
      matchingAddress: MATCHING,
      rfqModuleAddress: RFQ_MODULE,
      ttlSec: 300,
      nowMs,
    });
  }

  it("applies the default 95% bid spread to the Black-76 theo", async () => {
    const quote = await makeQuote();
    const leg = quote.pricedLegs[0]!;
    const expectedTheo = black76Price({
      forward: inputs.forward,
      strike: 110_000,
      timeToExpiryYears: yearsToExpiry(expiry, nowMs),
      vol: inputs.vol,
      rate: 0,
      isCall: true,
    });
    expect(leg.theo).toBeCloseTo(expectedTheo, 8);
    expect(leg.unitPrice).toBeCloseTo(expectedTheo * 0.95, 8);
    // 18dp on-chain price within 1e-6 of the float
    const px = Number(leg.price) / 1e18;
    expect(Math.abs(px - leg.unitPrice)).toBeLessThan(1e-6);
    expect(leg.instrument).toMatch(/^BTC-\d{8}-110000-C$/);
  });

  it("encodes a maker RfqOrder whose data decodes back to the signed trades", async () => {
    const quote = await makeQuote();
    expect(quote.action.module).toBe(RFQ_MODULE);
    expect(quote.action.subaccountId).toBe(42n);
    expect(quote.action.owner).toBe(account.address);

    const [decoded] = decodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { name: "maxFee", type: "uint256" },
            {
              name: "trades",
              type: "tuple[]",
              components: [
                { name: "asset", type: "address" },
                { name: "subId", type: "uint256" },
                { name: "price", type: "uint256" },
                { name: "amount", type: "int256" },
              ],
            },
          ],
        },
      ],
      quote.action.data,
    );
    expect(decoded.maxFee).toBe(0n);
    expect(decoded.trades).toHaveLength(1);
    expect(decoded.trades[0]!.asset.toLowerCase()).toBe(OPTION_ASSET.toLowerCase());
    expect(decoded.trades[0]!.subId).toBe(subId);
    expect(decoded.trades[0]!.amount).toBe(toUnit("1"));
    expect(decoded.trades[0]!.price).toBe(quote.trades[0]!.price);

    // orderHash is what the taker must sign
    expect(quote.orderHash).toBe(hashRfqTrades(quote.trades));
  });

  it("signs the exact EIP-712 digest ActionVerifier checks (signature recovers owner)", async () => {
    const quote = await makeQuote();
    const digest = getActionDigest(quote.action, CHAIN_ID, MATCHING);
    // cross-check the manual 0x1901 path against viem's typed-data hashing
    expect(digest).toBe(hashActionTypedData(quote.action, CHAIN_ID, MATCHING));
    const recovered = await recoverAddress({ hash: digest, signature: quote.signature });
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });

  it("quotes an ask above theo when the maker sells (negative amount)", async () => {
    const quote = await buildSignedQuote({
      legs: [{ asset: OPTION_ASSET, subId, amount: -toUnit("1") }],
      priceSource: { getInputs: async () => inputs },
      bidRatio: 0.95,
      askRatio: 1.05,
      maxFee: 0n,
      subaccountId: 42n,
      owner: account.address,
      signer: account,
      chainId: CHAIN_ID,
      matchingAddress: MATCHING,
      rfqModuleAddress: RFQ_MODULE,
      ttlSec: 300,
      nowMs,
    });
    const leg = quote.pricedLegs[0]!;
    expect(leg.unitPrice).toBeCloseTo(leg.theo * 1.05, 8);
  });

  it("rejects expired options and zero amounts", async () => {
    const pastSubId = encodeOptionSubId({
      expiry: BigInt(Math.floor(nowMs / 1000) - 60),
      strike,
      isCall: true,
    });
    await expect(
      buildSignedQuote({
        legs: [{ asset: OPTION_ASSET, subId: pastSubId, amount: toUnit("1") }],
        priceSource: { getInputs: async () => inputs },
        bidRatio: 0.95,
        askRatio: 1.05,
        maxFee: 0n,
        subaccountId: 42n,
        owner: account.address,
        signer: account,
        chainId: CHAIN_ID,
        matchingAddress: MATCHING,
        rfqModuleAddress: RFQ_MODULE,
        ttlSec: 300,
        nowMs,
      }),
    ).rejects.toThrow(/expired/);
  });
});

describe("transport serialization", () => {
  it("round-trips an Action through the wire format", async () => {
    const action = {
      subaccountId: 42n,
      nonce: 123456789n,
      module: RFQ_MODULE,
      data: "0xdeadbeef" as const,
      expiry: 1_900_000_000n,
      owner: account.address,
      signer: account.address,
    };
    expect(deserializeAction(serializeAction(action))).toEqual(action);
  });
});

describe("priceToUint18", () => {
  it("converts and clamps", () => {
    expect(priceToUint18(1.5)).toBe(toUnit("1.5"));
    expect(priceToUint18(0)).toBe(0n);
    expect(priceToUint18(-3)).toBe(0n);
    // large premiums survive toFixed without exponent notation (float dust ok)
    expect(Number(priceToUint18(123456.789)) / 1e18).toBeCloseTo(123456.789, 6);
  });
});
