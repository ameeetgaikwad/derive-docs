import {
  encodeFunctionData,
  http,
  createPublicClient,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Account,
  TransactionReceiptNotFoundError,
} from "viem";
import {
  lyraForwardFeedAbi,
  matchingAbi,
  rfqModuleAbi,
  standardManagerAbi,
  subAccountsAbi,
  getChain,
  makeWalletClient,
  type Action,
} from "@hedge/shared";
import type { RfqActionIdentity } from "./types.js";

/**
 * Read-side chain boundary — mocked in tests, viem-backed in production.
 */
export interface ChainReader {
  /** Matching.subAccountToOwner — zero address if not deposited into Matching */
  getMatchingSubaccountOwner(subaccountId: bigint): Promise<Address>;
  /** SubAccounts.getBalance(subaccountId, cashAsset, 0) — signed 18dp cash balance */
  getCashBalance(subaccountId: bigint): Promise<bigint>;
  /** Matching.tradeExecutors(address) */
  isTradeExecutor(address: Address): Promise<boolean>;
  /**
   * SRMPortfolioViewer.OIFeeRateBPS(asset) — 18dp rate the SRM charges on
   * OI-increasing trades. Read live: governance can change it at any time.
   */
  getOIFeeRateBPS(asset: Address): Promise<bigint>;
  /** LyraForwardFeed.getForwardPrice(expiry) — 18dp forward price */
  getForwardPrice(forwardFeed: Address, expiry: bigint): Promise<bigint>;
  /** StandardManager.minOIFee() — 18dp floor applied when an OI fee is charged */
  getMinOIFee(): Promise<bigint>;
}

/** BasePortfolioViewer surface the engine needs (no full ABI in shared yet). */
const srmViewerAbi = parseAbi([
  "function OIFeeRateBPS(address asset) view returns (uint256)",
]);

export interface SubmitResult {
  txHash: Hex;
  status: "success" | "reverted";
  blockNumber: bigint | null;
}

export interface VerifyAndMatchReconciliationRequest {
  txHash: Hex | null;
  calldataHash: Hex;
  actions: [RfqActionIdentity, RfqActionIdentity];
  fromBlock: bigint;
}

export type VerifyAndMatchReconciliation =
  | { state: "pending" }
  | { state: "mined"; result: SubmitResult }
  | { state: "expired-unused" };

/**
 * Write-side chain boundary. The production implementation submits
 * Matching.verifyAndMatch and waits for the receipt.
 */
export interface TxSubmitter {
  readonly executorAddress: Address;
  submitVerifyAndMatch(
    actions: Action[],
    signatures: Hex[],
    actionData: Hex,
    onSubmitted?: (txHash: Hex) => Promise<void>,
  ): Promise<SubmitResult>;
  /** Optional on fakes/legacy submitters; production captures this before intent persistence. */
  currentBlockNumber?(): Promise<bigint>;
  /** Exact, read-only reconciliation; absence means the caller must remain fail-closed. */
  reconcileVerifyAndMatch?(
    request: VerifyAndMatchReconciliationRequest,
  ): Promise<VerifyAndMatchReconciliation>;
  /** Optional fail-closed latch used by durable RFQ recovery. */
  pauseForUnknownOperation?(operationId: string): void;
  clearUnknownOperation?(operationId: string): void;
  unresolvedTransaction?(): Hex | null;
  clearUnresolvedTransaction?(txHash: Hex): void;
  adoptUnresolvedTransaction?(txHash: Hex): void;
}

/** Withdrawal writes need an exact final simulation in the same local queue as RFQ writes. */
export interface WithdrawalTxSubmitter extends TxSubmitter {
  simulateAndSubmitVerifyAndMatch(
    actions: Action[],
    signatures: Hex[],
    actionData: Hex,
    onSubmitted: (txHash: Hex) => Promise<void>,
    beforeSimulation?: () => Promise<void>,
  ): Promise<SubmitResult>;
  unresolvedTransaction(): Hex | null;
  clearUnresolvedTransaction(txHash: Hex): void;
  adoptUnresolvedTransaction(txHash: Hex): void;
  pauseForUnknownOperation(operationId: string): void;
  clearUnknownOperation(operationId: string): void;
}

export class UnresolvedExecutorTransactionError extends Error {
  constructor(readonly txHash: Hex) {
    super(`executor transaction ${txHash} has no resolved receipt; writes are fail-closed`);
    this.name = "UnresolvedExecutorTransactionError";
  }
}

