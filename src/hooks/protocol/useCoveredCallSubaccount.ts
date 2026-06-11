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
import { ADDRESSES, CHAIN_ID } from "@/lib/protocol/deployments";
import { useAccountStore } from "@/stores/account";

/**
 * The user's covered-call subaccount under Matching (SRM-managed).
 *
 * Onboarding is a single regular tx: Matching.createSubAccount(StandardManager).
 * The new subaccount id is read from the SubAccounts.AccountCreated event in
 * the receipt and persisted to localStorage per EOA (re-verified on-chain via
 * Matching.subAccountToOwner on every load).
 */
export function useCoveredCallSubaccount() {
  const { address } = useAccount();
  const config = useConfig();
  const { switchChainAsync } = useSwitchChain();
  const { getSubaccount, setSubaccount, clearSubaccount } = useAccountStore();

  const storedId = getSubaccount(address);

  // Guard against stale/foreign localStorage: the stored subaccount must be
  // owned (via Matching) by the connected EOA.
  const ownerQuery = useReadContract({
    abi: matchingAbi,
    address: ADDRESSES.matching,
    functionName: "subAccountToOwner",
    args: storedId !== null ? [storedId] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: storedId !== null && !!address },
  });

  const verified =
    storedId !== null &&
    !!address &&
    ownerQuery.data?.toLowerCase() === address.toLowerCase();

  // Stored id does not belong to this wallet (cleared cache, imported
  // localStorage, ...) — drop it.
  const mismatch =
    storedId !== null &&
    !!address &&
    !!ownerQuery.data &&
    ownerQuery.data.toLowerCase() !== address.toLowerCase();

  useEffect(() => {
    if (mismatch && address) clearSubaccount(address);
  }, [mismatch, address, clearSubaccount]);

  const ensureChain = useCallback(async () => {
    await switchChainAsync({ chainId: CHAIN_ID }).catch(() => {
      // ignore "already on chain" / user-handled cases; writes will re-check
    });
  }, [switchChainAsync]);

  /** Returns the existing subaccount id or creates one (1 wallet tx). */
  const ensureSubaccount = useCallback(async (): Promise<bigint> => {
    if (!address) throw new Error("Wallet not connected");
    if (verified && storedId !== null) return storedId;

    await ensureChain();
    const hash = await writeContract(config, {
      abi: matchingAbi,
      address: ADDRESSES.matching,
      functionName: "createSubAccount",
      args: [ADDRESSES.standardManager],
      chainId: CHAIN_ID,
    });
    const receipt = await waitForTransactionReceipt(config, {
      hash,
      chainId: CHAIN_ID,
    });

    // SubAccounts emits AccountCreated(owner=Matching, accountId, manager).
    let accountId: bigint | null = null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== ADDRESSES.subAccounts.toLowerCase()) continue;
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

    setSubaccount(address, accountId);
    return accountId;
  }, [address, verified, storedId, ensureChain, config, setSubaccount]);

  /** Adopt an existing subaccount id (e.g. created via scripts) after verifying ownership. */
  const adoptSubaccount = useCallback(
    async (id: bigint): Promise<void> => {
      if (!address) throw new Error("Wallet not connected");
      const owner = await readContract(config, {
        abi: matchingAbi,
        address: ADDRESSES.matching,
        functionName: "subAccountToOwner",
        args: [id],
        chainId: CHAIN_ID,
      });
      if (owner.toLowerCase() !== address.toLowerCase()) {
        throw new Error(`Subaccount ${id} is not owned by ${address}`);
      }
      setSubaccount(address, id);
    },
    [address, config, setSubaccount]
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

  return useCallback(
    async (subaccountId: bigint, amount: bigint): Promise<void> => {
      if (!address) throw new Error("Wallet not connected");
      await switchChainAsync({ chainId: CHAIN_ID }).catch(() => {});

      const allowance = await readContract(config, {
        abi: mockErc20Abi,
        address: ADDRESSES.btcb,
        functionName: "allowance",
        args: [address, ADDRESSES.btcBaseAsset],
        chainId: CHAIN_ID,
      });

      if (allowance < amount) {
        const approveHash = await writeContract(config, {
          abi: mockErc20Abi,
          address: ADDRESSES.btcb,
          functionName: "approve",
          args: [ADDRESSES.btcBaseAsset, amount],
          chainId: CHAIN_ID,
        });
        await waitForTransactionReceipt(config, {
          hash: approveHash,
          chainId: CHAIN_ID,
        });
      }

      const depositHash = await writeContract(config, {
        abi: wrappedErc20AssetAbi,
        address: ADDRESSES.btcBaseAsset,
        functionName: "deposit",
        args: [subaccountId, amount],
        chainId: CHAIN_ID,
      });
      const receipt = await waitForTransactionReceipt(config, {
        hash: depositHash,
        chainId: CHAIN_ID,
      });
      if (receipt.status !== "success") {
        throw new Error(`BTCB deposit reverted (tx ${depositHash})`);
      }
    },
    [address, config, switchChainAsync]
  );
}
