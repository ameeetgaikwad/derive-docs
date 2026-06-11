import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Per-EOA protocol account state, persisted to localStorage.
 *
 * The protocol has no account-discovery API in v1 (Matching only exposes
 * subaccountId -> owner), so the frontend remembers the subaccount it created
 * for each address. Stored ids are re-verified on-chain
 * (Matching.subAccountToOwner) before use.
 */
interface AccountState {
  /** lowercased EOA address -> subaccount id (decimal string) */
  subaccountByAddress: Record<string, string>;
  setSubaccount: (address: string, subaccountId: bigint) => void;
  clearSubaccount: (address: string) => void;
  getSubaccount: (address: string | undefined) => bigint | null;
}

export const useAccountStore = create<AccountState>()(
  persist(
    (set, get) => ({
      subaccountByAddress: {},

      setSubaccount: (address, subaccountId) =>
        set((state) => ({
          subaccountByAddress: {
            ...state.subaccountByAddress,
            [address.toLowerCase()]: subaccountId.toString(),
          },
        })),

      clearSubaccount: (address) =>
        set((state) => {
          const next = { ...state.subaccountByAddress };
          delete next[address.toLowerCase()];
          return { subaccountByAddress: next };
        }),

      getSubaccount: (address) => {
        if (!address) return null;
        const id = get().subaccountByAddress[address.toLowerCase()];
        return id ? BigInt(id) : null;
      },
    }),
    { name: "sats-options.subaccounts" }
  )
);
