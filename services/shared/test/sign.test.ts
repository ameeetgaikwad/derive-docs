import { decodeAbiParameters, recoverTypedDataAddress, verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  buildAction,
  buildWithdrawalAction,
  decodeWithdrawData,
  encodeDepositData,
  encodeTransferData,
  encodeWithdrawData,
  generateNonce,
  getActionDigest,
  getActionTypedData,
  getDomainSeparator,
  hashActionTypedData,
  signAction,
} from "../src/actions.js";
import { ACTION_TYPES, matchingDomain } from "../src/constants.js";

// anvil default key #0
const PK = "0xac0974bec39a17e36ba4a6b4d7838d2bb7f51347dba71d4462a13a86df0bf032" as const;
const account = privateKeyToAccount(PK);

const CHAIN_ID = 31337;
const MATCHING = "0x00000000000000000000000000000000000000aa" as const;
const MODULE = "0x00000000000000000000000000000000000000bb" as const;

describe("Action signing", () => {
  const action = buildAction({
    subaccountId: 1n,
    module: MODULE,
    data: encodeDepositData({
      amount: 10n ** 18n,
      asset: "0x00000000000000000000000000000000000000cc",
      managerForNewAccount: "0x00000000000000000000000000000000000000dd",
    }),
    owner: account.address,
    nonce: 42n,
    expiry: 1900000000n,
  });

  it("manual abi.encode struct-hash path equals viem hashTypedData", () => {
    // Cross-checks our ACTION_TYPES definition against the raw
    // abi.encode(typehash, ..., keccak256(data), ...) per ActionVerifier.sol
    expect(getActionDigest(action, CHAIN_ID, MATCHING)).toBe(
      hashActionTypedData(action, CHAIN_ID, MATCHING),
    );
  });

  it("signs an action and recovers the signer", async () => {
    const signature = await signAction({
      action,
      signer: account,
      chainId: CHAIN_ID,
      matchingAddress: MATCHING,
    });

    const recovered = await recoverTypedDataAddress({
      domain: matchingDomain(CHAIN_ID, MATCHING) as never,
      types: ACTION_TYPES,
      primaryType: "Action",
      message: action,
      signature,
    });
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());

    const valid = await verifyTypedData({
      address: account.address,
      domain: matchingDomain(CHAIN_ID, MATCHING) as never,
      types: ACTION_TYPES,
      primaryType: "Action",
      message: action,
      signature,
    });
    expect(valid).toBe(true);
  });

  it("domain separator is stable for a fixed deployment", () => {
    const a = getDomainSeparator(CHAIN_ID, MATCHING);
    const b = getDomainSeparator(CHAIN_ID, MATCHING);
    expect(a).toBe(b);
    expect(getDomainSeparator(97, MATCHING)).not.toBe(a);
  });

  it("generates browser/server-safe uint256 nonces with full-width entropy", () => {
    const nonces = Array.from({ length: 64 }, () => generateNonce());
    const uint256Max = (1n << 256n) - 1n;

    expect(new Set(nonces).size).toBe(nonces.length);
    expect(nonces.every((nonce) => nonce >= 0n && nonce <= uint256Max)).toBe(true);
    // A timestamp/random suffix nonce is far below this boundary. Web Crypto
    // output exceeds it with overwhelming probability.
    expect(nonces.some((nonce) => nonce >= 1n << 128n)).toBe(true);
  });

  it("returns the canonical wallet-signable Action typed data", () => {
    expect(getActionTypedData(action, CHAIN_ID, MATCHING)).toEqual({
      domain: {
        name: "Matching",
        version: "1.0",
        chainId: CHAIN_ID,
        verifyingContract: MATCHING,
      },
      types: ACTION_TYPES,
      primaryType: "Action",
      message: action,
    });
  });

  it("module data encodings round-trip with abi.decode shapes", () => {
    // 1.234567 units of a six-decimal token. WithdrawalModule passes this
    // integer through unchanged; the helper must not scale it to 18 decimals.
    const nativeTokenAmount = 1_234_567n;
    const withdraw = encodeWithdrawData({ asset: MODULE, assetAmount: nativeTokenAmount });
    const [w] = decodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { name: "asset", type: "address" },
            { name: "assetAmount", type: "uint256" },
          ],
        },
      ],
      withdraw,
    );
    expect(w.assetAmount).toBe(nativeTokenAmount);
    expect(decodeWithdrawData(withdraw)).toEqual({
      asset: MODULE,
      assetAmount: nativeTokenAmount,
    });

    const withdrawalAction = buildWithdrawalAction({
      subaccountId: 7n,
      withdrawalModule: MODULE,
      asset: MODULE,
      assetAmount: nativeTokenAmount,
      owner: account.address,
      nonce: 99n,
      expiry: 1_900_000_000n,
    });
    expect(withdrawalAction.module).toBe(MODULE);
    expect(withdrawalAction.signer).toBe(account.address);
    expect(decodeWithdrawData(withdrawalAction.data).assetAmount).toBe(nativeTokenAmount);

    const transfer = encodeTransferData({
      toAccountId: 7n,
      managerForNewAccount: MODULE,
      transfers: [{ asset: MODULE, subId: 9n, amount: -3n }],
    });
    const [t] = decodeAbiParameters(
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
      transfer,
    );
    expect(t.transfers[0]?.amount).toBe(-3n);
  });
});
