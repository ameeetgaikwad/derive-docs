import type { Address, Hex } from "viem";
import type { SerializedAction } from "./actions";
import { rfqEngineUrl } from "./rfq-engine";
import type { MarketId } from "./markets";
import type { AppChainId } from "@/stores/network";
import type { WithdrawalAssetId } from "./withdrawal-assets";

export interface WithdrawalErrorBody {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, string | number | boolean | null>;
}

export class WithdrawalRequestError extends Error {
  constructor(
    public readonly status: number | null,
    public readonly body: WithdrawalErrorBody,
  ) {
    super(body.message);
    this.name = "WithdrawalRequestError";
  }
}

export interface WithdrawalAssetMetadata {
  assetId: WithdrawalAssetId;
  kind: "cash" | "market-collateral";
  marketId: MarketId | null;
  symbol: string;
  assetAddress: Address;
  tokenAddress: Address;
  tokenDecimals: number;
  scaledUi: boolean;
}

export interface WithdrawalPreview {
  chainId: number;
  matching: Address;
  withdrawalModule: Address;
  owner: Address;
  subaccountId: string;
  asset: WithdrawalAssetMetadata;
  internalBalance: string;
  balanceTokenUnits: string;
  cashWithInterest: string;
  debtTokenUnits: string;
  margin: {
    initial: { margin: string; markToMarket: string };
    maintenance: { margin: string; markToMarket: string };
  };
  protocolMaxTokenUnits: string;
  recommendedMaxTokenUnits: string;
  multiplier: string;
  blockNumber: string;
  blockHash: Hex;
  checkedAt: number;
  expiresAt: number;
  blocker: { code: string; message: string } | null;
}

export type WithdrawalStatus =
  | "prepared"
  | "submitting"
  | "submitted"
  | "confirmed"
  | "rejected"
  | "reverted"
  | "expired"
  | "unknown";

export interface WithdrawalRecord {
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

export interface WithdrawalSigningPayload {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: Address;
  };
  types: {
    Action: ReadonlyArray<{ name: string; type: string }>;
  };
  primaryType: "Action";
  message: SerializedAction;
}

export interface WithdrawalReview {
  recipient: Address;
  assetId: WithdrawalAssetId;
  assetAddress: Address;
  tokenAddress: Address;
  tokenUnits: string;
  displayAmount: string;
  tokenDecimals: number;
  multiplier: string;
  preparedBlockNumber: string;
  preparedBlockHash: Hex;
}

export interface PreparedWithdrawalResponse {
  withdrawalId: string;
  action: SerializedAction;
  typedData: WithdrawalSigningPayload;
  review: WithdrawalReview;
}

async function withdrawalRequest<T>(
  chainId: AppChainId,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const baseUrl = rfqEngineUrl(chainId);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
  } catch {
    throw new WithdrawalRequestError(null, {
      code: "ENGINE_UNREACHABLE",
      message: `Withdrawal service unreachable at ${baseUrl}`,
      retryable: true,
    });
  }
  const body = (await response.json().catch(() => ({}))) as {
    error?: Partial<WithdrawalErrorBody>;
  };
  if (!response.ok) {
    const error = body.error;
    throw new WithdrawalRequestError(response.status, {
      code: typeof error?.code === "string" ? error.code : `HTTP_${response.status}`,
      message: typeof error?.message === "string" ? error.message : `Withdrawal request failed (${response.status})`,
      retryable: error?.retryable === true,
      details: error?.details,
    });
  }
  return body as T;
}

export async function previewWithdrawal(
  params: { owner: Address; subaccountId: bigint; assetId: WithdrawalAssetId },
  chainId: AppChainId,
): Promise<WithdrawalPreview> {
  const response = await withdrawalRequest<{ preview: WithdrawalPreview }>(
    chainId,
    "/withdrawals/preview",
    { method: "POST", body: JSON.stringify({ ...params, subaccountId: params.subaccountId.toString() }) },
  );
  return response.preview;
}

export async function prepareWithdrawal(
  params: {
    owner: Address;
    subaccountId: bigint;
    assetId: WithdrawalAssetId;
    tokenUnits: bigint;
    previewBlockHash: Hex;
    idempotencyKey: string;
  },
  chainId: AppChainId,
): Promise<PreparedWithdrawalResponse> {
  return withdrawalRequest<PreparedWithdrawalResponse>(chainId, "/withdrawals", {
    method: "POST",
    headers: { "Idempotency-Key": params.idempotencyKey },
    body: JSON.stringify({
      owner: params.owner,
      subaccountId: params.subaccountId.toString(),
      assetId: params.assetId,
      tokenUnits: params.tokenUnits.toString(),
      previewBlockHash: params.previewBlockHash,
    }),
  });
}

export async function submitWithdrawal(
  id: string,
  signature: Hex,
  chainId: AppChainId,
): Promise<WithdrawalRecord> {
  const response = await withdrawalRequest<{ withdrawal: WithdrawalRecord }>(
    chainId,
    `/withdrawals/${encodeURIComponent(id)}/submit`,
    { method: "POST", body: JSON.stringify({ signature }) },
  );
  return response.withdrawal;
}

export async function getWithdrawal(
  id: string,
  chainId: AppChainId,
): Promise<WithdrawalRecord> {
  const response = await withdrawalRequest<{ withdrawal: WithdrawalRecord }>(
    chainId,
    `/withdrawals/${encodeURIComponent(id)}`,
  );
  return response.withdrawal;
}
