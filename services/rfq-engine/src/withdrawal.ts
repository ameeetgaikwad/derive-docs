import { randomUUID } from "node:crypto";
import {
  formatUnits,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import {
  buildWithdrawalAction,
  getActionDigest,
  getActionTypedData,
} from "@hedge/shared";
import { addressEq, serializeAction } from "./types.js";
import type {
  WithdrawalGateway,
  WithdrawalPinnedBlock,
  WithdrawalSnapshot,
} from "./withdrawal-gateway.js";
import type { WithdrawalOperationStore } from "./withdrawal-store.js";
import { AccountLock } from "./account-lock.js";
import {
  ExecutorBroadcastUnknownError,
  ExecutorSimulationError,
  UNKNOWN_BROADCAST_OPERATION,
} from "./chain.js";
import {
  WithdrawalApiError,
  type PrepareWithdrawalRequest,
  type PrepareWithdrawalResponse,
  type PublicWithdrawal,
  type SubmitWithdrawalRequest,
  type WithdrawalAssetDefinition,
  type WithdrawalAssetId,
  type WithdrawalAssetMetadata,
  type WithdrawalBlocker,
  type WithdrawalErrorBody,
  type WithdrawalOperation,
  type WithdrawalPreview,
  type WithdrawalPreviewRequest,
  type WithdrawalResponse,
  type WithdrawalReview,
  type WithdrawalSigningPayload,
} from "./withdrawal-types.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ONE = 10n ** 18n;
const PREVIEW_TTL_MS = 30_000;
const ACTION_TTL_SECONDS = 600;
const DEFAULT_SAFETY_BPS = 50n;
const BPS = 10_000n;
const MAX_UINT256 = (1n << 256n) - 1n;

export interface WithdrawalEngineOptions {
  chainId: number;
  matching: Address;
  withdrawalModule: Address;
  standardManager: Address;
  assets: WithdrawalAssetDefinition[];
  gateway: WithdrawalGateway;
  store: WithdrawalOperationStore;
  now?: () => number;
  recommendedSafetyBps?: bigint;
  /** Authenticated maker quote reservations only; public taker RFQs are excluded. */
  reservedCash?: (subaccountId: bigint) => bigint | Promise<bigint>;
  accountLock?: AccountLock;
}

export interface PreparedWithdrawalResult {
  response: PrepareWithdrawalResponse;
  replayed: boolean;
}

export interface WithdrawalRecoverySummary {
  expired: number;
  confirmed: number;
  reverted: number;
  unknown: number;
  pending: number;
}

function parseUnsigned(value: unknown, label: string, allowZero = true): bigint {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new WithdrawalApiError(400, "INVALID_REQUEST", `${label} must be a decimal integer string`);
  }
  const parsed = BigInt(value);
  if (parsed > MAX_UINT256) {
    throw new WithdrawalApiError(400, "INVALID_REQUEST", `${label} exceeds uint256`);
  }
  if (!allowZero && parsed === 0n) {
    throw new WithdrawalApiError(400, "INVALID_REQUEST", `${label} must be greater than zero`);
  }
  return parsed;
}

function toTokenUnitsFloor(amount18: bigint, decimals: number): bigint {
  if (amount18 <= 0n) return 0n;
  if (decimals === 18) return amount18;
  if (decimals < 18) return amount18 / 10n ** BigInt(18 - decimals);
  return amount18 * 10n ** BigInt(decimals - 18);
}

function toTokenUnitsCeil(amount18: bigint, decimals: number): bigint {
  if (amount18 <= 0n) return 0n;
  if (decimals >= 18) return amount18 * 10n ** BigInt(decimals - 18);
  const divisor = 10n ** BigInt(18 - decimals);
  return (amount18 + divisor - 1n) / divisor;
}

function tokenQuantum(decimals: number): bigint {
  return decimals > 18 ? 10n ** BigInt(decimals - 18) : 1n;
}

function tokenUnitsTo18Floor(tokenUnits: bigint, decimals: number): bigint {
  if (decimals === 18) return tokenUnits;
  if (decimals < 18) return tokenUnits * 10n ** BigInt(18 - decimals);
  return tokenUnits / 10n ** BigInt(decimals - 18);
}

function errorBody(code: string, message: string, retryable = false): WithdrawalErrorBody {
  return { code, message, retryable };
}

function requestFingerprint(request: PrepareWithdrawalRequest): Hex {
  return keccak256(
    stringToHex(
      JSON.stringify({
        owner: request.owner.toLowerCase(),
        subaccountId: request.subaccountId,
        assetId: request.assetId,
        tokenUnits: request.tokenUnits,
        previewBlockHash: request.previewBlockHash.toLowerCase(),
      }),
    ),
  );
}

