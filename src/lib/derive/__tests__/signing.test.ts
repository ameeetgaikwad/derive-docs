import { describe, it, expect, vi } from "vitest";
import {
  toTokenAmount,
  toUnitAmount,
  encodeDepositData,
  encodeWithdrawData,
  encodeTradeData,
  encodeRfqExecutionData,
  getActionHash,
  toTypedDataHash,
  signAction,
  getDomainSeparator,
  generateNonce,
  getSignatureExpiry,
  getEip712Domain,
} from "../signing";
import { ACTION_TYPEHASH } from "../constants";
import {
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  encodePacked,
  recoverAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

// Known test private key (Hardhat account #0)
const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const TEST_ACCOUNT = privateKeyToAccount(TEST_PRIVATE_KEY);

// Known values from scripts/debug-withdraw.mjs
const KNOWN_SUBACCOUNT_ID = 61900n;
const KNOWN_NONCE = 1770955727627114n;
const KNOWN_EXPIRY = 1770956327n;
const KNOWN_SIGNER = "0x339e6B900391B0996A9ffc64F75F0034581D715c" as Hex;
const KNOWN_WALLET = "0x6c808Eadd7745ef9dFa66d22C13A6a7DA09dbd9A" as Hex;
const MAINNET_WITHDRAWAL_MODULE = "0x9d0E8f5b25384C7310CB8C6aE32C8fbeb645d083" as Hex;
const MAINNET_USDC_ADDRESS = "0x6879287835A86F50f784313dBEd5E5cCC5bb8481" as Hex;
const MAINNET_DOMAIN_SEPARATOR =
  "0xd96e5f90797da7ec8dc4e276260c7f3f87fedf68775fbe1ef116e996fc60441b" as Hex;

describe("toTokenAmount", () => {
  it("scales whole number USDC (6 decimals)", () => {
    expect(toTokenAmount("100", 6)).toBe(100_000_000n);
  });

  it("scales fractional USDC", () => {
    expect(toTokenAmount("1.5", 6)).toBe(1_500_000n);
  });

  it("handles zero", () => {
    expect(toTokenAmount("0", 6)).toBe(0n);
  });

  it("handles minimum USDC unit", () => {
    expect(toTokenAmount("0.000001", 6)).toBe(1n);
  });

  it("scales to 18 decimals", () => {
    expect(toTokenAmount("1", 18)).toBe(1_000_000_000_000_000_000n);
  });

  it("truncates excess decimal digits (does not round)", () => {
    // 1.1234567 with 6 decimals → should take first 6 decimal digits: 123456
    expect(toTokenAmount("1.1234567", 6)).toBe(1_123_456n);
  });

  it("scales large values", () => {
    expect(toTokenAmount("1000000", 6)).toBe(1_000_000_000_000n);
  });

  it("scales WBTC (8 decimals)", () => {
    expect(toTokenAmount("0.5", 8)).toBe(50_000_000n);
  });

  it("scales 1 BTC to 8 decimals", () => {
    expect(toTokenAmount("1", 8)).toBe(100_000_000n);
  });
});

describe("toUnitAmount", () => {
  it("converts integer to 18-decimal bigint", () => {
    expect(toUnitAmount("105000")).toBe(105000_000000000000000000n);
  });

  it("converts fractional value", () => {
    expect(toUnitAmount("0.01")).toBe(10_000_000_000_000_000n);
  });

  it("delegates to toTokenAmount with 18 decimals", () => {
    const values = ["1", "0.5", "999.123"];
    for (const v of values) {
      expect(toUnitAmount(v)).toBe(toTokenAmount(v, 18));
    }
  });
});

describe("encodeDepositData", () => {
  const params = {
    amount: 100_000_000n, // 100 USDC
    asset: "0xe80F2a02398BBf1ab2C9cc52caD1978159c215BD" as Hex,
    managerForNewAccount: "0x28bE681F7bEa6f465cbcA1D25A2125fe7533391C" as Hex,
  };

  it("produces correct ABI encoding (uint256, address, address)", () => {
    const result = encodeDepositData(params);
    const expected = encodeAbiParameters(
      parseAbiParameters("uint256, address, address"),
      [params.amount, params.asset, params.managerForNewAccount]
    );
    expect(result).toBe(expected);
  });

  it("returns a hex string", () => {
    const result = encodeDepositData(params);
    expect(result).toMatch(/^0x[0-9a-f]+$/i);
  });
});

describe("encodeWithdrawData", () => {
  const params = {
    amount: 1_000_000n, // 1 USDC
    asset: MAINNET_USDC_ADDRESS,
  };

  it("encodes with address FIRST (address, uint256)", () => {
    const result = encodeWithdrawData(params);
    const expected = encodeAbiParameters(
      parseAbiParameters("address, uint256"),
      [params.asset, params.amount]
    );
    expect(result).toBe(expected);
  });

  it("matches known withdraw encoding from debug script", () => {
    // From debug-withdraw.mjs: 1 USDC = 1_000_000 scaled, address = MAINNET_USDC_ADDRESS
    const result = encodeWithdrawData(params);
    const expectedManual = encodeAbiParameters(
      parseAbiParameters("address, uint256"),
      [MAINNET_USDC_ADDRESS, 1_000_000n]
    );
    expect(result).toBe(expectedManual);
  });
});

describe("encodeTradeData", () => {
  const baseParams = {
    assetAddress: "0x57B03E14d409ADC7fAb6CFc44b5886CAD2D5f02b" as Hex,
    subId: 0n,
    limitPrice: toUnitAmount("100000"),
    amount: toUnitAmount("0.1"),
    maxFee: toUnitAmount("10"),
    subaccountId: 61900n,
    isBid: true,
  };

  it("produces correct 7-param ABI encoding", () => {
    const result = encodeTradeData(baseParams);
    const expected = encodeAbiParameters(
      parseAbiParameters("address, uint256, int256, int256, uint256, uint256, bool"),
      [
        baseParams.assetAddress,
        baseParams.subId,
        baseParams.limitPrice,
        baseParams.amount,
        baseParams.maxFee,
        baseParams.subaccountId,
        baseParams.isBid,
      ]
    );
    expect(result).toBe(expected);
  });

  it("produces different output for isBid=false", () => {
    const buy = encodeTradeData(baseParams);
    const sell = encodeTradeData({ ...baseParams, isBid: false });
    expect(buy).not.toBe(sell);
  });
});

describe("encodeRfqExecutionData", () => {
  it("produces identical output to encodeTradeData for single-leg", () => {
    const params = {
      assetAddress: "0x57B03E14d409ADC7fAb6CFc44b5886CAD2D5f02b" as Hex,
      subId: 0n,
      limitPrice: toUnitAmount("100000"),
      amount: toUnitAmount("0.1"),
      maxFee: toUnitAmount("10"),
      subaccountId: 61900n,
      isBid: false,
    };
    expect(encodeRfqExecutionData(params)).toBe(encodeTradeData(params));
  });
});

describe("getActionHash", () => {
  it("produces a 66-char hex string", () => {
    const hash = getActionHash({
      subaccountId: 1000n,
      nonce: 123456n,
      module: "0x0000000000000000000000000000000000000001" as Hex,
      data: "0x" as Hex,
      expiry: 9999999999n,
      owner: "0x0000000000000000000000000000000000000002" as Hex,
      signer: "0x0000000000000000000000000000000000000003" as Hex,
    });
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/i);
  });

  it("matches golden value from debug-withdraw.mjs known inputs", () => {
    // Recompute using the exact values from debug-withdraw.mjs
    const withdrawData = encodeAbiParameters(
      parseAbiParameters("address, uint256"),
      [MAINNET_USDC_ADDRESS, toTokenAmount("1", 6)]
    );

    const localHash = getActionHash({
      subaccountId: KNOWN_SUBACCOUNT_ID,
      nonce: KNOWN_NONCE,
      module: MAINNET_WITHDRAWAL_MODULE,
      data: withdrawData,
      expiry: KNOWN_EXPIRY,
      owner: KNOWN_WALLET,
      signer: KNOWN_SIGNER,
    });

    // Compute expected independently
    const dataHash = keccak256(withdrawData);
    const expectedHash = keccak256(
      encodeAbiParameters(
        parseAbiParameters(
          "bytes32, uint256, uint256, address, bytes32, uint256, address, address"
        ),
        [
          ACTION_TYPEHASH,
          KNOWN_SUBACCOUNT_ID,
          KNOWN_NONCE,
          MAINNET_WITHDRAWAL_MODULE,
          dataHash,
          KNOWN_EXPIRY,
          KNOWN_WALLET,
          KNOWN_SIGNER,
        ]
      )
    );

    expect(localHash).toBe(expectedHash);
  });
});

