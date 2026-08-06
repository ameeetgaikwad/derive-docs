import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  decodeOptionSubId,
  getDeployedAddress,
  requireDeployments,
} from "@hedge/shared";
import {
  getAddress,
  parseAbiItem,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

const UINT96_MASK = (1n << 96n) - 1n;
const DEFAULT_CHUNK_SIZE = 2_000n;
const STATE_VERSION = 1;

export const balanceAdjustedEvent = parseAbiItem(
  "event BalanceAdjusted(uint256 indexed accountId, address indexed manager, bytes32 indexed assetAndSubId, int256 amount, int256 preBalance, int256 postBalance, uint256 tradeId)",
);

export interface ActiveExpiryAddresses {
  subAccounts: Address;
  optionAsset: Address;
}

export function activeExpiryAddressesFromDeployments(chainId: number): ActiveExpiryAddresses {
  const deployments = requireDeployments(chainId);
  return {
    subAccounts: getDeployedAddress(deployments, "subAccounts"),
    optionAsset: getDeployedAddress(deployments, "btcOptionAsset"),
  };
}

export interface IndexedOptionPosition {
  accountId: bigint;
  subId: bigint;
  balance: bigint;
}

interface JsonPosition {
  accountId: string;
  subId: string;
  balance: string;
}

interface IndexState {
  version: typeof STATE_VERSION;
  chainId: number;
  subAccounts: Address;
  optionAsset: Address;
  fromBlock: string;
  lastScannedBlock: string;
  lastScannedBlockHash: Hex | null;
  positions: JsonPosition[];
}

export interface ExpiredSeries {
  expiry: bigint;
  subaccounts: bigint[];
  subIds: bigint[];
}

export interface ActiveExpiryCheckpoint {
  fromBlock: bigint;
  lastScannedBlock: bigint;
  positionCount: number;
}

export interface ActiveExpiryIndexOptions {
  publicClient: PublicClient;
  chainId: number;
  addresses?: ActiveExpiryAddresses;
  statePath?: string;
  fromBlock?: bigint;
  confirmations?: bigint;
  chunkSize?: bigint;
  log?: (message: string) => void;
}

/**
 * Durable index of non-zero option balances.
 *
 * OptionAsset.openInterest is a non-enumerable mapping, so discovering every
 * active series requires replaying SubAccounts.BalanceAdjusted. Each event
 * includes the authoritative postBalance, which makes the projection
 * idempotent and lets a restart resume from a finalized block.
 */
export class ActiveExpiryIndex {
  private readonly publicClient: PublicClient;
  private readonly chainId: number;
  private readonly addresses: ActiveExpiryAddresses;
  private readonly statePath: string;
  private readonly configuredFromBlock: bigint | undefined;
  private readonly confirmations: bigint;
  private readonly chunkSize: bigint;
  private readonly log: (message: string) => void;
  private state: IndexState | null = null;
  private syncTail: Promise<void> = Promise.resolve();

  constructor(options: ActiveExpiryIndexOptions) {
    this.publicClient = options.publicClient;
    this.chainId = options.chainId;
    this.addresses = options.addresses ?? activeExpiryAddressesFromDeployments(options.chainId);
    this.statePath =
      options.statePath ??
      resolve(fileURLToPath(new URL("../.data", import.meta.url)), `active-expiries.${options.chainId}.json`);
    this.configuredFromBlock = options.fromBlock;
    this.confirmations = options.confirmations ?? (options.chainId === 31337 ? 0n : 6n);
    this.chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    this.log = options.log ?? ((message) => console.log(`[oracle-feeds] ${message}`));

    if (this.confirmations < 0n) throw new Error("oracle discovery confirmations cannot be negative");
    if (this.chunkSize <= 0n) throw new Error("oracle discovery chunk size must be positive");
  }

  /** Replay new finalized balance events and atomically checkpoint the result. */
  sync(): Promise<void> {
    const run = this.syncTail.then(
      () => this.performSync(),
      () => this.performSync(),
    );
    this.syncTail = run.catch(() => undefined);
    return run;
  }

  private async performSync(): Promise<void> {
    const latest = await this.publicClient.getBlockNumber();
    if (latest < this.confirmations) return;
    const safeHead = latest - this.confirmations;

    await this.ensureState(safeHead);
    await this.ensureCheckpointCanonical(safeHead);
    const state = this.requireState();

    let cursor = BigInt(state.lastScannedBlock) + 1n;
    if (cursor > safeHead) return;
    let chunks = 0;

    while (cursor <= safeHead) {
      const toBlock = min(cursor + this.chunkSize - 1n, safeHead);
      const logs = await this.publicClient.getLogs({
        address: this.addresses.subAccounts,
        event: balanceAdjustedEvent,
        fromBlock: cursor,
        toBlock,
        strict: true,
      });

      const positions = positionsToMap(state.positions);
      for (const event of logs) {
        const { accountId, assetAndSubId, postBalance } = event.args;
        applyBalanceAdjustment(positions, {
          accountId,
          assetAndSubId,
          postBalance,
          optionAsset: this.addresses.optionAsset,
        });
      }

      const checkpoint = await this.publicClient.getBlock({ blockNumber: toBlock });
      if (!checkpoint.hash) throw new Error(`block ${toBlock} has no hash`);
      state.positions = mapToJsonPositions(positions);
      state.lastScannedBlock = toBlock.toString();
      state.lastScannedBlockHash = checkpoint.hash;
      await this.saveState(state);
      chunks += 1;
      if (logs.length > 0 || toBlock === safeHead || chunks % 25 === 0) {
        this.log(
          `active-expiry scan checkpoint=${toBlock}/${safeHead} ` +
            `events=${logs.length} positions=${state.positions.length}`,
        );
      }
      cursor = toBlock + 1n;
    }
  }

  positions(): IndexedOptionPosition[] {
    return this.requireState().positions.map((position) => ({
      accountId: BigInt(position.accountId),
      subId: BigInt(position.subId),
      balance: BigInt(position.balance),
    }));
  }

  checkpoint(): ActiveExpiryCheckpoint {
    const state = this.requireState();
    return {
      fromBlock: BigInt(state.fromBlock),
      lastScannedBlock: BigInt(state.lastScannedBlock),
      positionCount: state.positions.length,
    };
  }

  /** Every future expiry for which at least one account has a non-zero balance. */
  activeExpiries(nowSec: bigint): bigint[] {
    return sortedUnique(
      this.positions()
        .map((position) => decodeOptionSubId(position.subId).expiry)
        .filter((expiry) => expiry > nowSec),
    );
  }

  /** Expired positions grouped for the permissionless settlement worker. */
  expiredSeries(nowSec: bigint): ExpiredSeries[] {
    const groups = new Map<string, { expiry: bigint; accounts: Set<string>; subIds: Set<string> }>();
    for (const position of this.positions()) {
      const expiry = decodeOptionSubId(position.subId).expiry;
      if (expiry > nowSec) continue;
      const key = expiry.toString();
      const group = groups.get(key) ?? { expiry, accounts: new Set(), subIds: new Set() };
      group.accounts.add(position.accountId.toString());
      group.subIds.add(position.subId.toString());
      groups.set(key, group);
    }
    return [...groups.values()]
      .map((group) => ({
        expiry: group.expiry,
        subaccounts: [...group.accounts].map(BigInt).sort(compareBigInt),
        subIds: [...group.subIds].map(BigInt).sort(compareBigInt),
      }))
      .sort((a, b) => compareBigInt(a.expiry, b.expiry));
  }

  private async ensureState(safeHead: bigint): Promise<void> {
    if (this.state) return;
    const loaded = await this.loadState();
    if (loaded && this.matchesDeployment(loaded)) {
      this.state = loaded;
      return;
    }
    if (loaded) this.log(`discarding incompatible active-expiry index ${this.statePath}`);
    await this.resetState(safeHead);
  }

  private async ensureCheckpointCanonical(safeHead: bigint): Promise<void> {
    const state = this.requireState();
    const last = BigInt(state.lastScannedBlock);
    if (last < BigInt(state.fromBlock) || state.lastScannedBlockHash === null) return;
    if (last > safeHead) {
      this.log("active-expiry checkpoint is ahead of the finalized head; rebuilding");
      await this.resetState(safeHead);
      return;
    }
    const block = await this.publicClient.getBlock({ blockNumber: last });
    if (block.hash?.toLowerCase() !== state.lastScannedBlockHash.toLowerCase()) {
      this.log(`active-expiry checkpoint reorg detected at block ${last}; rebuilding`);
      await this.resetState(safeHead);
    }
  }

  private async resetState(safeHead: bigint): Promise<void> {
    const fromBlock = this.configuredFromBlock ?? (await this.findDeploymentBlock(safeHead));
    const previous = fromBlock - 1n;
    let previousHash: Hex | null = null;
    if (fromBlock > 0n) {
      const block = await this.publicClient.getBlock({ blockNumber: previous });
      previousHash = block.hash;
    }
    this.state = {
      version: STATE_VERSION,
      chainId: this.chainId,
      subAccounts: this.addresses.subAccounts,
      optionAsset: this.addresses.optionAsset,
      fromBlock: fromBlock.toString(),
      lastScannedBlock: previous.toString(),
      lastScannedBlockHash: previousHash,
      positions: [],
    };
    this.log(`active-expiry index rebuilding from block ${fromBlock}`);
    await this.saveState(this.state);
  }

  /** Find the first block containing SubAccounts bytecode (O(log chain height)). */
  private async findDeploymentBlock(safeHead: bigint): Promise<bigint> {
    try {
      const currentCode = await this.publicClient.getBytecode({
        address: this.addresses.subAccounts,
        blockNumber: safeHead,
      });
      if (!currentCode || currentCode === "0x") {
        throw new Error(`SubAccounts has no bytecode at finalized block ${safeHead}`);
      }

      let low = 0n;
      let high = safeHead;
      while (low < high) {
        const mid = (low + high) >> 1n;
        const code = await this.publicClient.getBytecode({
          address: this.addresses.subAccounts,
          blockNumber: mid,
        });
        if (code && code !== "0x") high = mid;
        else low = mid + 1n;
      }
      return low;
    } catch (error) {
      throw new Error(
        "cannot discover the SubAccounts deployment block from historical state; " +
          "set ORACLE_DISCOVERY_FROM_BLOCK to the deployment block on this RPC",
        { cause: error },
      );
    }
  }

  private matchesDeployment(state: IndexState): boolean {
    return (
      state.version === STATE_VERSION &&
      state.chainId === this.chainId &&
      state.subAccounts.toLowerCase() === this.addresses.subAccounts.toLowerCase() &&
      state.optionAsset.toLowerCase() === this.addresses.optionAsset.toLowerCase()
    );
  }

  private async loadState(): Promise<IndexState | null> {
    try {
      const parsed = JSON.parse(await readFile(this.statePath, "utf8")) as IndexState;
      validateState(parsed);
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      this.log(`active-expiry state unreadable; rebuilding (${(error as Error).message})`);
      return null;
    }
  }

  private async saveState(state: IndexState): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true });
    const temporary = `${this.statePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.statePath);
  }

  private requireState(): IndexState {
    if (!this.state) throw new Error("active-expiry index has not been synced");
    return this.state;
  }
}

/** Decode SubAccounts' bytes32 packing: address in the high 160 bits, subId in low 96. */
export function decodeAssetAndSubId(assetAndSubId: Hex): { asset: Address; subId: bigint } {
  const packed = BigInt(assetAndSubId);
  const asset = getAddress(`0x${(packed >> 96n).toString(16).padStart(40, "0")}`);
  return { asset, subId: packed & UINT96_MASK };
}

export function applyBalanceAdjustment(
  positions: Map<string, IndexedOptionPosition>,
  event: {
    accountId: bigint;
    assetAndSubId: Hex;
    postBalance: bigint;
    optionAsset: Address;
  },
): void {
  const decoded = decodeAssetAndSubId(event.assetAndSubId);
  if (decoded.asset.toLowerCase() !== event.optionAsset.toLowerCase()) return;
  // Reject malformed option ids instead of poisoning the persistent index.
  decodeOptionSubId(decoded.subId);
  const key = positionKey(event.accountId, decoded.subId);
  if (event.postBalance === 0n) positions.delete(key);
  else {
    positions.set(key, {
      accountId: event.accountId,
      subId: decoded.subId,
      balance: event.postBalance,
    });
  }
}

function validateState(value: IndexState): void {
  if (!value || typeof value !== "object") throw new Error("state is not an object");
  if (value.version !== STATE_VERSION) throw new Error(`unsupported state version ${value.version}`);
  if (!Number.isSafeInteger(value.chainId) || value.chainId <= 0) {
    throw new Error("state chainId is invalid");
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(value.subAccounts)) {
    throw new Error("state SubAccounts address is invalid");
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(value.optionAsset)) {
    throw new Error("state option asset address is invalid");
  }
  if (
    value.lastScannedBlockHash !== null &&
    !/^0x[0-9a-fA-F]{64}$/.test(value.lastScannedBlockHash)
  ) {
    throw new Error("state checkpoint hash is invalid");
  }
  if (!Array.isArray(value.positions)) throw new Error("state positions must be an array");
  if (BigInt(value.fromBlock) < 0n) throw new Error("state fromBlock is negative");
  if (BigInt(value.lastScannedBlock) < -1n) throw new Error("state checkpoint block is invalid");
  for (const position of value.positions) {
    if (!position || typeof position !== "object") throw new Error("state position is invalid");
    BigInt(position.accountId);
    decodeOptionSubId(BigInt(position.subId));
    if (BigInt(position.balance) === 0n) throw new Error("state contains a zero balance");
  }
}

function positionsToMap(positions: JsonPosition[]): Map<string, IndexedOptionPosition> {
  const out = new Map<string, IndexedOptionPosition>();
  for (const position of positions) {
    const decoded = {
      accountId: BigInt(position.accountId),
      subId: BigInt(position.subId),
      balance: BigInt(position.balance),
    };
    out.set(positionKey(decoded.accountId, decoded.subId), decoded);
  }
  return out;
}

function mapToJsonPositions(positions: Map<string, IndexedOptionPosition>): JsonPosition[] {
  return [...positions.values()]
    .sort((a, b) => compareBigInt(a.accountId, b.accountId) || compareBigInt(a.subId, b.subId))
    .map((position) => ({
      accountId: position.accountId.toString(),
      subId: position.subId.toString(),
      balance: position.balance.toString(),
    }));
}

function positionKey(accountId: bigint, subId: bigint): string {
  return `${accountId}:${subId}`;
}

function sortedUnique(values: readonly bigint[]): bigint[] {
  return [...new Set(values.map(String))].map(BigInt).sort(compareBigInt);
}

function compareBigInt(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
