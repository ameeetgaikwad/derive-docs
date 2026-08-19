import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Address, Hex } from "viem";
import { afterEach, describe, expect, it } from "vitest";
import { buildWithdrawalAction, getActionDigest } from "@hedge/shared";
import {
  InMemoryWithdrawalOperationStore,
  JsonlWithdrawalOperationStore,
  type WithdrawalOperationStore,
} from "../src/withdrawal-store.js";
import type { WithdrawalOperation } from "../src/withdrawal-types.js";

const MATCHING = "0x2E2Ed0Cfd3AD2f1d34481277b3204d807Ca2F8c2" as Address;
const MODULE = "0x8198f5d8F8CfFE8f9C413d98a0A55aEB8ab9FbB7" as Address;
const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const ASSET = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as Address;
const TOKEN = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0" as Address;
const BLOCK_HASH = (`0x${"11".repeat(32)}`) as Hex;
const TX_HASH = (`0x${"ab".repeat(32)}`) as Hex;

const tempDirectories: string[] = [];
afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function operation(id: string, key = "owner:idempotency-key"): WithdrawalOperation {
  const action = buildWithdrawalAction({
    subaccountId: 11n,
    withdrawalModule: MODULE,
    asset: ASSET,
    assetAmount: 123_456_789n,
    owner: OWNER,
    nonce: BigInt(`0x${"44".repeat(32)}`),
    expiry: 1_700n,
  });
  return {
    id,
    idempotencyKey: key,
    requestFingerprint: (`0x${"22".repeat(32)}`) as Hex,
    status: "prepared",
    chainId: 31337,
    matching: MATCHING,
    owner: OWNER,
    subaccountId: 11n,
    asset: {
      assetId: "market:BTC",
      kind: "market-collateral",
      marketId: "BTC",
      symbol: "BTCB",
      assetAddress: ASSET,
      tokenAddress: TOKEN,
      tokenDecimals: 8,
      scaledUi: true,
    },
    tokenUnits: 123_456_789n,
    maxWithdrawableAtPrepare: 200_000_000n,
    previewBlockHash: BLOCK_HASH,
    preparedAtBlockNumber: 100n,
    preparedAtBlockHash: BLOCK_HASH,
    action,
    actionDigest: getActionDigest(action, 31337, MATCHING),
    review: {
      recipient: OWNER,
      assetId: "market:BTC",
      assetAddress: ASSET,
      tokenAddress: TOKEN,
      tokenUnits: "123456789",
      displayAmount: "2.46913578",
      tokenDecimals: 8,
      multiplier: "2000000000000000000",
      preparedBlockNumber: "100",
      preparedBlockHash: BLOCK_HASH,
    },
    createdAt: 1_000_000,
    expiresAt: 1_600_000,
    submittedAt: null,
    confirmedAt: null,
    txHash: null,
    blockNumber: null,
    error: null,
  };
}

async function assertAtomicClaim(store: WithdrawalOperationStore): Promise<void> {
  const first = operation("11111111-1111-4111-8111-111111111111");
  const second = operation("22222222-2222-4222-8222-222222222222");
  const [a, b] = await Promise.all([
    store.putIfIdempotencyAbsent(first),
    store.putIfIdempotencyAbsent(second),
  ]);
  expect([a, b].filter((result) => result.inserted)).toHaveLength(1);
  expect(a.operation.id).toBe(b.operation.id);
  expect(await store.list()).toHaveLength(1);
}

describe("withdrawal operation stores", () => {
  it("atomically claims an idempotency key in memory", async () => {
    await assertAtomicClaim(new InMemoryWithdrawalOperationStore());
  });

  it("atomically claims an idempotency key in the durable store", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hedge-funds-store-"));
    tempDirectories.push(directory);
    await assertAtomicClaim(new JsonlWithdrawalOperationStore(join(directory, "funds.jsonl")));
  });

  it("round-trips frozen action/review/digest and the immediately persisted tx hash", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hedge-funds-store-"));
    tempDirectories.push(directory);
    const path = join(directory, "funds.jsonl");
    const store = new JsonlWithdrawalOperationStore(path);
    const original = operation("33333333-3333-4333-8333-333333333333");
    await store.put(original);

    original.status = "submitted";
    original.submittedAt = 1_000_010;
    original.txHash = TX_HASH;
    await store.put(original);

    const reopened = new JsonlWithdrawalOperationStore(path);
    const restored = await reopened.get(original.id);
    expect(restored).toEqual(original);
    expect(restored?.actionDigest).toBe(original.actionDigest);
    expect(restored?.review).toEqual(original.review);
    expect(restored?.txHash).toBe(TX_HASH);

    const records = readFileSync(path, "utf8").trim().split("\n");
    expect(records).toHaveLength(2);
    expect(JSON.parse(records[1]!) as Record<string, unknown>).toMatchObject({
      status: "submitted",
      txHash: TX_HASH,
      actionDigest: original.actionDigest,
      review: original.review,
    });
  });

  it("ignores a torn final append while retaining the last fully synced record", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hedge-funds-store-"));
    tempDirectories.push(directory);
    const path = join(directory, "funds.jsonl");
    const store = new JsonlWithdrawalOperationStore(path);
    const valid = operation("44444444-4444-4444-8444-444444444444");
    await store.put(valid);
    appendFileSync(path, '{"id":"torn","status":"submitted"');

    const reopened = new JsonlWithdrawalOperationStore(path);
    expect(await reopened.get(valid.id)).toEqual(valid);
    expect(await reopened.get("torn")).toBeNull();
    expect(await reopened.list()).toHaveLength(1);
  });
});