describe("toTypedDataHash", () => {
  it("applies 0x1901 prefix correctly", () => {
    const domainSep = MAINNET_DOMAIN_SEPARATOR;
    const actionHash =
      "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex;

    const result = toTypedDataHash(domainSep, actionHash);
    const expected = keccak256(
      encodePacked(
        ["bytes2", "bytes32", "bytes32"],
        ["0x1901", domainSep, actionHash]
      )
    );
    expect(result).toBe(expected);
  });

  it("produces consistent output for debug-withdraw.mjs scenario", () => {
    const withdrawData = encodeAbiParameters(
      parseAbiParameters("address, uint256"),
      [MAINNET_USDC_ADDRESS, toTokenAmount("1", 6)]
    );

    const actionHash = getActionHash({
      subaccountId: KNOWN_SUBACCOUNT_ID,
      nonce: KNOWN_NONCE,
      module: MAINNET_WITHDRAWAL_MODULE,
      data: withdrawData,
      expiry: KNOWN_EXPIRY,
      owner: KNOWN_WALLET,
      signer: KNOWN_SIGNER,
    });

    const result = toTypedDataHash(MAINNET_DOMAIN_SEPARATOR, actionHash);
    expect(result).toMatch(/^0x[0-9a-f]{64}$/i);
  });
});

