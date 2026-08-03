import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AppChainId } from "./network";

/**
 * Per-EOA protocol account state, persisted to localStorage.
 *
 * The protocol has no account-discovery API in v1 (Matching only exposes
 * subaccountId -> owner), so the frontend remembers the subaccount it created
 * for each address and chain. Stored ids are re-verified on-chain
 * (Matching.subAccountToOwner) before use.
 */
interface AccountState {
  /** `<chainId>:<lowercased EOA>` -> subaccount id (decimal string). */
  subaccountByAddress: Record<string, string>;
  setSubaccount: (address: string, chainId: AppChainId, subaccountId: bigint) => void;
  clearSubaccount: (address: string, chainId: AppChainId) => void;
  getSubaccount: (
    address: string | undefined,
    chainId: AppChainId,
  ) => { id: bigint; source: "network" | "legacy" } | null;
}

function accountKey(address: string, chainId: AppChainId): string {
  return `${chainId}:${address.toLowerCase()}`;
}

export function resolveStoredSubaccount(
  records: Record<string, string>,
  address: string | undefined,
  chainId: AppChainId,
): { id: bigint; source: "network" | "legacy" } | null {
  if (!address) return null;
  const networkId = records[accountKey(address, chainId)];
  if (networkId) return { id: BigInt(networkId), source: "network" };

  const legacyId = records[address.toLowerCase()];
  return legacyId ? { id: BigInt(legacyId), source: "legacy" } : null;
}

export const useAccountStore = create<AccountState>()(
  persist(
    (set, get) => ({
      subaccountByAddress: {},

      setSubaccount: (address, chainId, subaccountId) =>
        set((state) => ({
          subaccountByAddress: {
            ...state.subaccountByAddress,
            [accountKey(address, chainId)]: subaccountId.toString(),
          },
        })),

      clearSubaccount: (address, chainId) =>
        set((state) => {
          const next = { ...state.subaccountByAddress };
          delete next[accountKey(address, chainId)];
          return { subaccountByAddress: next };
        }),

      getSubaccount: (address, chainId) => {
        const records = get().subaccountByAddress;
        // The old store key did not record a chain even though the app exposed
        // both networks. Probe it on whichever chain is active; the hook copies
        // it to a chain-specific key only after ownership verifies on-chain.
        return resolveStoredSubaccount(records, address, chainId);
      },
    }),
    { name: "hedge.subaccounts" }
  )
);
