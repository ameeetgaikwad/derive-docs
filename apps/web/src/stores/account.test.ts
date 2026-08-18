import { beforeEach, describe, expect, it } from "vitest";
import {
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

describe("session subaccount state", () => {
  beforeEach(() => useAccountStore.getState().setScope(null));

  it("does not install persistence middleware or auto-select a discovered account", () => {
    expect((useAccountStore as unknown as { persist?: unknown }).persist).toBeUndefined();

    const state = useAccountStore.getState();
    state.setScope(scope);
    state.replaceAccounts(scope, accounts);

    expect(useAccountStore.getState().accounts).toEqual(accounts);
    expect(useAccountStore.getState().selectedAccountId).toBeNull();
  });

  it("keeps an explicit selection only while wallet, chain, and Matching scope are unchanged", () => {
    const state = useAccountStore.getState();
    state.setScope(scope);
    state.replaceAccounts(scope, accounts);
    state.selectAccount(scope, 57n);
    expect(useAccountStore.getState().selectedAccountId).toBe(57n);

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
  });
});