describe("signAction", () => {
  it("produces a recoverable signature (no EIP-191 prefix)", async () => {
    const testModule = "0x0000000000000000000000000000000000000001" as Hex;
    const testData = encodeAbiParameters(
      parseAbiParameters("uint256"),
      [42n]
    );
    const nonce = 12345n;
    const expiry = 9999999999n;
    const owner = TEST_ACCOUNT.address;

    const signature = await signAction({
      subaccountId: 1000n,
      nonce,
      module: testModule,
      data: testData,
      expiry,
      owner,
      sessionPrivateKey: TEST_PRIVATE_KEY,
      env: "testnet",
    });

    // Verify: recover the signer from the signature
    const domainSep = getDomainSeparator("testnet");
    const actionHash = getActionHash({
      subaccountId: 1000n,
      nonce,
      module: testModule,
      data: testData,
      expiry,
      owner,
      signer: TEST_ACCOUNT.address,
    });
    const typedDataHash = toTypedDataHash(domainSep, actionHash);

    const recovered = await recoverAddress({
      hash: typedDataHash,
      signature,
    });

    expect(recovered.toLowerCase()).toBe(TEST_ACCOUNT.address.toLowerCase());
  });
});

describe("getDomainSeparator", () => {
  it("returns testnet domain separator", () => {
    expect(getDomainSeparator("testnet")).toBe(
      "0x9bcf4dc06df5d8bf23af818d5716491b995020f377d3b7b64c29ed14e3dd1105"
    );
  });

  it("returns mainnet domain separator", () => {
    expect(getDomainSeparator("mainnet")).toBe(
      "0xd96e5f90797da7ec8dc4e276260c7f3f87fedf68775fbe1ef116e996fc60441b"
    );
  });
});

describe("getEip712Domain", () => {
  it("returns testnet domain", () => {
    const domain = getEip712Domain("testnet");
    expect(domain.name).toBe("Matching");
    expect(domain.version).toBe("1.0");
    expect(domain.chainId).toBe(901);
    expect(domain.verifyingContract).toBe(
      "0xeB8d770ec18DB98Db922E9D83260A585b9F0DeAD"
    );
  });

  it("returns mainnet domain", () => {
    const domain = getEip712Domain("mainnet");
    expect(domain.chainId).toBe(957);
  });
});

describe("generateNonce", () => {
  it("returns a number", () => {
    expect(typeof generateNonce()).toBe("number");
  });

  it("is roughly Date.now() * 1000", () => {
    const nonce = generateNonce();
    const expected = Date.now() * 1000;
    // Within 2 seconds
    expect(Math.abs(nonce - expected)).toBeLessThan(2_000_000);
  });

  it("two calls produce different values", () => {
    const a = generateNonce();
    const b = generateNonce();
    // Technically could collide but extremely unlikely
    expect(a).not.toBe(b);
  });
});

describe("getSignatureExpiry", () => {
  it("defaults to 600 seconds from now", () => {
    const now = Math.floor(Date.now() / 1000);
    const expiry = getSignatureExpiry();
    expect(expiry).toBeGreaterThanOrEqual(now + 599);
    expect(expiry).toBeLessThanOrEqual(now + 601);
  });

  it("accepts custom duration", () => {
    const now = Math.floor(Date.now() / 1000);
    const expiry = getSignatureExpiry(3600);
    expect(expiry).toBeGreaterThanOrEqual(now + 3599);
    expect(expiry).toBeLessThanOrEqual(now + 3601);
  });
});
