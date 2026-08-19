// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  subaccountSelectionStorageKey,
  subaccountScopeKey,
  useAccountStore,
  type SubaccountSummary,
} from "./account";

const scope = subaccountScopeKey(
  "0x1111111111111111111111111111111111111111",
  56,
  "0x2222222222222222222222222222222222222222",
);

const accounts: SubaccountSummary[] = [
  { accountId: 42n, cashBalance: 10n, nonZeroBalanceCount: 1 },
  { accountId: 57n, cashBalance: -5n, nonZeroBalanceCount: 2 },
];

describe("scoped subaccount state", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAccountStore.setState({
      scopeKey: null,
      accounts: [],
      selectedAccountId: null,
      rememberedAccountId: null,
      selectionLocked: false,
    });
  });

  it("selects and caches the lowest discovered account when no preference exists", () => {
    expect((useAccountStore as unknown as { persist?: unknown }).persist).toBeUndefined();

    const state = useAccountStore.getState();
    state.setScope(scope);
    state.replaceAccounts(scope, [...accounts].reverse());

    expect(useAccountStore.getState().accounts).toEqual(accounts);
    expect(useAccountStore.getState().selectedAccountId).toBe(42n);
    expect(window.localStorage.getItem(subaccountSelectionStorageKey(scope))).toBe("42");
  });

  it("restores a cached selection only after it appears in the validated directory", () => {
    const state = useAccountStore.getState();
    state.setScope(scope);
    state.replaceAccounts(scope, accounts);
    state.selectAccount(scope, 57n);

    state.setScope(null);
    state.setScope(scope);
    expect(useAccountStore.getState().selectedAccountId).toBeNull();

    state.replaceAccounts(scope, accounts);
    expect(useAccountStore.getState().selectedAccountId).toBe(57n);
  });

  it("replaces a stale cached id with the lowest validated account", () => {
    window.localStorage.setItem(subaccountSelectionStorageKey(scope), "999");

    const state = useAccountStore.getState();
    state.setScope(scope);
    state.replaceAccounts(scope, accounts);

    expect(useAccountStore.getState().selectedAccountId).toBe(42n);
    expect(window.localStorage.getItem(subaccountSelectionStorageKey(scope))).toBe("42");
  });

  it("isolates remembered selections by wallet, chain, and Matching deployment", () => {
    const otherScope = subaccountScopeKey(
      "0x3333333333333333333333333333333333333333",
      97,
      "0x4444444444444444444444444444444444444444",
    );
    const state = useAccountStore.getState();
    state.setScope(scope);
    state.replaceAccounts(scope, accounts);
    state.selectAccount(scope, 57n);

    state.setScope(otherScope);
    state.replaceAccounts(otherScope, [
      { accountId: 81n, cashBalance: 0n, nonZeroBalanceCount: 0 },
    ]);

    expect(useAccountStore.getState().selectedAccountId).toBe(81n);
    expect(window.localStorage.getItem(subaccountSelectionStorageKey(scope))).toBe("57");
    expect(window.localStorage.getItem(subaccountSelectionStorageKey(otherScope))).toBe("81");
  });

  it("keeps an explicit selection only while wallet, chain, and Matching scope are unchanged", () => {
    const state = useAccountStore.getState();
    state.setScope(scope);
    state.replaceAccounts(scope, accounts);
    state.selectAccount(scope, 57n);
    expect(useAccountStore.getState().selectedAccountId).toBe(57n);
    expect(window.localStorage.getItem(subaccountSelectionStorageKey(scope))).toBe("57");

    state.setScope(
      subaccountScopeKey(
        "0x3333333333333333333333333333333333333333",
        56,
        "0x2222222222222222222222222222222222222222",
      ),
    );
    expect(useAccountStore.getState()).toMatchObject({
      accounts: [],
      selectedAccountId: null,
    });
  });

  it("inserts and selects a newly created, validated account immediately", () => {
    const created = { accountId: 81n, cashBalance: 0n, nonZeroBalanceCount: 0 };
    const state = useAccountStore.getState();
    state.setScope(scope);
    state.replaceAccounts(scope, accounts);
    state.upsertAccount(scope, created, true);

    expect(useAccountStore.getState().accounts.map((account) => account.accountId)).toEqual([
      42n,
      57n,
      81n,
    ]);
    expect(useAccountStore.getState().selectedAccountId).toBe(81n);
    expect(window.localStorage.getItem(subaccountSelectionStorageKey(scope))).toBe("81");
  });

  it("blocks selection changes while a trade owns the account context", () => {
    const state = useAccountStore.getState();
    state.setScope(scope);
    state.replaceAccounts(scope, accounts);
    state.selectAccount(scope, 42n);
    state.setSelectionLocked(true);

    state.selectAccount(scope, 57n);
    expect(useAccountStore.getState().selectedAccountId).toBe(42n);

    state.setSelectionLocked(false);
    state.selectAccount(scope, 57n);
    expect(useAccountStore.getState().selectedAccountId).toBe(57n);
  });
});