export class WithdrawalEngine {
  private readonly assets = new Map<WithdrawalAssetId, WithdrawalAssetDefinition>();
  private readonly now: () => number;
  private readonly safetyBps: bigint;
  private readonly submitClaims = new Set<string>();
  /** In-process submissions that have not yet reached a terminal/pending result. */
  private readonly activeSubmissions = new Set<string>();
  private readonly accountLock: AccountLock;

  constructor(private readonly opts: WithdrawalEngineOptions) {
    for (const asset of opts.assets) this.assets.set(asset.assetId, asset);
    this.now = opts.now ?? Date.now;
    this.accountLock = opts.accountLock ?? new AccountLock();
    this.safetyBps = opts.recommendedSafetyBps ?? DEFAULT_SAFETY_BPS;
    if (this.safetyBps < 0n || this.safetyBps >= BPS) {
      throw new Error("recommendedSafetyBps must be in [0, 10000)");
    }
  }

  async preview(request: WithdrawalPreviewRequest): Promise<WithdrawalPreview> {
    const subaccountId = parseUnsigned(request.subaccountId, "subaccountId", false);
    const asset = this.resolveAsset(request.assetId);
    const block = await this.opts.gateway.latestBlock();
    return this.previewAtBlock(request.owner, subaccountId, asset, block);
  }

