"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isAddress, type Address, type Hex } from "viem";
import { useAccount, useConfig, useReadContract, useSwitchChain } from "wagmi";
import { readContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { cashAssetAbi, mockErc20Abi } from "@/lib/protocol/abis";
import type { AppChainId } from "@/stores/network";
import { useNetwork } from "./useNetwork";
import { refreshFundsQueries } from "./queryRefresh";

export type RepayPhase =
  | "idle"
  | "approving"
  | "repaying"
  | "confirming"
  | "done"
  | "unknown"
  | "error";

interface PendingRepayment {
  intentId: string;
  createdAt: number;
  owner: Address;
  chainId: AppChainId;
  cashAsset: Address;
  matching: Address;
  subaccountId: string;
  tokenUnits: string;
  txHash: Hex | null;
  receiptConfirmed: boolean;
}

const REPAYMENT_STORAGE_EVENT = "hedge:repayment-operation-changed";
const STORAGE_UNAVAILABLE = "__hedge_repayment_storage_unavailable__";

function repaymentStorageKey(owner: Address, chainId: number, cashAsset: Address): string {
  return `hedge.repayment-operation:${chainId}:${cashAsset.toLowerCase()}:${owner.toLowerCase()}`;
}

function parsePendingRepayment(raw: string | null): PendingRepayment | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingRepayment>;
    if (
      typeof value.owner !== "string" ||
      typeof value.intentId !== "string" ||
      typeof value.createdAt !== "number" ||
      typeof value.chainId !== "number" ||
      typeof value.cashAsset !== "string" ||
      typeof value.matching !== "string" ||
      typeof value.subaccountId !== "string" ||
      typeof value.tokenUnits !== "string" ||
      typeof value.receiptConfirmed !== "boolean" ||
      (value.txHash !== null && typeof value.txHash !== "string") ||
      !isAddress(value.owner) ||
      !isAddress(value.cashAsset) ||
      !isAddress(value.matching) ||
      !/^\d+$/.test(value.subaccountId) ||
      !/^\d+$/.test(value.tokenUnits) ||
      (value.txHash !== null && !/^0x[0-9a-fA-F]{64}$/.test(value.txHash))
    ) return null;
    return value as PendingRepayment;
  } catch {
    return null;
  }
}

function freshRepaymentIntentId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Secure randomness is unavailable; cannot create a repayment intent");
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isUserRejected(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current && typeof current === "object"; depth++) {
    const candidate = current as { name?: unknown; code?: unknown; cause?: unknown };
    if (candidate.name === "UserRejectedRequestError" || candidate.code === 4001) return true;
    current = candidate.cause;
  }
  return false;
}

function notifyRepaymentStorage(): void {
  window.dispatchEvent(new Event(REPAYMENT_STORAGE_EVENT));
}

function storePendingRepayment(key: string, repayment: PendingRepayment): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(repayment));
    notifyRepaymentStorage();
    return true;
  } catch {
    return false;
  }
}

function clearPendingRepayment(key: string): boolean {
  try {
    window.localStorage.removeItem(key);
    notifyRepaymentStorage();
    return true;
  } catch {
    return false;
  }
}

/** Ceil an 18dp cash debt to the smallest native-token amount that covers it. */
export function cashDebtToTokenUnits(debt18: bigint, tokenDecimals: number): bigint {
  if (debt18 <= 0n) return 0n;
  if (tokenDecimals === 18) return debt18;
  if (tokenDecimals > 18) return debt18 * 10n ** BigInt(tokenDecimals - 18);
  const divisor = 10n ** BigInt(18 - tokenDecimals);
  return (debt18 + divisor - 1n) / divisor;
}

/** 1bp buffer covers interest drift; any excess is ordinary positive account cash. */
export function bufferedRepayTokenUnits(debt18: bigint, tokenDecimals: number): bigint {
  if (debt18 <= 0n) return 0n;
  const bufferedDebt18 = (debt18 * 10_001n + 9_999n) / 10_000n;
  return cashDebtToTokenUnits(bufferedDebt18, tokenDecimals);
}

