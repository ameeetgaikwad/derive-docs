import type { Address, Hex } from "viem";

export interface DirectoryNetwork {
  chainId: number;
  matching: Address;
  deploymentBlock: bigint;
}

export interface DirectoryCheckpoint {
  blockNumber: bigint;
  blockHash: Hex;
  ready: boolean;
}

interface DirectoryEventPosition {
  blockNumber: bigint;
  transactionIndex: number;
  logIndex: number;
  transactionHash: Hex;
}

export interface DepositedSubaccountEvent extends DirectoryEventPosition {
  type: "deposited";
  accountId: bigint;
  owner: Address;
}

export interface WithdrewSubaccountEvent extends DirectoryEventPosition {
  type: "withdrew";
  accountId: bigint;
}

export type DirectoryEvent = DepositedSubaccountEvent | WithdrewSubaccountEvent;

export interface DirectoryChainReader {
  getBlockNumber(): Promise<bigint>;
  getBlockHash(blockNumber: bigint): Promise<Hex>;
  getEvents(fromBlock: bigint, toBlock: bigint): Promise<DirectoryEvent[]>;
}

export interface SubaccountDirectoryStore {
  getCheckpoint(network: DirectoryNetwork): Promise<DirectoryCheckpoint | null>;
  setCheckpoint(network: DirectoryNetwork, checkpoint: DirectoryCheckpoint): Promise<void>;
  applyEvent(network: DirectoryNetwork, event: DirectoryEvent): Promise<void>;
  listActiveAccountIds(network: DirectoryNetwork, owner: Address): Promise<bigint[]>;
  reset(network: DirectoryNetwork): Promise<void>;
}

interface StoredDirectoryAccount {
  accountId: bigint;
  owner: Address;
  active: boolean;
  position: DirectoryEventPosition;
}

function networkKey(network: DirectoryNetwork): string {
  return `${network.chainId}:${network.matching.toLowerCase()}`;
}

function comparePositions(left: DirectoryEventPosition, right: DirectoryEventPosition): number {
  if (left.blockNumber !== right.blockNumber) return left.blockNumber < right.blockNumber ? -1 : 1;
  if (left.transactionIndex !== right.transactionIndex) {
    return left.transactionIndex - right.transactionIndex;
  }
  return left.logIndex - right.logIndex;
}

/** In-memory implementation used by deterministic worker tests. */
export class InMemorySubaccountDirectoryStore implements SubaccountDirectoryStore {
  private readonly accounts = new Map<string, Map<bigint, StoredDirectoryAccount>>();
  private readonly checkpoints = new Map<string, DirectoryCheckpoint>();
  resetCount = 0;

  async getCheckpoint(network: DirectoryNetwork): Promise<DirectoryCheckpoint | null> {
    return this.checkpoints.get(networkKey(network)) ?? null;
  }

  async setCheckpoint(
    network: DirectoryNetwork,
    checkpoint: DirectoryCheckpoint,
  ): Promise<void> {
    this.checkpoints.set(networkKey(network), checkpoint);
  }

  async applyEvent(network: DirectoryNetwork, event: DirectoryEvent): Promise<void> {
    const key = networkKey(network);
    const accounts = this.accounts.get(key) ?? new Map<bigint, StoredDirectoryAccount>();
    this.accounts.set(key, accounts);
    const existing = accounts.get(event.accountId);
    if (existing && comparePositions(event, existing.position) <= 0) return;

    if (event.type === "withdrew") {
      if (!existing) {
        throw new Error(`withdrawal for unknown subaccount ${event.accountId}`);
      }
      accounts.set(event.accountId, { ...existing, active: false, position: event });
      return;
    }

    accounts.set(event.accountId, {
      accountId: event.accountId,
      owner: event.owner,
      active: true,
      position: event,
    });
  }

  async listActiveAccountIds(network: DirectoryNetwork, owner: Address): Promise<bigint[]> {
    const accounts = this.accounts.get(networkKey(network));
    if (!accounts) return [];
    const normalizedOwner = owner.toLowerCase();
    return [...accounts.values()]
      .filter((account) => account.active && account.owner.toLowerCase() === normalizedOwner)
      .map((account) => account.accountId)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  }

  async reset(network: DirectoryNetwork): Promise<void> {
    const key = networkKey(network);
    this.accounts.delete(key);
    this.checkpoints.delete(key);
    this.resetCount += 1;
  }
}

