import { decodeAbiParameters, recoverTypedDataAddress, verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  buildAction,
  encodeDepositData,
  encodeTransferData,
  encodeWithdrawData,
  getActionDigest,
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

  it("module data encodings round-trip with abi.decode shapes", () => {
    const withdraw = encodeWithdrawData({ asset: MODULE, assetAmount: 5n });
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
    expect(w.assetAmount).toBe(5n);

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