  async prepare(
    request: PrepareWithdrawalRequest,
    idempotencyKey: string,
  ): Promise<PreparedWithdrawalResult> {
    this.validateIdempotencyKey(idempotencyKey);
    const subaccountId = parseUnsigned(request.subaccountId, "subaccountId", false);
    const tokenUnits = parseUnsigned(request.tokenUnits, "tokenUnits", false);
    const asset = this.resolveAsset(request.assetId);
    const fingerprint = requestFingerprint(request);
    const scopedKey = `${request.owner.toLowerCase()}:${idempotencyKey}`;
    const existing = await this.opts.store.getByIdempotencyKey(scopedKey);
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) {
        throw new WithdrawalApiError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "this owner and Idempotency-Key were already used with a different request",
        );
      }
      return { response: this.preparedResponse(existing), replayed: true };
    }

    const referencedBlock = await this.opts.gateway.blockByHash(request.previewBlockHash);
    if (!referencedBlock || this.now() > Number(referencedBlock.timestamp) * 1000 + PREVIEW_TTL_MS) {
      throw new WithdrawalApiError(
        409,
        "PREVIEW_EXPIRED",
        "the referenced preview block is missing or older than 30 seconds; preview again",
        true,
      );
    }
    const referencedCanonical = await this.opts.gateway.blockByNumber(referencedBlock.number);
    if (!referencedCanonical || referencedCanonical.hash !== request.previewBlockHash) {
      throw new WithdrawalApiError(
        409,
        "PREVIEW_EXPIRED",
        "the referenced preview block is no longer canonical; preview again",
        true,
      );
    }

    // The hash proves what the user reviewed. Preparation independently pins
    // latest state and re-runs the exact max simulation before building Action.
    const preparedBlock = await this.opts.gateway.latestBlock();
    const preview = await this.previewAtBlock(request.owner, subaccountId, asset, preparedBlock);
    if (preview.blocker) {
      throw new WithdrawalApiError(409, "WITHDRAWAL_BLOCKED", preview.blocker.message, false, {
        blockerCode: preview.blocker.code,
      });
    }
    const protocolMax = BigInt(preview.protocolMaxTokenUnits);
    const quantum = tokenQuantum(preview.asset.tokenDecimals);
    if (tokenUnits % quantum !== 0n) {
      throw new WithdrawalApiError(
        400,
        "TOKEN_UNITS_UNALIGNED",
        `tokenUnits must be a multiple of ${quantum} to avoid rounded internal debits`,
      );
    }
    if (tokenUnits > protocolMax) {
      throw new WithdrawalApiError(
        409,
        "AMOUNT_EXCEEDS_MAX",
        "requested tokenUnits exceed the freshly simulated protocol maximum",
        false,
        { protocolMaxTokenUnits: protocolMax.toString() },
      );
    }

    const expiry = BigInt(Math.floor(this.now() / 1000) + ACTION_TTL_SECONDS);
    const action = buildWithdrawalAction({
      subaccountId,
      withdrawalModule: this.opts.withdrawalModule,
      asset: asset.assetAddress,
      assetAmount: tokenUnits,
      owner: request.owner,
      expiry,
    });
    const metadata = preview.asset;
    const review = this.makeReview({
      owner: request.owner,
      asset: metadata,
      tokenUnits,
      multiplier: BigInt(preview.multiplier),
      blockNumber: BigInt(preview.blockNumber),
      blockHash: preview.blockHash,
    });
    const operation: WithdrawalOperation = {
      id: randomUUID(),
      idempotencyKey: scopedKey,
      requestFingerprint: fingerprint,
      status: "prepared",
      chainId: this.opts.chainId,
      matching: this.opts.matching,
      owner: request.owner,
      subaccountId,
      asset: metadata,
      tokenUnits,
      maxWithdrawableAtPrepare: protocolMax,
      previewBlockHash: request.previewBlockHash,
      preparedAtBlockNumber: BigInt(preview.blockNumber),
      preparedAtBlockHash: preview.blockHash,
      action,
      actionDigest: getActionDigest(action, this.opts.chainId, this.opts.matching),
      review,
      createdAt: this.now(),
      expiresAt: Number(expiry) * 1000,
      submittedAt: null,
      confirmedAt: null,
      txHash: null,
      blockNumber: null,
      error: null,
    };
    const claimed = await this.opts.store.putIfIdempotencyAbsent(operation);
    if (!claimed.inserted) {
      if (claimed.operation.requestFingerprint !== fingerprint) {
        throw new WithdrawalApiError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "this owner and Idempotency-Key were already used with a different request",
        );
      }
      return { response: this.preparedResponse(claimed.operation), replayed: true };
    }
    return { response: this.preparedResponse(operation), replayed: false };
  }

  /** Claim the operation durably, then execute in the background. */
  async submit(id: string, request: SubmitWithdrawalRequest): Promise<WithdrawalResponse> {
    if (this.submitClaims.has(id)) {
      throw new WithdrawalApiError(409, "ALREADY_SUBMITTING", "withdrawal submission is already claimed");
    }
    this.submitClaims.add(id);
    try {
      const operation = await this.requiredOperation(id);
      if (operation.status !== "prepared") {
        throw new WithdrawalApiError(
          409,
          "INVALID_WITHDRAWAL_STATUS",
          `withdrawal is ${operation.status}, expected prepared`,
        );
      }
      if (this.now() >= operation.expiresAt) {
        operation.status = "expired";
        operation.error = errorBody("ACTION_EXPIRED", "the prepared action expired; prepare again");
        await this.opts.store.put(operation);
        throw new WithdrawalApiError(409, "ACTION_EXPIRED", operation.error.message);
      }
      const signatureValid = await this.opts.gateway.verifyActionSignature(
        operation.action,
        request.signature,
        operation.chainId,
        operation.matching,
      );
      if (!signatureValid) {
        throw new WithdrawalApiError(
          400,
          "INVALID_SIGNATURE",
          "signature does not match the prepared EIP-712 action signer",
        );
      }
      if (await this.opts.gateway.isNonceUsed(operation.owner, operation.action.nonce)) {
        const use = await this.opts.gateway.findActionUse(
          operation.action,
          operation.preparedAtBlockNumber,
        );
        if (use) {
          operation.status = "submitted";
          operation.txHash = use.txHash;
          operation.blockNumber = use.blockNumber;
          operation.submittedAt ??= this.now();
          operation.error = null;
          await this.opts.store.put(operation);
          this.opts.gateway.clearUnknownOperation(UNKNOWN_BROADCAST_OPERATION);
          await this.reconcileSubmitted(operation);
          return { withdrawal: this.publicOperation(operation) };
        }
        operation.status = "unknown";
        operation.error = errorBody(
          "NONCE_ATTRIBUTION_UNKNOWN",
          "the action nonce is used but no exact canonical transaction could be attributed",
        );
        await this.opts.store.put(operation);
        this.opts.gateway.pauseForUnknownOperation(operation.id);
        throw new WithdrawalApiError(409, operation.error.code, operation.error.message);
      }

      operation.status = "submitting";
      operation.submittedAt = this.now();
      operation.error = null;
      this.activeSubmissions.add(operation.id);
      // The durable store fsyncs this critical transition before any broadcast.
      try {
        await this.opts.store.put(operation);
      } catch (error) {
        this.activeSubmissions.delete(operation.id);
        throw error;
      }
      const response = { withdrawal: this.publicOperation(operation) };
      setImmediate(() => {
        void this.accountLock
          .run([operation.subaccountId], () =>
            this.executeSubmission(operation.id, request.signature),
          )
          .catch((error) => {
            // eslint-disable-next-line no-console
            console.error(`withdrawal ${operation.id} background task failed:`, error);
          })
          .finally(() => this.activeSubmissions.delete(operation.id));
      });
      return response;
    } finally {
      this.submitClaims.delete(id);
    }
  }

  async get(id: string): Promise<WithdrawalResponse> {
    const operation = await this.requiredOperation(id);
    if (operation.status === "prepared" && this.now() >= operation.expiresAt) {
      operation.status = "expired";
      operation.error = errorBody("ACTION_EXPIRED", "the prepared action expired; prepare again");
      await this.opts.store.put(operation);
    } else if (operation.status === "submitted" && operation.txHash) {
      await this.reconcileSubmitted(operation);
    } else if (
      (operation.status === "submitting" && !this.activeSubmissions.has(operation.id)) ||
      operation.status === "unknown"
    ) {
      await this.reconcileUnknown(operation);
    }
    return { withdrawal: this.publicOperation(operation) };
  }

  async recover(): Promise<WithdrawalRecoverySummary> {
    const summary: WithdrawalRecoverySummary = {
      expired: 0,
      confirmed: 0,
      reverted: 0,
      unknown: 0,
      pending: 0,
    };
    for (const operation of await this.opts.store.list()) {
      if (operation.status === "prepared" && this.now() >= operation.expiresAt) {
        operation.status = "expired";
        operation.error = errorBody("ACTION_EXPIRED", "the prepared action expired during restart");
        await this.opts.store.put(operation);
        summary.expired++;
      } else if (operation.status === "submitting" || operation.status === "unknown") {
        const reconciled = await this.reconcileUnknown(operation);
        if (reconciled === "expired") summary.expired++;
        else if (reconciled === "confirmed") summary.confirmed++;
        else if (reconciled === "reverted") summary.reverted++;
        else summary.unknown++;
      } else if (operation.status === "submitted" && operation.txHash) {
        const reconciled = await this.reconcileSubmitted(operation);
        if (reconciled === "confirmed") summary.confirmed++;
        else if (reconciled === "reverted") summary.reverted++;
        else summary.pending++;
      }
    }
    return summary;
  }

  private async previewAtBlock(
    owner: Address,
    subaccountId: bigint,
    asset: WithdrawalAssetDefinition,
    block: WithdrawalPinnedBlock,
  ): Promise<WithdrawalPreview> {
    const checkedAt = this.now();
    const snapshot = await this.opts.gateway.snapshot(subaccountId, asset, block.number);
    const metadata: WithdrawalAssetMetadata = {
      assetId: asset.assetId,
      kind: asset.kind,
      marketId: asset.marketId,
      symbol: snapshot.tokenSymbol,
      assetAddress: asset.assetAddress,
      tokenAddress: snapshot.tokenAddress,
      tokenDecimals: snapshot.tokenDecimals,
      scaledUi: asset.scaledUi,
    };
    let blocker = this.snapshotBlocker(owner, asset, snapshot);
    // Cash's stored SubAccounts balance is stale until interest is applied.
    // Present the interest-adjusted balance as the wallet-facing exact balance;
    // retain internalBalance separately for protocol diagnostics.
    const exactBalance18 = asset.kind === "cash"
      ? snapshot.cashWithInterest
      : snapshot.internalBalance;
    const balanceTokenUnits = toTokenUnitsFloor(
      exactBalance18 > 0n ? exactBalance18 : 0n,
      snapshot.tokenDecimals,
    );
    const debtTokenUnits = toTokenUnitsCeil(
      snapshot.cashWithInterest < 0n ? -snapshot.cashWithInterest : 0n,
      snapshot.cashTokenDecimals,
    );
    const reservedCash = asset.kind === "cash"
      ? await (this.opts.reservedCash?.(subaccountId) ?? 0n)
      : 0n;
    const availableCash = snapshot.cashWithInterest > reservedCash
      ? snapshot.cashWithInterest - reservedCash
      : 0n;
    const feeAdjustedCash = snapshot.cashWithdrawFeeEnabled && snapshot.cashExchangeRate > 0n
      ? ((availableCash + 1n) * snapshot.cashExchangeRate - 1n) / ONE
      : availableCash;
    const noBorrowCashCap = availableCash < feeAdjustedCash ? availableCash : feeAdjustedCash;
    let upper = asset.kind === "cash"
      ? toTokenUnitsFloor(noBorrowCashCap, snapshot.tokenDecimals)
      : balanceTokenUnits;
    if (upper > snapshot.tokenLiquidity) upper = snapshot.tokenLiquidity;
    const quantum = tokenQuantum(snapshot.tokenDecimals);
    upper = (upper / quantum) * quantum;

    let protocolMax = 0n;
    let marginLimited = false;
    if (!blocker && upper > 0n) {
      const result = await this.findMaximum(owner, subaccountId, asset, snapshot, block.number, upper);
      protocolMax = result.maximum;
      marginLimited = result.marginLimited;
      protocolMax = (protocolMax / quantum) * quantum;
      if (protocolMax === 0n) blocker = result.blocker;
    } else if (!blocker) {
      blocker = { code: "NO_POSITIVE_BALANCE", message: "the selected asset has no withdrawable balance" };
    }

    const canonical = await this.opts.gateway.blockByNumber(block.number);
    if (!canonical || canonical.number !== block.number || canonical.hash !== block.hash) {
      throw new WithdrawalApiError(
        503,
        "PREVIEW_REORGED",
        "the pinned block changed during simulation; preview again",
        true,
      );
    }
    const bufferedRecommended = marginLimited
      ? (protocolMax * (BPS - this.safetyBps)) / BPS
      : protocolMax;
    const recommended = (bufferedRecommended / quantum) * quantum;
    return {
      chainId: this.opts.chainId,
      matching: this.opts.matching,
      withdrawalModule: this.opts.withdrawalModule,
      owner,
      subaccountId: subaccountId.toString(),
      asset: metadata,
      internalBalance: snapshot.internalBalance.toString(),
      balanceTokenUnits: balanceTokenUnits.toString(),
      cashWithInterest: snapshot.cashWithInterest.toString(),
      debtTokenUnits: debtTokenUnits.toString(),
      cashExchangeRate: snapshot.cashExchangeRate.toString(),
      cashWithdrawFeeEnabled: snapshot.cashWithdrawFeeEnabled,
      margin: {
        initial: {
          margin: snapshot.initialMargin.toString(),
          markToMarket: snapshot.initialMarkToMarket.toString(),
        },
        maintenance: {
          margin: snapshot.maintenanceMargin.toString(),
          markToMarket: snapshot.maintenanceMarkToMarket.toString(),
        },
      },
      protocolMaxTokenUnits: protocolMax.toString(),
      recommendedMaxTokenUnits: recommended.toString(),
      multiplier: snapshot.multiplier.toString(),
      blockNumber: block.number.toString(),
      blockHash: block.hash,
      checkedAt,
      expiresAt: Number(block.timestamp) * 1000 + PREVIEW_TTL_MS,
      blocker,
    };
  }

  private snapshotBlocker(
    owner: Address,
    asset: WithdrawalAssetDefinition,
    snapshot: WithdrawalSnapshot,
  ): WithdrawalBlocker | null {
    if (addressEq(snapshot.matchingOwner, ZERO_ADDRESS)) {
      return { code: "ACCOUNT_NOT_IN_MATCHING", message: "the subaccount is not deposited in Matching" };
    }
    if (!addressEq(snapshot.matchingOwner, owner)) {
      return { code: "OWNER_MISMATCH", message: "owner does not control this Matching subaccount" };
    }
    if (!addressEq(snapshot.accountHolder, this.opts.matching)) {
      return { code: "ACCOUNT_NOT_HELD_BY_MATCHING", message: "Matching does not currently hold the subaccount NFT" };
    }
    if (snapshot.withdrawTimestamp !== 0n) {
      return { code: "ACCOUNT_EXIT_PENDING", message: "the 30-minute Matching NFT exit is already pending" };
    }
    if (!addressEq(snapshot.manager, this.opts.standardManager)) {
      return { code: "UNSUPPORTED_MANAGER", message: "withdrawals currently support StandardManager accounts only" };
    }
    if (asset.kind === "cash" && snapshot.cashWithdrawFeeEnabled) {
      return {
        code: "CASH_WITHDRAWALS_BLOCKED",
        message: "cash withdrawals are paused while the temporary insolvency fee is active",
      };
    }
    if (
      asset.configuredTokenAddress &&
      !addressEq(snapshot.tokenAddress, asset.configuredTokenAddress)
    ) {
      return { code: "ASSET_CONFIG_MISMATCH", message: "runtime wrapped token differs from the market manifest" };
    }
    if (
      asset.configuredTokenDecimals !== null &&
      snapshot.tokenDecimals !== asset.configuredTokenDecimals
    ) {
      return { code: "ASSET_DECIMALS_MISMATCH", message: "runtime token decimals differ from the market manifest" };
    }
    return null;
  }

  private async findMaximum(
    owner: Address,
    subaccountId: bigint,
    asset: WithdrawalAssetDefinition,
    snapshot: WithdrawalSnapshot,
    blockNumber: bigint,
    upper: bigint,
  ): Promise<{ maximum: bigint; blocker: WithdrawalBlocker; marginLimited: boolean }> {
    const simulate = (tokenUnits: bigint) =>
      this.opts.gateway.simulateAssetWithdrawal({
        subaccountId,
        asset,
        tokenUnits,
        recipient: owner,
        accountHolder: snapshot.accountHolder,
        blockNumber,
      });
    const full = await simulate(upper);
    if (full.ok) {
      return { maximum: upper, blocker: { code: "NONE", message: "" }, marginLimited: false };
    }

    let low = 0n;
    let high = upper;
    let blocker = full.blocker;
    let iterations = 0;
    while (low + 1n < high && iterations < 96) {
      iterations++;
      const candidate = (low + high) / 2n;
      const result = await simulate(candidate);
      if (result.ok) low = candidate;
      else {
        high = candidate;
        blocker = result.blocker;
      }
    }
    if (low + 1n < high) {
      throw new WithdrawalApiError(
        503,
        "MAX_SEARCH_INCONCLUSIVE",
        "exact max search exceeded 96 simulations; refusing an approximate result",
        true,
      );
    }
    return { maximum: low, blocker, marginLimited: true };
  }

  private async executeSubmission(id: string, signature: Hex): Promise<void> {
    const operation = await this.requiredOperation(id);
    try {
      const result = await this.opts.gateway.simulateAndSubmit(
        operation.action,
        signature,
        async (txHash) => {
          operation.status = "submitted";
          operation.txHash = txHash;
          // This fsync happens inside the executor queue before receipt waiting.
          await this.opts.store.put(operation);
        },
        () => this.assertFinalPolicy(operation),
      );
      operation.status = result.status === "success" ? "confirmed" : "reverted";
      operation.blockNumber = result.blockNumber;
      operation.confirmedAt = this.now();
      operation.error = result.status === "success"
        ? null
        : errorBody("TRANSACTION_REVERTED", "withdrawal transaction reverted");
      await this.opts.store.put(operation);
      if (operation.txHash) this.opts.gateway.clearUnresolvedTransaction(operation.txHash);
      // A status lookup may have observed the persisted `submitted` state
      // while waitForTransactionReceipt was still in flight and installed an
      // operation-level fail-closed latch. Release that exact latch only after
      // the terminal result is durably stored. Otherwise the shared executor
      // remains paused even though the background receipt waiter confirmed the
      // transaction and cleared its hash-level latch.
      this.opts.gateway.clearUnknownOperation(operation.id);
    } catch (error) {
      if (operation.txHash) {
        operation.status = "submitted";
        operation.error = errorBody(
          "RECEIPT_UNAVAILABLE",
          "transaction was broadcast but its receipt is not yet available",
          true,
        );
        this.opts.gateway.adoptUnresolvedTransaction(operation.txHash);
        this.opts.gateway.pauseForUnknownOperation(operation.id);
      } else if (error instanceof WithdrawalApiError) {
        operation.status = "rejected";
        operation.error = error.body;
      } else if (error instanceof ExecutorSimulationError) {
        operation.status = "rejected";
        operation.error = errorBody(
          "SIGNED_SIMULATION_REJECTED",
          "the latest signed withdrawal simulation was rejected",
          false,
        );
      } else if (error instanceof ExecutorBroadcastUnknownError) {
        operation.status = "unknown";
        operation.error = errorBody(
          "BROADCAST_OUTCOME_UNKNOWN",
          "the executor broadcast outcome is ambiguous; writes are paused pending reconciliation",
          false,
        );
        this.opts.gateway.pauseForUnknownOperation(operation.id);
      } else {
        operation.status = "unknown";
        operation.error = errorBody(
          "SUBMISSION_OUTCOME_UNKNOWN",
          "withdrawal submission outcome is ambiguous; writes are paused pending reconciliation",
          false,
        );
        this.opts.gateway.pauseForUnknownOperation(operation.id);
      }
      await this.opts.store.put(operation);
    }
  }

  private async reconcileSubmitted(
    operation: WithdrawalOperation,
  ): Promise<"submitted" | "confirmed" | "reverted"> {
    if (!operation.txHash) return "submitted";
    const receipt = await this.opts.gateway.receipt(operation.txHash);
    if (!receipt) {
      this.opts.gateway.adoptUnresolvedTransaction(operation.txHash);
      this.opts.gateway.pauseForUnknownOperation(operation.id);
      return "submitted";
    }
    operation.status = receipt.status === "success" ? "confirmed" : "reverted";
    operation.blockNumber = receipt.blockNumber;
    operation.confirmedAt = this.now();
    operation.error = receipt.status === "success"
      ? null
      : errorBody("TRANSACTION_REVERTED", "withdrawal transaction reverted");
    await this.opts.store.put(operation);
    this.opts.gateway.clearUnresolvedTransaction(operation.txHash);
    this.opts.gateway.clearUnknownOperation(operation.id);
    return operation.status;
  }

  private async reconcileUnknown(
    operation: WithdrawalOperation,
  ): Promise<"unknown" | "submitted" | "confirmed" | "reverted" | "expired"> {
    const latestBlock = await this.opts.gateway.latestBlock();
    const used = await this.opts.gateway.isNonceUsed(operation.owner, operation.action.nonce);
    const use = used
      ? await this.opts.gateway.findActionUse(
          operation.action,
          operation.preparedAtBlockNumber,
        )
      : null;
    if (!use) {
      if (!used && latestBlock.timestamp > operation.action.expiry) {
        const canonical = await this.opts.gateway.blockByNumber(latestBlock.number);
        if (canonical?.hash.toLowerCase() === latestBlock.hash.toLowerCase()) {
          // ActionVerifier rejects strictly after action.expiry. With the
          // canonical module nonce still unused, no hashless executor outcome
          // can now move funds. Persist this terminal proof before releasing
          // both the operation-specific and broadcast-without-hash latches.
          operation.status = "expired";
          operation.error = errorBody(
            "ACTION_EXPIRED_UNEXECUTED",
            "the action expired without its module nonce being used",
          );
          await this.opts.store.put(operation);
          this.opts.gateway.clearUnknownOperation(operation.id);
          this.opts.gateway.clearUnknownOperation(UNKNOWN_BROADCAST_OPERATION);
          return "expired";
        }
      }
      operation.status = "unknown";
      operation.error = errorBody(
        "BROADCAST_OUTCOME_UNKNOWN",
        used
          ? "action nonce is used but its canonical NonceUsed event was not found"
          : "submit outcome is ambiguous and the action nonce is not yet visible on-chain",
        false,
      );
      await this.opts.store.put(operation);
      this.opts.gateway.pauseForUnknownOperation(operation.id);
      return "unknown";
    }

    operation.status = "submitted";
    operation.txHash = use.txHash;
    operation.blockNumber = use.blockNumber;
    operation.error = null;
    await this.opts.store.put(operation);
    this.opts.gateway.clearUnknownOperation(UNKNOWN_BROADCAST_OPERATION);
    const status = await this.reconcileSubmitted(operation);
    if (status === "submitted") this.opts.gateway.pauseForUnknownOperation(operation.id);
    return status;
  }

  private preparedResponse(operation: WithdrawalOperation): PrepareWithdrawalResponse {
    return {
      withdrawalId: operation.id,
      action: serializeAction(operation.action),
      typedData: this.signingPayload(operation),
      review: operation.review,
    };
  }

  /** Runs under both the subaccount mutex and executor-wide write queue. */
  private async assertFinalPolicy(operation: WithdrawalOperation): Promise<void> {
    const asset = this.resolveAsset(operation.asset.assetId);
    const block = await this.opts.gateway.latestBlock();
    const snapshot = await this.opts.gateway.snapshot(operation.subaccountId, asset, block.number);
    const blocker = this.snapshotBlocker(operation.owner, asset, snapshot);
    if (blocker) {
      throw new WithdrawalApiError(409, "POLICY_CHANGED", blocker.message, false, {
        blockerCode: blocker.code,
      });
    }

    const reservedCash = asset.kind === "cash"
      ? await (this.opts.reservedCash?.(operation.subaccountId) ?? 0n)
      : 0n;
    const availableCash = snapshot.cashWithInterest > reservedCash
      ? snapshot.cashWithInterest - reservedCash
      : 0n;
    const feeAdjustedCash = snapshot.cashWithdrawFeeEnabled && snapshot.cashExchangeRate > 0n
      ? ((availableCash + 1n) * snapshot.cashExchangeRate - 1n) / ONE
      : availableCash;
    const cashCap18 = availableCash < feeAdjustedCash ? availableCash : feeAdjustedCash;
    let cap = asset.kind === "cash"
      ? toTokenUnitsFloor(cashCap18, snapshot.tokenDecimals)
      : toTokenUnitsFloor(
          snapshot.internalBalance > 0n ? snapshot.internalBalance : 0n,
          snapshot.tokenDecimals,
        );
    if (cap > snapshot.tokenLiquidity) cap = snapshot.tokenLiquidity;
    const quantum = tokenQuantum(snapshot.tokenDecimals);
    cap = (cap / quantum) * quantum;
    if (operation.tokenUnits % quantum !== 0n || operation.tokenUnits > cap) {
      throw new WithdrawalApiError(
        409,
        "POLICY_MAX_REDUCED",
        "the latest balance, liquidity, insolvency, or reservation cap is below the signed amount",
        false,
        { latestPolicyMaxTokenUnits: cap.toString() },
      );
    }
    const simulation = await this.opts.gateway.simulateAssetWithdrawal({
      subaccountId: operation.subaccountId,
      asset,
      tokenUnits: operation.tokenUnits,
      recipient: operation.owner,
      accountHolder: snapshot.accountHolder,
      blockNumber: block.number,
    });
    if (!simulation.ok) {
      throw new WithdrawalApiError(409, "POLICY_CHANGED", simulation.blocker.message, false, {
        blockerCode: simulation.blocker.code,
      });
    }
    const canonical = await this.opts.gateway.blockByNumber(block.number);
    if (!canonical || canonical.hash !== block.hash) {
      throw new WithdrawalApiError(
        503,
        "FINAL_PREFLIGHT_REORGED",
        "latest state changed during final policy preflight",
        true,
      );
    }
  }

  private signingPayload(operation: WithdrawalOperation): WithdrawalSigningPayload {
    const typed = getActionTypedData(operation.action, operation.chainId, operation.matching);
    return {
      domain: typed.domain,
      types: typed.types,
      primaryType: typed.primaryType,
      message: serializeAction(operation.action),
    };
  }

  private makeReview(params: {
    owner: Address;
    asset: WithdrawalAssetMetadata;
    tokenUnits: bigint;
    multiplier: bigint;
    blockNumber: bigint;
    blockHash: Hex;
  }): WithdrawalReview {
    const internalAmount = tokenUnitsTo18Floor(params.tokenUnits, params.asset.tokenDecimals);
    const displayed18 = (internalAmount * params.multiplier) / ONE;
    return {
      recipient: params.owner,
      assetId: params.asset.assetId,
      assetAddress: params.asset.assetAddress,
      tokenAddress: params.asset.tokenAddress,
      tokenUnits: params.tokenUnits.toString(),
      displayAmount: formatUnits(displayed18, 18),
      tokenDecimals: params.asset.tokenDecimals,
      multiplier: params.multiplier.toString(),
      preparedBlockNumber: params.blockNumber.toString(),
      preparedBlockHash: params.blockHash,
    };
  }

  private publicOperation(operation: WithdrawalOperation): PublicWithdrawal {
    return {
      id: operation.id,
      status: operation.status,
      chainId: operation.chainId,
      matching: operation.matching,
      owner: operation.owner,
      subaccountId: operation.subaccountId.toString(),
      asset: operation.asset,
      tokenUnits: operation.tokenUnits.toString(),
      maxWithdrawableAtPrepare: operation.maxWithdrawableAtPrepare.toString(),
      previewBlockHash: operation.previewBlockHash,
      preparedAtBlockNumber: operation.preparedAtBlockNumber.toString(),
      preparedAtBlockHash: operation.preparedAtBlockHash,
      action: serializeAction(operation.action),
      actionDigest: operation.actionDigest,
      createdAt: operation.createdAt,
      expiresAt: operation.expiresAt,
      submittedAt: operation.submittedAt,
      confirmedAt: operation.confirmedAt,
      txHash: operation.txHash,
      blockNumber: operation.blockNumber?.toString() ?? null,
      error: operation.error,
    };
  }

  private resolveAsset(assetId: WithdrawalAssetId): WithdrawalAssetDefinition {
    const asset = this.assets.get(assetId);
    if (!asset) {
      throw new WithdrawalApiError(400, "UNSUPPORTED_ASSET", `assetId ${assetId} is not enabled`);
    }
    return asset;
  }

  private validateIdempotencyKey(key: string): void {
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
      throw new WithdrawalApiError(
        400,
        "INVALID_IDEMPOTENCY_KEY",
        "Idempotency-Key must be 8-128 URL-safe characters",
      );
    }
  }

  private async requiredOperation(id: string): Promise<WithdrawalOperation> {
    const operation = await this.opts.store.get(id);
    if (!operation) throw new WithdrawalApiError(404, "WITHDRAWAL_NOT_FOUND", "withdrawal not found");
    return operation;
  }

}
