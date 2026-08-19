import { encodeAbiParameters } from "viem";
import { describe, expect, it } from "vitest";
import { ACTION_TYPES } from "@/lib/protocol/constants";
import type { PreparedWithdrawalResponse, WithdrawalPreview } from "@/lib/protocol/withdrawals";
import { validatePreparedWithdrawal } from "./useWithdraw";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const MATCHING = "0x2222222222222222222222222222222222222222" as const;
const MODULE = "0x3333333333333333333333333333333333333333" as const;
const ASSET = "0x4444444444444444444444444444444444444444" as const;
const TOKEN = "0x5555555555555555555555555555555555555555" as const;
const HASH = `0x${"6".repeat(64)}` as const;
const PREPARED_HASH = `0x${"7".repeat(64)}` as const;

function fixtures() {
  const data = encodeAbiParameters([{ type: "tuple", components: [
    { name: "asset", type: "address" }, { name: "assetAmount", type: "uint256" },
  ] }], [{ asset: ASSET, assetAmount: 1_250_000n }]);
  const action = { subaccountId: "7", nonce: "1", module: MODULE, data, expiry: "1900000000", owner: OWNER, signer: OWNER };
  const preview: WithdrawalPreview = {
    chainId: 97, matching: MATCHING, withdrawalModule: MODULE, owner: OWNER,
    subaccountId: "7", asset: { assetId: "cash", kind: "cash", marketId: null, symbol: "USDT", assetAddress: ASSET, tokenAddress: TOKEN, tokenDecimals: 6, scaledUi: false },
    internalBalance: "2000000000000000000", balanceTokenUnits: "2000000", cashWithInterest: "2000000000000000000", debtTokenUnits: "0",
    margin: { initial: { margin: "0", markToMarket: "0" }, maintenance: { margin: "0", markToMarket: "0" } },
    protocolMaxTokenUnits: "2000000", recommendedMaxTokenUnits: "1900000", multiplier: "1000000000000000000",
    blockNumber: "100", blockHash: HASH, checkedAt: 1, expiresAt: Date.now() + 30_000, blocker: null,
  };
  const prepared: PreparedWithdrawalResponse = {
    withdrawalId: "w-1", action,
    typedData: { domain: { name: "Matching", version: "1.0", chainId: 97, verifyingContract: MATCHING }, types: ACTION_TYPES, primaryType: "Action", message: action },
    review: { recipient: OWNER, assetId: "cash", assetAddress: ASSET, tokenAddress: TOKEN, tokenUnits: "1250000", displayAmount: "1.25", tokenDecimals: 6, multiplier: "1000000000000000000", preparedBlockNumber: "101", preparedBlockHash: PREPARED_HASH },
  };
  const context = { owner: OWNER, chainId: 97 as const, matching: MATCHING, withdrawalModule: MODULE, subaccountId: 7n, assetId: "cash" as const, protocolAsset: ASSET, tokenAddress: TOKEN, tokenUnits: 1_250_000n, idempotencyKey: "key", formSnapshot: { displayAmount: "1.25", tokenUnits: 1_250_000n, tokenDecimals: 6, multiplier: "1000000000000000000" } };
  return { preview, prepared, context };
}

describe("validatePreparedWithdrawal", () => {
  it("accepts a newer prepared block while binding the frozen form and action data", () => {
    const { preview, prepared, context } = fixtures();
    expect(validatePreparedWithdrawal(prepared, preview, context).data).toBe(prepared.action.data);
  });

  it("rejects opaque action data for a different asset even if the visible review is unchanged", () => {
    const { preview, prepared, context } = fixtures();
    prepared.action = { ...prepared.action, data: encodeAbiParameters([{ type: "tuple", components: [
      { name: "asset", type: "address" }, { name: "assetAmount", type: "uint256" },
    ] }], [{ asset: TOKEN, assetAmount: 1_250_000n }]) };
    prepared.typedData = { ...prepared.typedData, message: prepared.action };
    expect(() => validatePreparedWithdrawal(prepared, preview, context)).toThrow(/asset or amount/i);
  });

  it("rejects a server display review that differs from the frozen form", () => {
    const { preview, prepared, context } = fixtures();
    prepared.review = { ...prepared.review, displayAmount: "1.26" };
    expect(() => validatePreparedWithdrawal(prepared, preview, context)).toThrow(/changed/i);
  });

  it("rejects a server asset address that differs from the selected deployment", () => {
    const { preview, prepared, context } = fixtures();
    const unexpected = "0x6666666666666666666666666666666666666666" as const;
    preview.asset = { ...preview.asset, assetAddress: unexpected };
    prepared.review = { ...prepared.review, assetAddress: unexpected };
    prepared.action = { ...prepared.action, data: encodeAbiParameters([{ type: "tuple", components: [
      { name: "asset", type: "address" }, { name: "assetAmount", type: "uint256" },
    ] }], [{ asset: unexpected, assetAmount: 1_250_000n }]) };
    prepared.typedData = { ...prepared.typedData, message: prepared.action };
    expect(() => validatePreparedWithdrawal(prepared, preview, context)).toThrow(/reviewed request/i);
  });
});
