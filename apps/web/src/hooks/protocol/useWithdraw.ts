"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { decodeAbiParameters, encodeAbiParameters, zeroAddress, type Address, type Hex } from "viem";
import { useAccount, useSignTypedData, useSwitchChain } from "wagmi";
import { actionTypedData, type Action } from "@/lib/protocol/actions";
import { ACTION_TYPES } from "@/lib/protocol/constants";
import {
  getWithdrawal,
  prepareWithdrawal,
  previewWithdrawal,
  submitWithdrawal,
  WithdrawalRequestError,
  type PreparedWithdrawalResponse,
  type WithdrawalErrorBody,
  type WithdrawalPreview,
  type WithdrawalRecord,
  type WithdrawalStatus,
} from "@/lib/protocol/withdrawals";
import type { WithdrawalAssetId } from "@/lib/protocol/withdrawal-assets";
import type { AppChainId } from "@/stores/network";
import { useNetwork } from "./useNetwork";
import { refreshFundsQueries } from "./queryRefresh";

export type WithdrawPhase =
  | "idle"
  | "previewing"
  | "review"
  | "preparing"
  | "ready"
  | "signing"
  | "submitting"
  | "confirming"
  | "refreshing"
  | "done"
  | "rejected"
  | "reverted"
  | "expired"
  | "unknown"
  | "error";

interface FrozenWithdrawalContext {
  owner: Address;
  chainId: AppChainId;
  matching: Address;
  withdrawalModule: Address;
  subaccountId: bigint;
  assetId: WithdrawalAssetId;
  protocolAsset: Address;
  tokenAddress: Address;
  tokenUnits?: bigint;
  idempotencyKey: string;
  formSnapshot?: WithdrawalFormSnapshot;
}

export interface WithdrawalFormSnapshot {
  /** Canonical wallet-facing decimal amount (no insignificant trailing zeros). */
  displayAmount: string;
  /** Exact wrapped-token native units. */
  tokenUnits: bigint;
  tokenDecimals: number;
  /** Exact 18dp multiplier, including 1e18 for unscaled assets. */
  multiplier: string;
}

