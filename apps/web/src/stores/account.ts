import { create } from "zustand";
import type { AppChainId } from "./network";

export interface SubaccountSummary {
  accountId: bigint;
  cashBalance: bigint;
  nonZeroBalanceCount: number;
}

interface AccountState {
  scopeKey: string | null;
  accounts: SubaccountSummary[];
  selectedAccountId: bigint | null;
  setScope: (scopeKey: string | null) => void;
  replaceAccounts: (scopeKey: string, accounts: SubaccountSummary[]) => void;
  selectAccount: (scopeKey: string, accountId: bigint | null) => void;
  upsertAccount: (
    scopeKey: string,
    account: SubaccountSummary,
    select: boolean,
  ) => void;
}

export function subaccountScopeKey(
  address: string,
  chainId: AppChainId,
  matching: string,
): string {
  return `${chainId}:${matching.toLowerCase()}:${address.toLowerCase()}`;
}

function sortedAccounts(accounts: SubaccountSummary[]): SubaccountSummary[] {
  const byId = new Map(accounts.map((account) => [account.accountId, account]));
  return [...byId.values()].sort((left, right) =>
    left.accountId < right.accountId ? -1 : left.accountId > right.accountId ? 1 : 0,
  );
}

/** Session-only account directory and explicit selection. */
export const useAccountStore = create<AccountState>()((set) => ({
  scopeKey: null,
  accounts: [],
  selectedAccountId: null,

  setScope: (scopeKey) =>
    set((state) =>
      state.scopeKey === scopeKey
        ? state
        : { scopeKey, accounts: [], selectedAccountId: null },
    ),

  replaceAccounts: (scopeKey, accounts) =>
    set((state) => {
      if (state.scopeKey !== scopeKey) return state;
      const next = sortedAccounts(accounts);
      const selectedAccountId = next.some(
        (account) => account.accountId === state.selectedAccountId,
      )
        ? state.selectedAccountId
        : null;
      return { accounts: next, selectedAccountId };
    }),

  selectAccount: (scopeKey, accountId) =>
    set((state) => {
      if (state.scopeKey !== scopeKey) return state;
      if (
        accountId !== null &&
        !state.accounts.some((account) => account.accountId === accountId)
      ) {
        return state;
      }
      return { selectedAccountId: accountId };
    }),

  upsertAccount: (scopeKey, account, select) =>
    set((state) => {
      if (state.scopeKey !== scopeKey) return state;
      const accounts = sortedAccounts([
        ...state.accounts.filter((existing) => existing.accountId !== account.accountId),
        account,
      ]);
      return {
        accounts,
        selectedAccountId: select ? account.accountId : state.selectedAccountId,
      };
    }),
}));