export function useRepayCash() {
  const { address } = useAccount();
  const config = useConfig();
  const { switchChainAsync } = useSwitchChain();
  const queryClient = useQueryClient();
  const { addresses, chainId } = useNetwork();
  const [phase, setPhase] = useState<RepayPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [memoryPending, setMemoryPending] = useState<PendingRepayment | null>(null);
  const storageKey = address
    ? repaymentStorageKey(address, chainId, addresses.cashAsset)
    : null;
  const subscribeToStoredRepayment = useCallback((onStoreChange: () => void) => {
    if (!storageKey) return () => undefined;
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey) onStoreChange();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(REPAYMENT_STORAGE_EVENT, onStoreChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(REPAYMENT_STORAGE_EVENT, onStoreChange);
    };
  }, [storageKey]);
  const readStoredRepayment = useCallback(
    () => {
      if (!storageKey) return null;
      try {
        return window.localStorage.getItem(storageKey);
      } catch {
        return STORAGE_UNAVAILABLE;
      }
    },
    [storageKey],
  );
  const storedRepaymentRaw = useSyncExternalStore(
    subscribeToStoredRepayment,
    readStoredRepayment,
    () => null,
  );
  const storedPending = useMemo(() => {
    const operation = storedRepaymentRaw === STORAGE_UNAVAILABLE
      ? null
      : parsePendingRepayment(storedRepaymentRaw);
    if (
      !operation ||
      !storageKey ||
      repaymentStorageKey(operation.owner, operation.chainId, operation.cashAsset) !== storageKey ||
      operation.matching.toLowerCase() !== addresses.matching.toLowerCase()
    ) return null;
    return operation;
  }, [addresses.matching, storageKey, storedRepaymentRaw]);
  const storageAvailable = storedRepaymentRaw !== STORAGE_UNAVAILABLE;
  const pending = memoryPending && storageKey === repaymentStorageKey(
    memoryPending.owner,
    memoryPending.chainId,
    memoryPending.cashAsset,
  ) && memoryPending.matching.toLowerCase() === addresses.matching.toLowerCase()
    ? memoryPending
    : storedPending;

  const walletBalanceQuery = useReadContract({
    abi: mockErc20Abi,
    address: addresses.usdt,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });
  const decimalsQuery = useReadContract({
    abi: mockErc20Abi,
    address: addresses.usdt,
    functionName: "decimals",
    chainId,
    query: { staleTime: 5 * 60_000 },
  });

  const reset = useCallback(() => {
    setPhase(pending ? "unknown" : "idle");
    setError(null);
    setTxHash(pending?.txHash ?? null);
  }, [pending]);

  const confirmRepayment = useCallback(async (operation: PendingRepayment) => {
    const operationKey = repaymentStorageKey(operation.owner, operation.chainId, operation.cashAsset);
    if (!operation.txHash) {
      setPhase("unknown");
      setError("Wallet submission outcome is unknown. Verify your wallet activity and account debt before allowing another repayment.");
      return null;
    }
    const hash = operation.txHash;
    setTxHash(hash);
    setPhase("confirming");
    setError(null);
    let confirmed = operation;
    if (!operation.receiptConfirmed) {
      let receipt;
      try {
        receipt = await waitForTransactionReceipt(config, {
          hash,
          chainId: operation.chainId,
        });
      } catch {
        setPhase("unknown");
        setError(`Repayment was broadcast, but confirmation is unavailable. Do not repay again; check transaction ${hash}.`);
        return hash;
      }
      if (receipt.status !== "success") {
        clearPendingRepayment(operationKey);
        setMemoryPending(null);
        const reverted = new Error(`USDT repayment reverted (tx ${hash})`);
        setError(reverted.message);
        setPhase("error");
        throw reverted;
      }
      confirmed = { ...operation, receiptConfirmed: true };
      setMemoryPending(confirmed);
      // Keep at least the previous pending record if this update fails. Either
      // form blocks another repayment after reload; the mounted hook retains
      // the confirmed state and can still retry the authoritative refresh.
      storePendingRepayment(operationKey, confirmed);
    }

    try {
      await refreshFundsQueries(queryClient, confirmed);
      await walletBalanceQuery.refetch();
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : String(caught);
      setMemoryPending(confirmed);
      storePendingRepayment(operationKey, confirmed);
      setError(`Repayment confirmed, but balances could not be refreshed: ${detail}`);
      setPhase("unknown");
      return hash;
    }
    if (!clearPendingRepayment(operationKey)) {
      setMemoryPending(confirmed);
      setError("Repayment and balances are confirmed, but the browser safety lock could not be cleared. Check status again after restoring browser storage.");
      setPhase("unknown");
      return hash;
    }
    setMemoryPending(null);
    setError(null);
    setPhase("done");
    return hash;
  }, [config, queryClient, walletBalanceQuery]);

  const reconcile = useCallback(async () => {
    if (!pending) return null;
    return confirmRepayment(pending);
  }, [confirmRepayment, pending]);

  const acknowledgeNoTransaction = useCallback(() => {
    if (!pending || pending.txHash) return;
    if (!clearPendingRepayment(repaymentStorageKey(pending.owner, pending.chainId, pending.cashAsset))) {
      setError("The browser safety lock could not be cleared. Restore browser storage, then verify the repayment again.");
      setPhase("unknown");
      return;
    }
    setMemoryPending(null);
    setTxHash(null);
    setError(null);
    setPhase("idle");
  }, [pending]);

  const repay = useCallback(async (subaccountId: bigint, tokenUnits: bigint) => {
    if (!address) throw new Error("Wallet not connected");
    if (pending) {
      throw new Error(`Repayment ${pending.txHash} is still unresolved; check its status before trying again`);
    }
    if (tokenUnits <= 0n) throw new Error("Repayment amount must be greater than zero");
    if (walletBalanceQuery.data !== undefined && tokenUnits > walletBalanceQuery.data) {
      throw new Error("Repayment amount exceeds your wallet USDT balance");
    }
    if (!storageKey || !storageAvailable) {
      const unavailable = new Error("Durable browser storage is unavailable; repayment is disabled to prevent an unrecoverable duplicate submission");
      setError(unavailable.message);
      setPhase("error");
      throw unavailable;
    }
    setError(null);
    setTxHash(null);
    try {
      await switchChainAsync({ chainId });
      const allowance = await readContract(config, {
        abi: mockErc20Abi,
        address: addresses.usdt,
        functionName: "allowance",
        args: [address, addresses.cashAsset],
        chainId,
      });
      if (allowance < tokenUnits) {
        setPhase("approving");
        const approvalHash = await writeContract(config, {
          abi: mockErc20Abi,
          address: addresses.usdt,
          functionName: "approve",
          args: [addresses.cashAsset, tokenUnits],
          chainId,
        });
        const approvalReceipt = await waitForTransactionReceipt(config, { hash: approvalHash, chainId });
        if (approvalReceipt.status !== "success") {
          throw new Error(`USDT approval reverted (tx ${approvalHash})`);
        }
      }

      setPhase("repaying");
      const intent: PendingRepayment = {
        intentId: freshRepaymentIntentId(),
        createdAt: Date.now(),
        owner: address,
        chainId,
        cashAsset: addresses.cashAsset,
        matching: addresses.matching,
        subaccountId: subaccountId.toString(),
        tokenUnits: tokenUnits.toString(),
        txHash: null,
        receiptConfirmed: false,
      };
      if (!storePendingRepayment(storageKey, intent)) {
        throw new Error("Could not persist the repayment safety record; no repayment was submitted");
      }
      setMemoryPending(intent);
      let depositHash: Hex;
      try {
        depositHash = await writeContract(config, {
          abi: cashAssetAbi,
          address: addresses.cashAsset,
          functionName: "deposit",
          args: [subaccountId, tokenUnits],
          chainId,
        });
      } catch (caught) {
        if (isUserRejected(caught)) {
          if (clearPendingRepayment(storageKey)) {
            setMemoryPending(null);
            throw caught;
          }
          setPhase("unknown");
          setError("The wallet rejected repayment, but its browser safety record could not be cleared. Restore browser storage before trying again.");
          return null;
        }
        setPhase("unknown");
        setError("Your wallet did not return a repayment transaction hash. The transaction may still have been broadcast; verify wallet activity and account debt before trying again.");
        return null;
      }
      const operation = { ...intent, txHash: depositHash };
      setMemoryPending(operation);
      storePendingRepayment(storageKey, operation);
      setTxHash(depositHash);
      return await confirmRepayment(operation);
    } catch (caught) {
      if (memoryPending || storedPending) throw caught;
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      setPhase("error");
      throw caught;
    }
  }, [
    address,
    addresses.cashAsset,
    addresses.matching,
    addresses.usdt,
    chainId,
    confirmRepayment,
    config,
    memoryPending,
    pending,
    storageKey,
    storageAvailable,
    storedPending,
    switchChainAsync,
    walletBalanceQuery,
  ]);

  const effectivePhase = pending && phase === "idle" ? "unknown" : phase;

  return {
    phase: effectivePhase,
    error,
    txHash: txHash ?? pending?.txHash ?? null,
    repay,
    reconcile,
    acknowledgeNoTransaction,
    confirmedAwaitingRefresh: pending?.receiptConfirmed ?? false,
    reset,
    walletBalance: walletBalanceQuery.data ?? 0n,
    tokenDecimals: decimalsQuery.data ?? null,
    isLoading: walletBalanceQuery.isLoading || decimalsQuery.isLoading,
  };
}
