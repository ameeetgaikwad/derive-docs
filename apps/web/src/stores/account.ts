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
  rememberedAccountId: bigint | null;
  selectionLocked: boolean;
  setScope: (scopeKey: string | null) => void;
  replaceAccounts: (scopeKey: string, accounts: SubaccountSummary[]) => void;
  selectAccount: (scopeKey: string, accountId: bigint | null) => void;
  setSelectionLocked: (selectionLocked: boolean) => void;
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

const SUBACCOUNT_SELECTION_STORAGE_PREFIX = "hedge.subaccount-selection";

export function subaccountSelectionStorageKey(scopeKey: string): string {
  return `${SUBACCOUNT_SELECTION_STORAGE_PREFIX}:${scopeKey}`;
}

/** Read a scoped preference without treating it as validated active state. */
export function readRememberedSubaccountId(scopeKey: string): bigint | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(subaccountSelectionStorageKey(scopeKey));
    return raw !== null && /^\d+$/.test(raw) ? BigInt(raw) : null;
  } catch {
    return null;
  }
}

function writeRememberedSubaccountId(
  scopeKey: string,
  accountId: bigint | null,
): void {
  if (typeof window === "undefined") return;
  try {
    const key = subaccountSelectionStorageKey(scopeKey);
    if (accountId === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, accountId.toString());
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }
}

function sortedAccounts(accounts: SubaccountSummary[]): SubaccountSummary[] {
  const byId = new Map(accounts.map((account) => [account.accountId, account]));
  return [...byId.values()].sort((left, right) =>
    left.accountId < right.accountId ? -1 : left.accountId > right.accountId ? 1 : 0,
  );
}

function resolveSelectedAccountId(
  accounts: SubaccountSummary[],
  selectedAccountId: bigint | null,
  rememberedAccountId: bigint | null,
): bigint | null {
  if (accounts.some((account) => account.accountId === selectedAccountId)) {
    return selectedAccountId;
  }
  if (accounts.some((account) => account.accountId === rememberedAccountId)) {
    return rememberedAccountId;
  }
  return accounts[0]?.accountId ?? null;
}

/** Session directory with a scope-safe, validation-gated remembered selection. */
export const useAccountStore = create<AccountState>()((set) => ({
  scopeKey: null,
  accounts: [],
  selectedAccountId: null,
  rememberedAccountId: null,
  selectionLocked: false,

  setScope: (scopeKey) =>
    set((state) =>
      state.scopeKey === scopeKey
        ? state
        : {
            scopeKey,
            accounts: [],
            selectedAccountId: null,
            rememberedAccountId: scopeKey
              ? readRememberedSubaccountId(scopeKey)
              : null,
          },
    ),

  replaceAccounts: (scopeKey, accounts) =>
    set((state) => {
      if (state.scopeKey !== scopeKey) return state;
      const next = sortedAccounts(accounts);
      const selectedAccountId = resolveSelectedAccountId(
        next,
        state.selectedAccountId,
        state.rememberedAccountId,
      );
      writeRememberedSubaccountId(scopeKey, selectedAccountId);
      return {
        accounts: next,
        selectedAccountId,
        rememberedAccountId: selectedAccountId,
      };
    }),

  selectAccount: (scopeKey, accountId) =>
    set((state) => {
      if (state.scopeKey !== scopeKey || state.selectionLocked) return state;
      if (
        accountId !== null &&
        !state.accounts.some((account) => account.accountId === accountId)
      ) {
        return state;
      }
      writeRememberedSubaccountId(scopeKey, accountId);
      return {
        selectedAccountId: accountId,
        rememberedAccountId: accountId,
      };
    }),

  setSelectionLocked: (selectionLocked) => set({ selectionLocked }),

  upsertAccount: (scopeKey, account, select) =>
    set((state) => {
      if (state.scopeKey !== scopeKey) return state;
      const accounts = sortedAccounts([
        ...state.accounts.filter((existing) => existing.accountId !== account.accountId),
        account,
      ]);
      const selectedAccountId = select
        ? account.accountId
        : resolveSelectedAccountId(
            accounts,
            state.selectedAccountId,
            state.rememberedAccountId,
          );
      writeRememberedSubaccountId(scopeKey, selectedAccountId);
      return {
        accounts,
        selectedAccountId,
        rememberedAccountId: selectedAccountId,
      };
    }),
}));
