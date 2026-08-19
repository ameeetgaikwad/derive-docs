import type { Address, Hex } from "viem";
import type { Action } from "@hedge/shared";
import type { SerializedAction } from "./types.js";

export type WithdrawalAssetId = "cash" | `market:${string}`;

export type WithdrawalStatus =
  | "prepared"
  | "submitting"
  | "submitted"
  | "confirmed"
  | "rejected"
  | "reverted"
  | "expired"
  | "unknown";

export interface WithdrawalAssetMetadata {
  assetId: WithdrawalAssetId;
  kind: "cash" | "market-collateral";
  marketId: string | null;
  symbol: string;
  assetAddress: Address;
  tokenAddress: Address;
  tokenDecimals: number;
  scaledUi: boolean;
}

export interface WithdrawalMarginDiagnostic {
  /** Signed 18-decimal protocol units. */
  margin: string;
  /** Signed 18-decimal protocol units. */
  markToMarket: string;
}

export interface WithdrawalBlocker {
  code: string;
  message: string;
}

export interface WithdrawalPreviewRequest {
  owner: Address;
  subaccountId: string;
  assetId: WithdrawalAssetId;
}

export interface WithdrawalPreview {
  chainId: number;
  matching: Address;
  withdrawalModule: Address;
  owner: Address;
  subaccountId: string;
  asset: WithdrawalAssetMetadata;
  /** Signed SubAccounts balance in 18-decimal protocol units. */
  internalBalance: string;
  /** Positive internal balance converted to wrapped-token native units. */
  balanceTokenUnits: string;
  /** Interest-adjusted cash balance (18 decimals), present for every selected asset. */
  cashWithInterest: string;
  /** Positive debt magnitude in wrapped-token native units. */
  debtTokenUnits: string;
  /** 18-decimal cash-to-stable exchange rate at the pinned block. */
  cashExchangeRate: string;
  /** True while CashAsset would burn a variable amount of internal cash. */
  cashWithdrawFeeEnabled: boolean;
  margin: {
    initial: WithdrawalMarginDiagnostic;
    maintenance: WithdrawalMarginDiagnostic;
  };
  /** Exact largest token-native amount that simulated successfully at this block. */
  protocolMaxTokenUnits: string;
  /** UI-safe amount after the configured safety haircut. */
  recommendedMaxTokenUnits: string;
  /** 18-decimal display multiplier (1e18 for unscaled collateral). */
  multiplier: string;
  blockNumber: string;
  blockHash: Hex;
  checkedAt: number;
  /** Millisecond epoch; previews are valid for at most 30 seconds. */
  expiresAt: number;
  blocker: WithdrawalBlocker | null;
}

export interface WithdrawalPreviewResponse {
  preview: WithdrawalPreview;
}

export interface PrepareWithdrawalRequest {
  owner: Address;
  subaccountId: string;
  assetId: WithdrawalAssetId;
  /** Wrapped-token native units as a base-10 integer string. */
  tokenUnits: string;
  previewBlockHash: Hex;
}

export interface SubmitWithdrawalRequest {
  signature: Hex;
}

export interface WithdrawalErrorBody {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, string | number | boolean | null>;
}

export interface WithdrawalSigningPayload {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: Address;
  };
  types: {
    Action: readonly {
      readonly name: string;
      readonly type: string;
    }[];
  };
  primaryType: "Action";
  message: SerializedAction;
}

export interface WithdrawalReview {
  recipient: Address;
  assetId: WithdrawalAssetId;
  assetAddress: Address;
  tokenAddress: Address;
  /** Wrapped-token native units. */
  tokenUnits: string;
  /** Human display amount frozen with the multiplier used at prepare time. */
  displayAmount: string;
  tokenDecimals: number;
  multiplier: string;
  preparedBlockNumber: string;
  preparedBlockHash: Hex;
}

export interface PublicWithdrawal {
  id: string;
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
  action: SerializedAction;
  actionDigest: Hex;
  createdAt: number;
  expiresAt: number;
  submittedAt: number | null;
  confirmedAt: number | null;
  txHash: Hex | null;
  blockNumber: string | null;
  error: WithdrawalErrorBody | null;
}

export interface PrepareWithdrawalResponse {
  withdrawalId: string;
  action: SerializedAction;
  typedData: WithdrawalSigningPayload;
  review: WithdrawalReview;
}

export interface WithdrawalResponse {
  withdrawal: PublicWithdrawal;
}

export interface WithdrawalErrorResponse {
  error: WithdrawalErrorBody;
}

export interface WithdrawalAssetDefinition {
  assetId: WithdrawalAssetId;
  kind: WithdrawalAssetMetadata["kind"];
  marketId: string | null;
  symbol: string;
  assetAddress: Address;
  configuredTokenAddress: Address | null;
  configuredTokenDecimals: number | null;
  scaledUi: boolean;
}

export interface WithdrawalOperation {
  id: string;
  idempotencyKey: string;
  requestFingerprint: Hex;
  status: WithdrawalStatus;
  chainId: number;
  matching: Address;
  owner: Address;
  subaccountId: bigint;
  asset: WithdrawalAssetMetadata;
  tokenUnits: bigint;
  maxWithdrawableAtPrepare: bigint;
  previewBlockHash: Hex;
  preparedAtBlockNumber: bigint;
  preparedAtBlockHash: Hex;
  action: Action;
  actionDigest: Hex;
  /** Immutable signing review, persisted for idempotent replay and restart. */
  review: WithdrawalReview;
  createdAt: number;
  expiresAt: number;
  submittedAt: number | null;
  confirmedAt: number | null;
  txHash: Hex | null;
  blockNumber: bigint | null;
  error: WithdrawalErrorBody | null;
}

export class WithdrawalApiError extends Error {
  readonly body: WithdrawalErrorBody;

  constructor(
    readonly httpStatus: number,
    code: string,
    message: string,
    retryable = false,
    details?: WithdrawalErrorBody["details"],
  ) {
    super(message);
    this.name = "WithdrawalApiError";
    this.body = { code, message, retryable, ...(details ? { details } : {}) };
  }
}