export class UnresolvedExecutorOperationError extends Error {
  constructor(readonly operationIds: string[]) {
    super(`executor writes paused by unresolved operations: ${operationIds.join(", ")}`);
    this.name = "UnresolvedExecutorOperationError";
  }
}

export const UNKNOWN_BROADCAST_OPERATION = "executor-broadcast-without-hash";

export class ExecutorSimulationError extends Error {
  constructor(options?: ErrorOptions) {
    super("signed verifyAndMatch simulation rejected", options);
    this.name = "ExecutorSimulationError";
  }
}

export class ExecutorBroadcastUnknownError extends Error {
  constructor(options?: ErrorOptions) {
    super("executor broadcast outcome is unknown", options);
    this.name = "ExecutorBroadcastUnknownError";
  }
}

export class ExecutorAttributionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutorAttributionError";
  }
}

/**
 * Exact calldata for Matching.verifyAndMatch(Action[], bytes[], bytes), per
 * protocol/lib/v2-matching/src/Matching.sol. Exposed so tests can assert the
 * args byte-for-byte.
 */
export function buildVerifyAndMatchCalldata(
  actions: Action[],
  signatures: Hex[],
  actionData: Hex,
): Hex {
  return encodeFunctionData({
    abi: matchingAbi,
    functionName: "verifyAndMatch",
    args: [actions, signatures, actionData],
  });
}

export interface ChainAddresses {
  matching: Address;
  subAccounts: Address;
  cashAsset: Address;
  /** SRMPortfolioViewer (deployments key "srmViewer") — OI fee rate reads */
  srmViewer: Address;
  /** StandardManager — minOIFee reads */
  standardManager: Address;
}

export class ViemChainReader implements ChainReader {
  constructor(
    private readonly client: PublicClient,
    private readonly addresses: ChainAddresses,
  ) {}

  async getMatchingSubaccountOwner(subaccountId: bigint): Promise<Address> {
    return this.client.readContract({
      address: this.addresses.matching,
      abi: matchingAbi,
      functionName: "subAccountToOwner",
      args: [subaccountId],
    });
  }

  async getCashBalance(subaccountId: bigint): Promise<bigint> {
    return this.client.readContract({
      address: this.addresses.subAccounts,
      abi: subAccountsAbi,
      functionName: "getBalance",
      args: [subaccountId, this.addresses.cashAsset, 0n],
    });
  }

  async isTradeExecutor(address: Address): Promise<boolean> {
    return this.client.readContract({
      address: this.addresses.matching,
      abi: matchingAbi,
      functionName: "tradeExecutors",
      args: [address],
    });
  }

  async getOIFeeRateBPS(asset: Address): Promise<bigint> {
    return this.client.readContract({
      address: this.addresses.srmViewer,
      abi: srmViewerAbi,
      functionName: "OIFeeRateBPS",
      args: [asset],
    });
  }

  async getForwardPrice(forwardFeed: Address, expiry: bigint): Promise<bigint> {
    const [forwardPrice] = await this.client.readContract({
      address: forwardFeed,
      abi: lyraForwardFeedAbi,
      functionName: "getForwardPrice",
      args: [expiry],
    });
    return forwardPrice;
  }

  async getMinOIFee(): Promise<bigint> {
    return this.client.readContract({
      address: this.addresses.standardManager,
      abi: standardManagerAbi,
      functionName: "minOIFee",
      args: [],
    });
  }
}

export class ViemTxSubmitter implements WithdrawalTxSubmitter {
  readonly executorAddress: Address;
  private writeTail: Promise<void> = Promise.resolve();
  private unresolvedTxHash: Hex | null = null;
  private readonly unknownOperationIds = new Set<string>();

  constructor(
    private readonly wallet: WalletClient,
    private readonly publicClient: PublicClient,
    private readonly matching: Address,
    account: Account,
  ) {
    this.executorAddress = account.address;
  }

  async submitVerifyAndMatch(
    actions: Action[],
    signatures: Hex[],
    actionData: Hex,
    onSubmitted?: (txHash: Hex) => Promise<void>,
  ): Promise<SubmitResult> {
    return this.serializeWrite(() => this.submit(actions, signatures, actionData, onSubmitted));
  }

