"use client";

import { useCallback, useEffect } from "react";
import { decodeEventLog } from "viem";
import { useAccount, useConfig, useReadContract, useSwitchChain } from "wagmi";
import {
  readContract,
  waitForTransactionReceipt,
  writeContract,
} from "wagmi/actions";
import { matchingAbi, subAccountsAbi, mockErc20Abi, wrappedErc20AssetAbi } from "@/lib/protocol/abis";
import { useAccountStore } from "@/stores/account";
import { useNetwork } from "./useNetwork";

/**
 * The user's covered-call subaccount under Matching (SRM-managed).
 *
 * Onboarding is a single regular tx: Matching.createSubAccount(StandardManager).
 * The new subaccount id is read from the SubAccounts.AccountCreated event in
 * the receipt and persisted to localStorage per EOA and chain (re-verified on-chain via
 * Matching.subAccountToOwner on every load).
 */
export function useCoveredCallSubaccount() {
  const { address } = useAccount();
  const config = useConfig();
  const { switchChainAsync } = useSwitchChain();
  const { getSubaccount, setSubaccount, clearSubaccount } = useAccountStore();
  const { addresses, chainId } = useNetwork();

  const stored = getSubaccount(address, chainId);
  const storedId = stored?.id ?? null;

  // Guard against stale/foreign localStorage: the stored subaccount must be
  // owned (via Matching) by the connected EOA.
  const ownerQuery = useReadContract({
    abi: matchingAbi,
    address: addresses.matching,
    functionName: "subAccountToOwner",
    args: storedId !== null ? [storedId] : undefined,
    chainId,
    query: { enabled: storedId !== null && !!address },
  });

  const verified =
    storedId !== null &&
    !!address &&
    ownerQuery.data?.toLowerCase() === address.toLowerCase();

  // A chain-specific id that does not belong to this wallet is stale. A legacy
  // id is deliberately preserved on mismatch because it may belong to the same
  // wallet on the other chain.
  const mismatch =
    storedId !== null &&
    !!address &&
    !!ownerQuery.data &&
    ownerQuery.data.toLowerCase() !== address.toLowerCase();

  useEffect(() => {
    if (mismatch && address && stored?.source === "network") {
      clearSubaccount(address, chainId);
    }
  }, [mismatch, address, chainId, clearSubaccount, stored?.source]);

  // Safely promote the old unscoped key after this chain has proven ownership.
  // Keep the legacy entry so the other chain can independently probe it too.
  useEffect(() => {
    if (verified && address && stored?.source === "legacy" && storedId !== null) {
      setSubaccount(address, chainId, storedId);
    }
  }, [verified, address, chainId, setSubaccount, stored?.source, storedId]);

  const ensureChain = useCallback(async () => {
    await switchChainAsync({ chainId }).catch(() => {
      // ignore "already on chain" / user-handled cases; writes will re-check
    });
  }, [switchChainAsync, chainId]);

  /** Returns the existing subaccount id or creates one (1 wallet tx). */
  const ensureSubaccount = useCallback(async (): Promise<bigint> => {
    if (!address) throw new Error("Wallet not connected");
    if (verified && storedId !== null) return storedId;

    await ensureChain();
    const hash = await writeContract(config, {
      abi: matchingAbi,
      address: addresses.matching,
      functionName: "createSubAccount",
      args: [addresses.standardManager],
      chainId,
    });
    const receipt = await waitForTransactionReceipt(config, {
      hash,
      chainId,
    });

    // SubAccounts emits AccountCreated(owner=Matching, accountId, manager).
    let accountId: bigint | null = null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== addresses.subAccounts.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: subAccountsAbi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "AccountCreated") {
          accountId = decoded.args.accountId;
          break;
        }
      } catch {
        // not an AccountCreated log
      }
    }
    if (accountId === null) {
      throw new Error("Subaccount created but id not found in receipt logs");
    }

    setSubaccount(address, chainId, accountId);
    return accountId;
  }, [address, verified, storedId, ensureChain, config, setSubaccount, addresses, chainId]);

  /** Adopt an existing subaccount id (e.g. created via scripts) after verifying ownership. */
  const adoptSubaccount = useCallback(
    async (id: bigint): Promise<void> => {
      if (!address) throw new Error("Wallet not connected");
      const owner = await readContract(config, {
        abi: matchingAbi,
        address: addresses.matching,
        functionName: "subAccountToOwner",
        args: [id],
        chainId,
      });
      if (owner.toLowerCase() !== address.toLowerCase()) {
        throw new Error(`Subaccount ${id} is not owned by ${address}`);
      }
      setSubaccount(address, chainId, id);
    },
    [address, config, setSubaccount, addresses, chainId]
  );

  return {
    /** verified subaccount id, or null when none is known for this wallet */
    subaccountId: verified && storedId !== null ? storedId : null,
    isVerifying: storedId !== null && ownerQuery.isLoading,
    ensureSubaccount,
    adoptSubaccount,
  };
}

/**
 * Deposit BTCB collateral into a subaccount:
 * BTCB.approve(btcBaseAsset) (skipped if allowance suffices) then
 * WrappedERC20Asset.deposit(subaccountId, amount) — one regular tx each.
 * Deposits into Matching-held subaccounts are permissionless by design.
 */
export function useDepositBtcb() {
  const { address } = useAccount();
  const config = useConfig();
  const { switchChainAsync } = useSwitchChain();
  const { addresses, chainId } = useNetwork();

  return useCallback(
    async (subaccountId: bigint, amount: bigint): Promise<void> => {
      if (!address) throw new Error("Wallet not connected");
      await switchChainAsync({ chainId }).catch(() => {});

      const allowance = await readContract(config, {
        abi: mockErc20Abi,
        address: addresses.btcb,
        functionName: "allowance",
        args: [address, addresses.btcBaseAsset],
        chainId,
      });

      if (allowance < amount) {
        const approveHash = await writeContract(config, {
          abi: mockErc20Abi,
          address: addresses.btcb,
          functionName: "approve",
          args: [addresses.btcBaseAsset, amount],
          chainId,
        });
        await waitForTransactionReceipt(config, {
          hash: approveHash,
          chainId,
        });
      }

      const depositHash = await writeContract(config, {
        abi: wrappedErc20AssetAbi,
        address: addresses.btcBaseAsset,
        functionName: "deposit",
        args: [subaccountId, amount],
        chainId,
      });
      const receipt = await waitForTransactionReceipt(config, {
        hash: depositHash,
        chainId,
      });
      if (receipt.status !== "success") {
        throw new Error(`BTCB deposit reverted (tx ${depositHash})`);
      }
    },
    [address, config, switchChainAsync, addresses, chainId]
  );
}
