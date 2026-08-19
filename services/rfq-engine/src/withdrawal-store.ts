import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import type { Address, Hex } from "viem";
import { parseAction, serializeAction } from "./types.js";
import type {
  WithdrawalAssetMetadata,
  WithdrawalErrorBody,
  WithdrawalOperation,
  WithdrawalStatus,
  WithdrawalReview,
} from "./withdrawal-types.js";

export interface WithdrawalOperationStore {
  put(operation: WithdrawalOperation): Promise<void>;
  putIfIdempotencyAbsent(
    operation: WithdrawalOperation,
  ): Promise<{ inserted: boolean; operation: WithdrawalOperation }>;
  get(id: string): Promise<WithdrawalOperation | null>;
  getByIdempotencyKey(key: string): Promise<WithdrawalOperation | null>;
  list(): Promise<WithdrawalOperation[]>;
}

export class InMemoryWithdrawalOperationStore implements WithdrawalOperationStore {
  protected readonly operations = new Map<string, WithdrawalOperation>();
  protected readonly idsByKey = new Map<string, string>();
  private idempotencyTail: Promise<void> = Promise.resolve();

  async put(operation: WithdrawalOperation): Promise<void> {
    this.operations.set(operation.id, operation);
    this.idsByKey.set(operation.idempotencyKey, operation.id);
  }

  async putIfIdempotencyAbsent(
    operation: WithdrawalOperation,
  ): Promise<{ inserted: boolean; operation: WithdrawalOperation }> {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.idempotencyTail;
    this.idempotencyTail = previous.then(() => gate, () => gate);
    await previous.catch(() => undefined);
    try {
      const existing = await this.getByIdempotencyKey(operation.idempotencyKey);
      if (existing) return { inserted: false, operation: existing };
      await this.put(operation);
      return { inserted: true, operation };
    } finally {
      release();
    }
  }

  async get(id: string): Promise<WithdrawalOperation | null> {
    return this.operations.get(id) ?? null;
  }

  async getByIdempotencyKey(key: string): Promise<WithdrawalOperation | null> {
    const id = this.idsByKey.get(key);
    return id ? this.operations.get(id) ?? null : null;
  }

  async list(): Promise<WithdrawalOperation[]> {
    return [...this.operations.values()];
  }
}

interface StoredWithdrawalOperation {
  id: string;
  idempotencyKey: string;
  requestFingerprint: Hex;
  status: WithdrawalStatus;
  chainId: number;
  matching: Address;
  owner: Address;
  subaccountId: string;
  asset: WithdrawalAssetMetadata;
  tokenUnits: string;
  maxWithdrawableAtPrepare: string;
  previewBlockHash: Hex;
  preparedAtBlockNumber: string;
  preparedAtBlockHash: Hex;
  action: ReturnType<typeof serializeAction>;
  actionDigest: Hex;
  review: WithdrawalReview;
  createdAt: number;
  expiresAt: number;
  submittedAt: number | null;
  confirmedAt: number | null;
  txHash: Hex | null;
  blockNumber: string | null;
  error: WithdrawalErrorBody | null;
}

function toStored(operation: WithdrawalOperation): StoredWithdrawalOperation {
  return {
    ...operation,
    subaccountId: operation.subaccountId.toString(),
    tokenUnits: operation.tokenUnits.toString(),
    maxWithdrawableAtPrepare: operation.maxWithdrawableAtPrepare.toString(),
    preparedAtBlockNumber: operation.preparedAtBlockNumber.toString(),
    action: serializeAction(operation.action),
    blockNumber: operation.blockNumber?.toString() ?? null,
  };
}

function fromStored(operation: StoredWithdrawalOperation): WithdrawalOperation {
  return {
    ...operation,
    subaccountId: BigInt(operation.subaccountId),
    tokenUnits: BigInt(operation.tokenUnits),
    maxWithdrawableAtPrepare: BigInt(operation.maxWithdrawableAtPrepare),
    preparedAtBlockNumber: BigInt(operation.preparedAtBlockNumber),
    action: parseAction(operation.action),
    blockNumber: operation.blockNumber === null ? null : BigInt(operation.blockNumber),
  };
}

/** Append-only durable operation log. Latest valid record per id wins. */
export class JsonlWithdrawalOperationStore extends InMemoryWithdrawalOperationStore {
  constructor(private readonly path: string) {
    super();
    this.load();
  }

  private load(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    if (!existsSync(this.path)) return;
    for (const line of readFileSync(this.path, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const operation = fromStored(JSON.parse(line) as StoredWithdrawalOperation);
        this.operations.set(operation.id, operation);
        this.idsByKey.set(operation.idempotencyKey, operation.id);
      } catch {
        // A crash may leave the final append torn. Earlier records remain valid.
      }
    }
  }

  override async put(operation: WithdrawalOperation): Promise<void> {
    const fd = openSync(this.path, "a");
    try {
      writeSync(fd, `${JSON.stringify(toStored(operation))}\n`, undefined, "utf8");
      // Operation claims and tx hashes must survive a process crash before the
      // executor is allowed to continue broadcasting.
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    await super.put(operation);
  }
}