  async simulateAndSubmitVerifyAndMatch(
    actions: Action[],
    signatures: Hex[],
    actionData: Hex,
    onSubmitted: (txHash: Hex) => Promise<void>,
    beforeSimulation?: () => Promise<void>,
  ): Promise<SubmitResult> {
    return this.serializeWrite(async () => {
      const account = this.wallet.account;
      if (!account) throw new Error("wallet client has no account");
      if (beforeSimulation) await beforeSimulation();
      try {
        await this.publicClient.simulateContract({
          address: this.matching,
          abi: matchingAbi,
          functionName: "verifyAndMatch",
          args: [actions, signatures, actionData],
          account,
        });
      } catch (error) {
        throw new ExecutorSimulationError({ cause: error });
      }
      return this.submit(actions, signatures, actionData, onSubmitted);
    });
  }

  async currentBlockNumber(): Promise<bigint> {
    return this.publicClient.getBlockNumber();
  }

  /**
   * Reconcile without ever resubmitting. A known hash must resolve to the
   * canonical exact calldata. For a hashless broadcast, a successful action
   * is discoverable from the module's nonce event and is accepted only after
   * the transaction input hashes to the persisted calldata digest.
   */
  async reconcileVerifyAndMatch(
    request: VerifyAndMatchReconciliationRequest,
  ): Promise<VerifyAndMatchReconciliation> {
    if (request.actions[0].module.toLowerCase() !== request.actions[1].module.toLowerCase()) {
      throw new ExecutorAttributionError("persisted RFQ actions target different modules");
    }

    if (request.txHash) {
      const result = await this.exactCanonicalResult(request.txHash, request.calldataHash);
      if (result) return { state: "mined", result };
    } else {
      const first = request.actions[0];
      const logs = await this.publicClient.getContractEvents({
        address: first.module,
        abi: rfqModuleAbi,
        eventName: "NonceUsed",
        args: { owner: first.owner },
        fromBlock: request.fromBlock,
        toBlock: "latest",
        strict: true,
      });
      const hashes = new Set<Hex>();
      for (const log of logs) {
        if (log.args.nonce === first.nonce && log.transactionHash) {
          hashes.add(log.transactionHash);
        }
      }
      const exact: SubmitResult[] = [];
      for (const txHash of hashes) {
        const result = await this.exactCanonicalResult(txHash, request.calldataHash);
        if (result) exact.push(result);
      }
      if (exact.length > 1) {
        throw new ExecutorAttributionError("multiple canonical transactions match one RFQ intent");
      }
      if (exact.length === 1) return { state: "mined", result: exact[0]! };
    }

    // Once both signed actions are unusable in canonical time and neither
    // module nonce was consumed, no future successful execution is possible.
    const latest = await this.publicClient.getBlock({ blockTag: "latest" });
    const allExpired = request.actions.every((action) => latest.timestamp > action.expiry);
    if (allExpired) {
      const used = await Promise.all(
        request.actions.map((action) =>
          this.publicClient.readContract({
            address: action.module,
            abi: rfqModuleAbi,
            functionName: "usedNonces",
            args: [action.owner, action.nonce],
            blockNumber: latest.number,
          }),
        ),
      );
      if (used.every((value) => value === false)) return { state: "expired-unused" };
    }
    return { state: "pending" };
  }

