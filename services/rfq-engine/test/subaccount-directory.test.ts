import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";
import {
  InMemorySubaccountDirectoryStore,
  StoredSubaccountDirectoryReader,
  SubaccountDirectoryIndexer,
  type DirectoryChainReader,
  type DirectoryCheckpoint,
  type DirectoryEvent,
  type DirectoryNetwork,
} from "../src/subaccount-directory.js";
import { ViemDirectoryChainReader } from "../src/viem-subaccount-directory.js";

const MATCHING = "0x2E2Ed0Cfd3AD2f1d34481277b3204d807Ca2F8c2" as Address;
const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const OTHER_OWNER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;
const HASH_A = `0x${"aa".repeat(32)}` as Hex;
const HASH_B = `0x${"bb".repeat(32)}` as Hex;
const TX_HASH = `0x${"11".repeat(32)}` as Hex;

const NETWORK: DirectoryNetwork = {
  chainId: 31337,
  matching: MATCHING,
  deploymentBlock: 10n,
};

function deposited(
  accountId: bigint,
  owner: Address,
  blockNumber: bigint,
  transactionIndex = 0,
  logIndex = 0,
): DirectoryEvent {
  return {
    type: "deposited",
    accountId,
    owner,
    blockNumber,
    transactionIndex,
    logIndex,
    transactionHash: TX_HASH,
  };
}

function withdrew(
  accountId: bigint,
  blockNumber: bigint,
  transactionIndex = 0,
  logIndex = 0,
): DirectoryEvent {
  return {
    type: "withdrew",
    accountId,
    blockNumber,
    transactionIndex,
    logIndex,
    transactionHash: TX_HASH,
  };
}

class FakeDirectoryChain implements DirectoryChainReader {
  head = 15n;
  events: DirectoryEvent[] = [];
  readonly requestedRanges: { fromBlock: bigint; toBlock: bigint }[] = [];
  readonly hashes = new Map<bigint, Hex>();

  async getBlockNumber(): Promise<bigint> {
    return this.head;
  }

  async getBlockHash(blockNumber: bigint): Promise<Hex> {
    const hash = this.hashes.get(blockNumber);
    if (!hash) throw new Error(`missing hash for block ${blockNumber}`);
    return hash;
  }

  async getEvents(fromBlock: bigint, toBlock: bigint): Promise<DirectoryEvent[]> {
    this.requestedRanges.push({ fromBlock, toBlock });
    return this.events.filter(
      (event) => event.blockNumber >= fromBlock && event.blockNumber <= toBlock,
    );
  }
}

