// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubaccountSelector } from "./SubaccountSelector";

const mocks = vi.hoisted(() => ({
  createSubaccount: vi.fn(async () => 12n),
  refetch: vi.fn(async () => undefined),
  selectSubaccount: vi.fn(),
  useCoveredCallSubaccount: vi.fn(),
}));

vi.mock("@/hooks/protocol/useCoveredCallSubaccount", () => ({
  useCoveredCallSubaccount: mocks.useCoveredCallSubaccount,
}));

describe("SubaccountSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useCoveredCallSubaccount.mockReturnValue({
      accounts: [
        { accountId: 7n, cashBalance: 5n * 10n ** 18n, nonZeroBalanceCount: 2 },
        { accountId: 9n, cashBalance: 0n, nonZeroBalanceCount: 0 },
      ],
      subaccountId: null,
      isLoading: false,
      isFetching: false,
      error: null,
      source: "directory",
      selectSubaccount: mocks.selectSubaccount,
      createSubaccount: mocks.createSubaccount,
      refetch: mocks.refetch,
    });
  });

  it("requires an explicit choice and offers account creation", async () => {
    const user = userEvent.setup();
    render(<SubaccountSelector />);

    const selector = screen.getByRole("combobox", { name: "Trading subaccount" });
    expect((selector as HTMLSelectElement).value).toBe("");
    expect(screen.getByRole("option", { name: /#7.*5 USDT.*2 balances/i })).toBeTruthy();

    await user.selectOptions(selector, "9");
    expect(mocks.selectSubaccount).toHaveBeenCalledWith(9n);

    await user.click(screen.getByRole("button", { name: "Create another subaccount" }));
    expect(mocks.createSubaccount).toHaveBeenCalledOnce();
  });

  it("shows discovery errors with a retry instead of an empty-account state", async () => {
    mocks.useCoveredCallSubaccount.mockReturnValue({
      accounts: [],
      subaccountId: null,
      isLoading: false,
      isFetching: false,
      error: new Error("directory unavailable; RPC fallback failed"),
      source: null,
      selectSubaccount: mocks.selectSubaccount,
      createSubaccount: mocks.createSubaccount,
      refetch: mocks.refetch,
    });
    const user = userEvent.setup();
    render(<SubaccountSelector />);

    expect(screen.getByText(/directory unavailable/i)).toBeTruthy();
    expect(screen.queryByText("No subaccounts yet")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry subaccount discovery" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});