  private async exactCanonicalResult(
    txHash: Hex,
    calldataHash: Hex,
  ): Promise<SubmitResult | null> {
    let receipt;
    try {
      receipt = await this.publicClient.getTransactionReceipt({ hash: txHash });
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) return null;
      throw error;
    }
    const canonicalBlock = await this.publicClient.getBlock({ blockNumber: receipt.blockNumber });
    if (canonicalBlock.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) return null;
    const transaction = await this.publicClient.getTransaction({ hash: txHash });
    if (transaction.from.toLowerCase() !== this.executorAddress.toLowerCase()) {
      throw new ExecutorAttributionError(
        `executor transaction ${txHash} was sent by ${transaction.from}, not ${this.executorAddress}`,
      );
    }
    if (!transaction.to || transaction.to.toLowerCase() !== this.matching.toLowerCase()) {
      throw new ExecutorAttributionError(`executor transaction ${txHash} did not target Matching`);
    }
    if (keccak256(transaction.input).toLowerCase() !== calldataHash.toLowerCase()) {
      throw new ExecutorAttributionError(`executor transaction ${txHash} calldata does not match RFQ intent`);
    }
    return {
      txHash,
      status: receipt.status === "success" ? "success" : "reverted",
      blockNumber: receipt.blockNumber,
    };
  }

  private async submit(
    actions: Action[],
    signatures: Hex[],
    actionData: Hex,
    onSubmitted?: (txHash: Hex) => Promise<void>,
  ): Promise<SubmitResult> {
    const account = this.wallet.account;
    if (!account) throw new Error("wallet client has no account");
    let txHash: Hex;
    try {
      txHash = await this.wallet.writeContract({
        address: this.matching,
        abi: matchingAbi,
        functionName: "verifyAndMatch",
        args: [actions, signatures, actionData],
        chain: this.wallet.chain,
        account,
      });
    } catch (error) {
      this.unknownOperationIds.add(UNKNOWN_BROADCAST_OPERATION);
      throw new ExecutorBroadcastUnknownError({ cause: error });
    }
    try {
      if (onSubmitted) await onSubmitted(txHash);
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });
      // A receipt alone is not sufficient evidence of canonical inclusion: an
      // RPC can briefly return a receipt from a block that was just reorged.
      // Resolve the block by number and require the exact receipt block hash
      // before releasing the shared executor queue.
      const canonicalBlock = await this.publicClient.getBlock({ blockNumber: receipt.blockNumber });
      if (canonicalBlock.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) {
        throw new Error(`executor receipt ${txHash} is no longer canonical`);
      }
      return {
        txHash,
        status: receipt.status === "success" ? "success" : "reverted",
        blockNumber: receipt.blockNumber,
      };
    } catch (error) {
      // Broadcast succeeded but receipt resolution did not. Reusing the wallet
      // can create nonce ambiguity, so every later RFQ/withdrawal fails closed.
      this.unresolvedTxHash = txHash;
      throw error;
    }
  }

  /**
   * One executor wallet submits RFQs and withdrawals. Serializing the complete
   * simulate/broadcast section prevents local nonce races and closes the gap
   * where an RFQ could invalidate a withdrawal immediately after preflight.
   */
  private serializeWrite<T>(work: () => Promise<T>): Promise<T> {
    const guarded = async () => {
      await this.reconcileUnresolvedTransaction();
      if (this.unknownOperationIds.size > 0) {
        throw new UnresolvedExecutorOperationError([...this.unknownOperationIds].sort());
      }
      return work();
    };
    const run = this.writeTail.then(guarded, guarded);
    this.writeTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  unresolvedTransaction(): Hex | null {
    return this.unresolvedTxHash;
  }

  clearUnresolvedTransaction(txHash: Hex): void {
    if (this.unresolvedTxHash?.toLowerCase() === txHash.toLowerCase()) {
      this.unresolvedTxHash = null;
    }
  }

  adoptUnresolvedTransaction(txHash: Hex): void {
    if (!this.unresolvedTxHash) this.unresolvedTxHash = txHash;
    if (this.unresolvedTxHash.toLowerCase() !== txHash.toLowerCase()) {
      this.unknownOperationIds.add("executor-multiple-unresolved-transactions");
    }
  }

  pauseForUnknownOperation(operationId: string): void {
    this.unknownOperationIds.add(operationId);
  }

  clearUnknownOperation(operationId: string): void {
    this.unknownOperationIds.delete(operationId);
  }

  private async reconcileUnresolvedTransaction(): Promise<void> {
    const txHash = this.unresolvedTxHash;
    if (!txHash) return;
    try {
      const receipt = await this.publicClient.getTransactionReceipt({ hash: txHash });
      const canonicalBlock = await this.publicClient.getBlock({ blockNumber: receipt.blockNumber });
      if (canonicalBlock.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) {
        throw new UnresolvedExecutorTransactionError(txHash);
      }
      // A canonical receipt is still not authority to clear this process-local
      // latch: the owning RFQ/withdrawal journal must first fsync its terminal
      // state, then explicitly clear the exact hash.
      throw new UnresolvedExecutorTransactionError(txHash);
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) {
        throw new UnresolvedExecutorTransactionError(txHash);
      }
      // RPC uncertainty is not evidence that the nonce is reusable.
      throw new UnresolvedExecutorTransactionError(txHash);
    }
  }
}

/** Convenience factory wiring viem clients for a given RPC/chain. */
export function makeViemChain(params: {
  chainId: number;
  rpcUrl: string;
  account: Account;
  addresses: ChainAddresses;
}): { reader: ViemChainReader; submitter: ViemTxSubmitter; publicClient: PublicClient } {
  const chain = getChain(params.chainId);
  const transport = http(params.rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  // shared factory: forces legacy gas on BSC testnet (97); plain client elsewhere
  const walletClient = makeWalletClient(params.account, {
    chainId: params.chainId,
    rpcUrl: params.rpcUrl,
  });
  return {
    reader: new ViemChainReader(publicClient, params.addresses),
    submitter: new ViemTxSubmitter(
      walletClient,
      publicClient,
      params.addresses.matching,
      params.account,
    ),
    publicClient,
  };
}