describe("SubaccountDirectoryIndexer", () => {
  it("does not expose a first-sync checkpoint until catch-up is complete", async () => {
    const store = new InMemorySubaccountDirectoryStore();
    const reader = new StoredSubaccountDirectoryReader(NETWORK, store);
    await store.setCheckpoint(NETWORK, {
      blockNumber: 12n,
      blockHash: HASH_A,
      ready: false,
    } satisfies DirectoryCheckpoint);

    await expect(reader.getAccounts(OWNER)).rejects.toThrow("first sync");
  });

  it("marks only the final first-sync chunk ready", async () => {
    const chain = new FakeDirectoryChain();
    chain.hashes.set(11n, HASH_A);
    chain.hashes.set(13n, HASH_A);
    chain.hashes.set(15n, HASH_B);
    const store = new InMemorySubaccountDirectoryStore();
    const checkpoints: DirectoryCheckpoint[] = [];
    const persistCheckpoint = store.setCheckpoint.bind(store);
    store.setCheckpoint = async (network, checkpoint) => {
      checkpoints.push(checkpoint);
      await persistCheckpoint(network, checkpoint);
    };
    const indexer = new SubaccountDirectoryIndexer({
      network: NETWORK,
      chain,
      store,
      confirmationBlocks: 0n,
      chunkSize: 2n,
    });

    await indexer.syncOnce();

    expect(checkpoints.map((checkpoint) => checkpoint.ready)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("projects deposits and withdrawals in canonical log order", async () => {
    const chain = new FakeDirectoryChain();
    chain.hashes.set(15n, HASH_A);
    chain.events = [
      withdrew(42n, 12n, 1, 0),
      deposited(57n, OWNER, 11n, 1, 1),
      deposited(42n, OWNER, 11n, 1, 0),
      deposited(99n, OTHER_OWNER, 11n, 1, 2),
    ];
    const store = new InMemorySubaccountDirectoryStore();
    const indexer = new SubaccountDirectoryIndexer({
      network: NETWORK,
      chain,
      store,
      confirmationBlocks: 0n,
      chunkSize: 100n,
    });

    await indexer.syncOnce();

    await expect(store.listActiveAccountIds(NETWORK, OWNER)).resolves.toEqual([57n]);
    await expect(store.listActiveAccountIds(NETWORK, OTHER_OWNER)).resolves.toEqual([99n]);
    await expect(store.getCheckpoint(NETWORK)).resolves.toEqual({
      blockNumber: 15n,
      blockHash: HASH_A,
      ready: true,
    });
  });

  it("resumes a new worker after the durable checkpoint", async () => {
    const chain = new FakeDirectoryChain();
    chain.hashes.set(15n, HASH_A);
    const store = new InMemorySubaccountDirectoryStore();
    await store.applyEvent(NETWORK, deposited(57n, OWNER, 11n));
    await store.setCheckpoint(NETWORK, {
      blockNumber: 15n,
      blockHash: HASH_A,
      ready: true,
    });

    chain.head = 16n;
    chain.hashes.set(16n, HASH_B);
    chain.events = [deposited(88n, OWNER, 16n)];
    const restarted = new SubaccountDirectoryIndexer({
      network: NETWORK,
      chain,
      store,
      confirmationBlocks: 0n,
      chunkSize: 100n,
    });

    await restarted.syncOnce();

    expect(chain.requestedRanges).toEqual([{ fromBlock: 16n, toBlock: 16n }]);
    await expect(store.listActiveAccountIds(NETWORK, OWNER)).resolves.toEqual([57n, 88n]);
  });

  it("cleans stale projection rows before rebuilding when no checkpoint exists", async () => {
    const chain = new FakeDirectoryChain();
    chain.hashes.set(15n, HASH_A);
    const store = new InMemorySubaccountDirectoryStore();
    await store.applyEvent(NETWORK, deposited(57n, OWNER, 14n));
    const indexer = new SubaccountDirectoryIndexer({
      network: NETWORK,
      chain,
      store,
      confirmationBlocks: 0n,
      chunkSize: 100n,
    });

    await indexer.syncOnce();

    await expect(store.listActiveAccountIds(NETWORK, OWNER)).resolves.toEqual([]);
    expect(store.resetCount).toBe(1);
  });

  it("rebuilds from deployment when the checkpoint hash is no longer canonical", async () => {
    const chain = new FakeDirectoryChain();
    const store = new InMemorySubaccountDirectoryStore();
    await store.applyEvent(NETWORK, deposited(57n, OWNER, 11n));
    await store.setCheckpoint(NETWORK, {
      blockNumber: 15n,
      blockHash: HASH_A,
      ready: true,
    });

    chain.hashes.set(15n, HASH_B);
    chain.events = [deposited(101n, OWNER, 12n)];
    const indexer = new SubaccountDirectoryIndexer({
      network: NETWORK,
      chain,
      store,
      confirmationBlocks: 0n,
      chunkSize: 100n,
    });

    await indexer.syncOnce();

    expect(chain.requestedRanges).toEqual([{ fromBlock: 10n, toBlock: 15n }]);
    await expect(store.listActiveAccountIds(NETWORK, OWNER)).resolves.toEqual([101n]);
    expect(store.resetCount).toBe(1);
  });
});

describe("ViemDirectoryChainReader", () => {
  it("maps both Matching event variants with their canonical log positions", async () => {
    const publicClient = {
      async getBlockNumber() {
        return 20n;
      },
      async getBlock({ blockNumber }: { blockNumber: bigint }) {
        return { number: blockNumber, hash: HASH_A };
      },
      async getLogs() {
        return [
          {
            eventName: "DepositedSubAccount",
            args: { accountId: 42n, owner: OWNER },
            blockNumber: 11n,
            transactionIndex: 2,
            logIndex: 3,
            transactionHash: TX_HASH,
          },
          {
            eventName: "WithdrewSubAccount",
            args: { accountId: 42n },
            blockNumber: 12n,
            transactionIndex: 1,
            logIndex: 0,
            transactionHash: TX_HASH,
          },
        ];
      },
    };
    const reader = new ViemDirectoryChainReader(publicClient, MATCHING);

    await expect(reader.getEvents(10n, 20n)).resolves.toEqual([
      deposited(42n, OWNER, 11n, 2, 3),
      withdrew(42n, 12n, 1, 0),
    ]);
    await expect(reader.getBlockNumber()).resolves.toBe(20n);
    await expect(reader.getBlockHash(15n)).resolves.toBe(HASH_A);
  });
});