function freshIdempotencyKey(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Secure randomness is unavailable; cannot create a withdrawal request");
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return `withdraw-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function operationStorageKey(owner: Address, chainId: AppChainId, matching: Address): string {
  return `hedge.withdrawal-operation:${chainId}:${matching.toLowerCase()}:${owner.toLowerCase()}`;
}

function storeOperationId(context: FrozenWithdrawalContext, id: string): boolean {
  try {
    window.localStorage.setItem(operationStorageKey(context.owner, context.chainId, context.matching), id);
    return true;
  } catch {
    return false;
  }
}

function clearOperationId(context: FrozenWithdrawalContext): void {
  try {
    window.localStorage.removeItem(operationStorageKey(context.owner, context.chainId, context.matching));
  } catch {}
}

function parseAction(action: PreparedWithdrawalResponse["action"]): Action {
  return {
    subaccountId: BigInt(action.subaccountId),
    nonce: BigInt(action.nonce),
    module: action.module as Address,
    data: action.data as Hex,
    expiry: BigInt(action.expiry),
    owner: action.owner as Address,
    signer: action.signer as Address,
  };
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

const WITHDRAWAL_DATA_PARAMETERS = [{
  type: "tuple",
  components: [
    { name: "asset", type: "address" },
    { name: "assetAmount", type: "uint256" },
  ],
}] as const;

/** Reject any server signing payload that drifts from the user's reviewed intent. */
export function validatePreparedWithdrawal(
  prepared: PreparedWithdrawalResponse,
  preview: WithdrawalPreview,
  context: FrozenWithdrawalContext,
): Action {
  const { review, typedData, action: serializedAction } = prepared;
  if (
    !sameAddress(review.recipient, context.owner) ||
    review.assetId !== context.assetId ||
    !sameAddress(review.assetAddress, context.protocolAsset) ||
    !sameAddress(review.tokenAddress, context.tokenAddress) ||
    !sameAddress(review.assetAddress, preview.asset.assetAddress) ||
    !sameAddress(review.tokenAddress, preview.asset.tokenAddress) ||
    review.tokenUnits !== context.tokenUnits?.toString()
  ) {
    throw new Error("Prepared withdrawal does not match the reviewed request");
  }
  if (
    !context.formSnapshot ||
    review.tokenUnits !== context.formSnapshot.tokenUnits.toString() ||
    review.displayAmount !== context.formSnapshot.displayAmount ||
    review.tokenDecimals !== context.formSnapshot.tokenDecimals ||
    review.multiplier !== context.formSnapshot.multiplier
  ) {
    throw new Error("Withdrawal amount or conversion snapshot changed; review it again");
  }
  if (
    typedData.primaryType !== "Action" ||
    typedData.domain.name !== "Matching" ||
    typedData.domain.version !== "1.0" ||
    typedData.domain.chainId !== context.chainId ||
    !sameAddress(typedData.domain.verifyingContract, context.matching) ||
    JSON.stringify(typedData.types.Action) !== JSON.stringify(ACTION_TYPES.Action) ||
    JSON.stringify(typedData.message) !== JSON.stringify(serializedAction)
  ) {
    throw new Error("Withdrawal signing payload failed local verification");
  }
  const action = parseAction(serializedAction);
  if (
    action.subaccountId !== context.subaccountId ||
    !sameAddress(action.module, context.withdrawalModule) ||
    !sameAddress(action.owner, context.owner) ||
    !sameAddress(action.signer, context.owner)
  ) {
    throw new Error("Withdrawal action failed local verification");
  }
  let decoded: readonly [{ asset: Address; assetAmount: bigint }];
  try {
    decoded = decodeAbiParameters(WITHDRAWAL_DATA_PARAMETERS, action.data);
  } catch {
    throw new Error("Withdrawal action data is not canonical");
  }
  if (
    !sameAddress(decoded[0].asset, review.assetAddress) ||
    decoded[0].assetAmount.toString() !== review.tokenUnits ||
    encodeAbiParameters(WITHDRAWAL_DATA_PARAMETERS, decoded).toLowerCase() !== action.data.toLowerCase()
  ) {
    throw new Error("Withdrawal action asset or amount does not match the review");
  }
  return action;
}

function phaseForStatus(status: WithdrawalStatus): WithdrawPhase {
  switch (status) {
    case "confirmed": return "done";
    case "rejected": return "rejected";
    case "reverted": return "reverted";
    case "expired": return "expired";
    case "unknown": return "unknown";
    case "submitting": return "submitting";
    case "submitted": return "confirming";
    case "prepared": return "ready";
  }
}

function normalizedError(error: unknown): WithdrawalErrorBody {
  if (error instanceof WithdrawalRequestError) return error.body;
  return {
    code: "WITHDRAWAL_FAILED",
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
}

export function useWithdraw() {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const queryClient = useQueryClient();
  const { addresses, chainId } = useNetwork();
  const [phase, setPhase] = useState<WithdrawPhase>("idle");
  const [preview, setPreview] = useState<WithdrawalPreview | null>(null);
  const [prepared, setPrepared] = useState<PreparedWithdrawalResponse | null>(null);
  const [withdrawal, setWithdrawal] = useState<WithdrawalRecord | null>(null);
  const [error, setError] = useState<WithdrawalErrorBody | null>(null);
  const [isAmountReviewed, setIsAmountReviewed] = useState(false);
  const [activeOperationId, setActiveOperationId] = useState<string | null>(null);
  const contextRef = useRef<FrozenWithdrawalContext | null>(null);
  const busyRef = useRef(false);
  const activeIdRef = useRef<string | null>(null);

  const reset = useCallback(() => {
    if (busyRef.current) return;
    contextRef.current = null;
    activeIdRef.current = null;
    setActiveOperationId(null);
    setPhase("idle");
    setPreview(null);
    setPrepared(null);
    setWithdrawal(null);
    setError(null);
    setIsAmountReviewed(false);
  }, []);

  const requestPreview = useCallback(async (params: {
    subaccountId: bigint;
    assetId: WithdrawalAssetId;
    protocolAsset: Address;
    tokenAddress: Address;
    formSnapshot?: WithdrawalFormSnapshot;
  }) => {
    if (!address) throw new Error("Wallet not connected");
    if (busyRef.current) throw new Error("A withdrawal request is already in progress");
    const context: FrozenWithdrawalContext = {
      owner: address,
      chainId,
      matching: addresses.matching,
      withdrawalModule: addresses.withdrawalModule,
      subaccountId: params.subaccountId,
      assetId: params.assetId,
      protocolAsset: params.protocolAsset,
      tokenAddress: params.tokenAddress,
      idempotencyKey: freshIdempotencyKey(),
      formSnapshot: params.formSnapshot,
    };
    busyRef.current = true;
    contextRef.current = context;
    setPhase("previewing");
    setPrepared(null);
    setWithdrawal(null);
    setError(null);
    setIsAmountReviewed(false);
    try {
      const next = await previewWithdrawal({
        owner: context.owner,
        subaccountId: context.subaccountId,
        assetId: context.assetId,
      }, context.chainId);
      if (
        next.chainId !== context.chainId ||
        !sameAddress(next.owner, context.owner) ||
        !sameAddress(next.matching, context.matching) ||
        !sameAddress(next.withdrawalModule, context.withdrawalModule) ||
        next.subaccountId !== context.subaccountId.toString() ||
        next.asset.assetId !== context.assetId ||
        !sameAddress(next.asset.assetAddress, context.protocolAsset) ||
        !sameAddress(next.asset.tokenAddress, context.tokenAddress)
      ) throw new Error("Withdrawal preview does not match this wallet and account");
      if (
        context.formSnapshot &&
        (next.asset.tokenDecimals !== context.formSnapshot.tokenDecimals ||
          next.multiplier !== context.formSnapshot.multiplier)
      ) throw new Error("Asset decimals or conversion multiplier changed; review the amount again");
      setPreview(next);
      setIsAmountReviewed(!!context.formSnapshot);
      setPhase("review");
      return next;
    } catch (caught) {
      setError(normalizedError(caught));
      setPhase("error");
      throw caught;
    } finally {
      busyRef.current = false;
    }
  }, [address, addresses.matching, addresses.withdrawalModule, chainId]);

  const prepare = useCallback(async (formSnapshot: WithdrawalFormSnapshot) => {
    const context = contextRef.current;
    if (!context || !preview) throw new Error("Request a current withdrawal preview first");
    if (
      !context.formSnapshot ||
      formSnapshot.displayAmount !== context.formSnapshot.displayAmount ||
      formSnapshot.tokenUnits !== context.formSnapshot.tokenUnits ||
      formSnapshot.tokenDecimals !== context.formSnapshot.tokenDecimals ||
      formSnapshot.multiplier !== context.formSnapshot.multiplier
    ) throw new Error("Amount changed after review; request a new preview");
    const tokenUnits = formSnapshot.tokenUnits;
    if (tokenUnits <= 0n) throw new Error("Withdrawal amount must be greater than zero");
    if (BigInt(preview.protocolMaxTokenUnits) < tokenUnits) {
      throw new Error("Amount exceeds the current protocol maximum");
    }
    if (preview.blocker) throw new Error(preview.blocker.message);
    if (Date.now() >= preview.expiresAt) throw new Error("Withdrawal preview expired; refresh it");
    if (busyRef.current) throw new Error("A withdrawal request is already in progress");
    busyRef.current = true;
    context.tokenUnits = tokenUnits;
    setPhase("preparing");
    setError(null);
    try {
      const response = await prepareWithdrawal({
        owner: context.owner,
        subaccountId: context.subaccountId,
        assetId: context.assetId,
        tokenUnits,
        previewBlockHash: preview.blockHash,
        idempotencyKey: context.idempotencyKey,
      }, context.chainId);
      validatePreparedWithdrawal(response, preview, context);
      setPrepared(response);
      setWithdrawal(null);
      activeIdRef.current = response.withdrawalId;
      setActiveOperationId(response.withdrawalId);
      setPhase("ready");
      return response;
    } catch (caught) {
      setError(normalizedError(caught));
      setPhase("error");
      throw caught;
    } finally {
      busyRef.current = false;
    }
  }, [preview]);

  const reconcile = useCallback(async (operationId?: string) => {
    const context = contextRef.current;
    const id = operationId ?? activeIdRef.current;
    if (!context || !id) return null;
    try {
      const next = await getWithdrawal(id, context.chainId);
      if (
        next.chainId !== context.chainId ||
        !sameAddress(next.owner, context.owner) ||
        !sameAddress(next.matching, context.matching)
      ) throw new Error("Stored withdrawal does not match the connected wallet and network");
      setWithdrawal(next);
      setPhase(next.status === "prepared" && !prepared ? "unknown" : phaseForStatus(next.status));
      if (next.error) setError(next.error);
      if (next.status === "confirmed") {
        setPhase("refreshing");
        await refreshFundsQueries(queryClient, context);
        setPhase("done");
      }
      if (["confirmed", "rejected", "reverted", "expired"].includes(next.status)) {
        clearOperationId(context);
        activeIdRef.current = null;
        setActiveOperationId(null);
      } else {
        activeIdRef.current = next.id;
        setActiveOperationId(next.id);
        storeOperationId(context, next.id);
      }
      return next;
    } catch (caught) {
      setError(normalizedError(caught));
      setPhase("unknown");
      return null;
    }
  }, [prepared, queryClient]);

  const signAndSubmit = useCallback(async () => {
    const context = contextRef.current;
    if (!context || !preview || !prepared) throw new Error("Prepare a withdrawal before signing");
    if (!address || !sameAddress(address, context.owner)) {
      throw new Error("Reconnect the wallet that prepared this withdrawal");
    }
    if (Date.now() >= Number(prepared.action.expiry) * 1_000) {
      setPhase("expired");
      throw new Error("Prepared withdrawal expired; start again");
    }
    if (busyRef.current) throw new Error("Withdrawal submission is already in progress");
    busyRef.current = true;
    setError(null);
    let signature: Hex | null = null;
    try {
      const action = validatePreparedWithdrawal(prepared, preview, context);
      if (!storeOperationId(context, prepared.withdrawalId)) {
        throw new WithdrawalRequestError(null, {
          code: "OPERATION_STORAGE_UNAVAILABLE",
          message: "Secure withdrawal tracking is unavailable in this browser. Enable site storage before signing.",
          retryable: true,
        });
      }
      setPhase("signing");
      await switchChainAsync({ chainId: context.chainId });
      signature = await signTypedDataAsync(actionTypedData(action, context.chainId, context.matching));
      setPhase("submitting");
      activeIdRef.current = prepared.withdrawalId;
      setActiveOperationId(prepared.withdrawalId);
      const next = await submitWithdrawal(prepared.withdrawalId, signature, context.chainId);
      setWithdrawal(next);
      setPhase(phaseForStatus(next.status));
      if (next.error) setError(next.error);
      if (next.status === "confirmed") {
        setPhase("refreshing");
        await refreshFundsQueries(queryClient, context);
        setPhase("done");
        clearOperationId(context);
        activeIdRef.current = null;
        setActiveOperationId(null);
      }
      return next;
    } catch (caught) {
      const body = normalizedError(caught);
      setError(body);
      if (!signature) {
        clearOperationId(context);
        setPhase(body.code.toLowerCase().includes("reject") ? "rejected" : "ready");
      } else {
        setPhase("unknown");
        void reconcile(prepared.withdrawalId);
      }
      throw caught;
    } finally {
      busyRef.current = false;
    }
  }, [address, prepared, preview, queryClient, reconcile, signTypedDataAsync, switchChainAsync]);

  useEffect(() => {
    if (!address) return;
    const storageContext: FrozenWithdrawalContext = {
      owner: address,
      chainId,
      matching: addresses.matching,
      withdrawalModule: addresses.withdrawalModule,
      subaccountId: 0n,
      assetId: "cash",
      protocolAsset: zeroAddress,
      tokenAddress: zeroAddress,
      idempotencyKey: "",
    };
    let id: string | null = null;
    try {
      id = window.localStorage.getItem(operationStorageKey(address, chainId, addresses.matching));
    } catch {}
    if (!id || activeIdRef.current === id) return;
    contextRef.current = storageContext;
    activeIdRef.current = id;
    setActiveOperationId(id);
    setPhase("unknown");
    let cancelled = false;
    void getWithdrawal(id, chainId).then(async (record) => {
      if (cancelled) return;
      if (
        record.chainId !== chainId ||
        !sameAddress(record.owner, address) ||
        !sameAddress(record.matching, addresses.matching)
      ) {
        clearOperationId(storageContext);
        return;
      }
      contextRef.current = {
        ...storageContext,
        subaccountId: BigInt(record.subaccountId),
        assetId: record.asset.assetId,
        protocolAsset: record.asset.assetAddress,
        tokenAddress: record.asset.tokenAddress,
        tokenUnits: BigInt(record.tokenUnits),
      };
      activeIdRef.current = record.id;
      setActiveOperationId(record.id);
      setWithdrawal(record);
      if (record.status === "confirmed") {
        setPhase("refreshing");
        await refreshFundsQueries(queryClient, contextRef.current);
        if (cancelled) return;
        setPhase("done");
      } else if (record.status === "prepared") {
        setPhase("unknown");
        setError({
          code: "PREPARED_OPERATION_RESUMED",
          message: "A saved withdrawal has no resumable wallet signature. Do not create another; its status will be checked until it expires.",
          retryable: true,
        });
      } else {
        setPhase(phaseForStatus(record.status));
      }
      if (record.error) setError(record.error);
      if (["confirmed", "rejected", "reverted", "expired"].includes(record.status)) {
        clearOperationId(contextRef.current);
        activeIdRef.current = null;
        setActiveOperationId(null);
      }
    }).catch(() => {
      if (!cancelled) setPhase("unknown");
    });
    return () => { cancelled = true; };
  }, [address, addresses.matching, addresses.withdrawalModule, chainId, queryClient]);

  useEffect(() => {
    if (!activeOperationId || !["submitting", "confirming", "unknown"].includes(phase)) return;
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      await reconcile(activeOperationId);
      if (!cancelled && activeIdRef.current) timer = window.setTimeout(() => void poll(), 1_500);
    };
    timer = window.setTimeout(() => void poll(), 1_000);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [activeOperationId, phase, reconcile]);

  const isBusy = ["previewing", "preparing", "signing", "submitting", "confirming", "refreshing"].includes(phase);

  return {
    phase,
    preview,
    withdrawal,
    preparedReview: prepared?.review ?? null,
    error,
    isAmountReviewed,
    requestPreview,
    prepare,
    signAndSubmit,
    reconcile,
    reset,
    isBusy,
  };
}