export interface SubaccountDirectoryIndexerOptions {
  network: DirectoryNetwork;
  chain: DirectoryChainReader;
  store: SubaccountDirectoryStore;
  confirmationBlocks: bigint;
  chunkSize: bigint;
}

export interface DirectorySyncResult {
  indexedThroughBlock: bigint | null;
  rebuilt: boolean;
  eventsApplied: number;
}

export interface SubaccountDirectorySnapshot {
  chainId: number;
  matching: Address;
  indexedThroughBlock: bigint;
  indexedThroughBlockHash: Hex;
  accountIds: bigint[];
}

export interface SubaccountDirectoryReader {
  getAccounts(owner: Address): Promise<SubaccountDirectorySnapshot>;
}

/** Read API over the projection; a missing checkpoint means indexing is not ready. */
export class StoredSubaccountDirectoryReader implements SubaccountDirectoryReader {
  constructor(
    private readonly network: DirectoryNetwork,
    private readonly store: SubaccountDirectoryStore,
  ) {}

  async getAccounts(owner: Address): Promise<SubaccountDirectorySnapshot> {
    const checkpoint = await this.store.getCheckpoint(this.network);
    if (!checkpoint?.ready) {
      throw new Error("subaccount directory has not completed its first sync");
    }
    return {
      chainId: this.network.chainId,
      matching: this.network.matching,
      indexedThroughBlock: checkpoint.blockNumber,
      indexedThroughBlockHash: checkpoint.blockHash,
      accountIds: await this.store.listActiveAccountIds(this.network, owner),
    };
  }
}

/** Project Matching ownership events into a durable wallet-to-account directory. */
export class SubaccountDirectoryIndexer {
  private readonly network: DirectoryNetwork;
  private readonly chain: DirectoryChainReader;
  private readonly store: SubaccountDirectoryStore;
  private readonly confirmationBlocks: bigint;
  private readonly chunkSize: bigint;

  constructor(options: SubaccountDirectoryIndexerOptions) {
    if (options.confirmationBlocks < 0n) throw new Error("confirmationBlocks cannot be negative");
    if (options.chunkSize <= 0n) throw new Error("chunkSize must be positive");
    this.network = options.network;
    this.chain = options.chain;
    this.store = options.store;
    this.confirmationBlocks = options.confirmationBlocks;
    this.chunkSize = options.chunkSize;
  }

  async syncOnce(): Promise<DirectorySyncResult> {
    let checkpoint = await this.store.getCheckpoint(this.network);
    let hadReadyProjection = checkpoint?.ready ?? false;
    let rebuilt = false;
    let mustReset = checkpoint === null;
    if (checkpoint) {
      const canonicalHash = await this.chain.getBlockHash(checkpoint.blockNumber);
      if (canonicalHash.toLowerCase() !== checkpoint.blockHash.toLowerCase()) {
        checkpoint = null;
        hadReadyProjection = false;
        rebuilt = true;
        mustReset = true;
      }
    }
    if (mustReset) await this.store.reset(this.network);

    const head = await this.chain.getBlockNumber();
    const safeHead = head > this.confirmationBlocks ? head - this.confirmationBlocks : 0n;
    let fromBlock = checkpoint ? checkpoint.blockNumber + 1n : this.network.deploymentBlock;
    if (safeHead < fromBlock) {
      return {
        indexedThroughBlock: checkpoint?.blockNumber ?? null,
        rebuilt,
        eventsApplied: 0,
      };
    }

    let eventsApplied = 0;
    while (fromBlock <= safeHead) {
      const toBlock = fromBlock + this.chunkSize - 1n < safeHead
        ? fromBlock + this.chunkSize - 1n
        : safeHead;
      const events = await this.chain.getEvents(fromBlock, toBlock);
      events.sort(comparePositions);
      for (const event of events) {
        await this.store.applyEvent(this.network, event);
        eventsApplied += 1;
      }
      const blockHash = await this.chain.getBlockHash(toBlock);
      await this.store.setCheckpoint(this.network, {
        blockNumber: toBlock,
        blockHash,
        ready: hadReadyProjection || toBlock === safeHead,
      });
      fromBlock = toBlock + 1n;
    }

    return { indexedThroughBlock: safeHead, rebuilt, eventsApplied };
  }
}
