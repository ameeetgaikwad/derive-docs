import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { encodeOptionSubId, toUnit } from "@hedge/shared";
import { getAddress, numberToHex, type Address, type Hex, type PublicClient } from "viem";
import { afterEach, describe, expect, it } from "vitest";

import {
  ActiveExpiryIndex,
  applyBalanceAdjustment,
  decodeAssetAndSubId,
  type IndexedOptionPosition,
} from "../src/activeExpiryIndex.js";

const SUB_ACCOUNTS = "0x1111111111111111111111111111111111111111" as Address;
const OPTION_ASSET = "0x2222222222222222222222222222222222222222" as Address;
const CASH_ASSET = "0x3333333333333333333333333333333333333333" as Address;
const EXPIRY = 1_786_694_400n;
const SUB_ID = encodeOptionSubId({ expiry: EXPIRY, strike: toUnit("65000"), isCall: true });

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("active expiry index", () => {
  it("decodes the SubAccounts address/subId packing and ignores other assets", () => {
    const packed = packAssetAndSubId(OPTION_ASSET, SUB_ID);
    expect(decodeAssetAndSubId(packed)).toEqual({ asset: getAddress(OPTION_ASSET), subId: SUB_ID });

    const positions = new Map<string, IndexedOptionPosition>();
    applyBalanceAdjustment(positions, {
      accountId: 4n,
      assetAndSubId: packAssetAndSubId(CASH_ASSET, 0n),
      postBalance: 10n,
      optionAsset: OPTION_ASSET,
    });
    expect(positions.size).toBe(0);
  });

  it("persists non-zero post-balances and removes an expiry only after the closing event", async () => {
    const directory = await mkdtemp(join(tmpdir(), "oracle-expiry-index-"));
    temporaryDirectories.push(directory);
    const statePath = join(directory, "state.json");
    const chain = new FakeChain();
    chain.head = 20n;
    chain.logs.push(balanceLog(12n, 4n, SUB_ID, toUnit("0.001")));
    chain.logs.push(balanceLog(13n, 5n, SUB_ID, -toUnit("0.001")));

    const first = new ActiveExpiryIndex({
      publicClient: chain.client,
      chainId: 97,
      addresses: { subAccounts: SUB_ACCOUNTS, optionAsset: OPTION_ASSET },
      statePath,
      fromBlock: 10n,
      confirmations: 0n,
      chunkSize: 3n,
      log: () => undefined,
    });
    await first.sync();
    expect(first.activeExpiries(EXPIRY - 1n)).toEqual([EXPIRY]);
    expect(first.expiredSeries(EXPIRY)).toEqual([
      { expiry: EXPIRY, subaccounts: [4n, 5n], subIds: [SUB_ID] },
    ]);

    // A restart resumes from the durable checkpoint. Settlement then emits a
    // zero postBalance for each holder, which is the only removal condition.
    chain.head = 22n;
    chain.logs.push(balanceLog(21n, 4n, SUB_ID, 0n));
    chain.logs.push(balanceLog(22n, 5n, SUB_ID, 0n));
    const restarted = new ActiveExpiryIndex({
      publicClient: chain.client,
      chainId: 97,
      addresses: { subAccounts: SUB_ACCOUNTS, optionAsset: OPTION_ASSET },
      statePath,
      fromBlock: 10n,
      confirmations: 0n,
      chunkSize: 3n,
      log: () => undefined,
    });
    await restarted.sync();
    expect(restarted.positions()).toEqual([]);
    expect(restarted.expiredSeries(EXPIRY)).toEqual([]);
  });

  it("rebuilds an unreadable checkpoint from the configured deployment block", async () => {
    const directory = await mkdtemp(join(tmpdir(), "oracle-expiry-corrupt-"));
    temporaryDirectories.push(directory);
    const statePath = join(directory, "state.json");
    await writeFile(statePath, "{}\n");
    const chain = new FakeChain();
    chain.head = 10n;
    const messages: string[] = [];
    const index = new ActiveExpiryIndex({
      publicClient: chain.client,
      chainId: 97,
      addresses: { subAccounts: SUB_ACCOUNTS, optionAsset: OPTION_ASSET },
      statePath,
      fromBlock: 10n,
      confirmations: 0n,
      log: (message) => messages.push(message),
    });
    await index.sync();
    expect(index.checkpoint()).toEqual({ fromBlock: 10n, lastScannedBlock: 10n, positionCount: 0 });
    expect(messages.join(" ")).toMatch(/unreadable.*rebuilding/);
  });
});

function packAssetAndSubId(asset: Address, subId: bigint): Hex {
  return numberToHex((BigInt(asset) << 96n) | subId, { size: 32 });
}

function balanceLog(blockNumber: bigint, accountId: bigint, subId: bigint, postBalance: bigint) {
  return {
    blockNumber,
    args: {
      accountId,
      manager: "0x4444444444444444444444444444444444444444" as Address,
      assetAndSubId: packAssetAndSubId(OPTION_ASSET, subId),
      amount: postBalance,
      preBalance: 0n,
      postBalance,
      tradeId: 1n,
    },
  };
}

class FakeChain {
  head = 0n;
  logs: ReturnType<typeof balanceLog>[] = [];

  readonly client = {
    getBlockNumber: async () => this.head,
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({
      hash: numberToHex(blockNumber + 1n, { size: 32 }),
    }),
    getBytecode: async ({ blockNumber }: { blockNumber: bigint }) =>
      blockNumber >= 10n ? ("0x01" as Hex) : undefined,
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) =>
      this.logs.filter((log) => log.blockNumber >= fromBlock && log.blockNumber <= toBlock),
  } as unknown as PublicClient;
}
